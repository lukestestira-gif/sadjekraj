'use strict';
// PostgreSQL-backed adapter for the original Node HTTP API.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');

const workDir = path.join(os.tmpdir(), 'gavro-netlify-runtime');
const uploadDir = path.join(workDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
process.env.GAVRO_DATA_DIR = workDir;
process.env.GAVRO_UPLOAD_DIR = uploadDir;
const { server, sessions } = require('../../server');
const starter = require('../../data/db.json');
let pool;
let localPortPromise;
function dbPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured in Netlify');
  if (!process.env.ADMIN_PASS || process.env.ADMIN_PASS.length < 16) throw new Error('ADMIN_PASS must be configured with at least 16 characters');
  if (!pool) {
    const connection = new URL(process.env.DATABASE_URL);
    // Keep TLS verification enabled. Optional project CA supports Supabase certificates.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) connection.searchParams.delete(key);
    const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
    pool = new Pool({ connectionString: connection.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, max: 2, connectionTimeoutMillis: 10000 });
  }
  return pool;
}
function port() {
  if (!localPortPromise) localPortPromise = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
  return localPortPromise;
}
async function initialize(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS gavro_app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload JSONB NOT NULL)`);
  await client.query(`CREATE TABLE IF NOT EXISTS gavro_sessions (sid TEXT PRIMARY KEY, payload JSONB NOT NULL, expires BIGINT NOT NULL)`);
  await client.query(`CREATE TABLE IF NOT EXISTS gavro_media (filename TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BYTEA NOT NULL)`);
  await client.query('INSERT INTO gavro_app_state (id, payload) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(starter)]);
}
function pathFromEvent(event) {
  const raw = event.rawUrl || event.path || '/';
  const u = new URL(raw, 'https://local.invalid');
  const p = u.pathname.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api');
  return p + u.search;
}
async function handler(event) {
  const reqPath = pathFromEvent(event);
  const url = new URL(reqPath, 'https://local.invalid');
  let client;
  let began = false;
  try {
  const conn = dbPool();
  if (url.pathname.startsWith('/api/media/')) {
    const filename = url.pathname.slice('/api/media/'.length);
    if (!/^[a-zA-Z0-9_.-]{1,150}$/.test(filename)) return { statusCode: 404, body: 'Not found' };
    const { rows } = await conn.query('SELECT mime, bytes FROM gavro_media WHERE filename = $1', [filename]);
    if (!rows.length) return { statusCode: 404, body: 'Not found' };
    return { statusCode: 200, headers: { 'content-type': rows[0].mime, 'cache-control': 'public, max-age=86400' }, body: rows[0].bytes.toString('base64'), isBase64Encoded: true };
  }
  if (url.pathname === '/api/events') return { statusCode: 204, body: '' }; // serverless does not support SSE
  client = await conn.connect();
    await client.query('BEGIN'); began = true;
    // Serializes all read/modify/write API operations across concurrent Netlify instances.
    await client.query('SELECT pg_advisory_xact_lock(68429115, 29001)');
    await initialize(client);
    const state = await client.query('SELECT payload FROM gavro_app_state WHERE id=1');
    fs.writeFileSync(path.join(workDir, 'db.json'), JSON.stringify(state.rows[0].payload));
    const cookie = event.headers?.cookie || event.headers?.Cookie || '';
    const sid = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(cookie)?.[1];
    sessions.clear();
    if (sid) {
      const session = await client.query('SELECT payload, expires FROM gavro_sessions WHERE sid=$1', [sid]);
      if (session.rows.length && Number(session.rows[0].expires) > Date.now()) sessions.set(sid, session.rows[0].payload);
    }
    const httpPort = await port();
    const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body) : undefined;
    const method = (event.httpMethod || 'GET').toUpperCase();
    const r = await fetch(`http://127.0.0.1:${httpPort}${reqPath}`, {
      method,
      headers: { 'content-type': event.headers?.['content-type'] || 'application/json', cookie, 'x-forwarded-proto': 'https' },
      body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      signal: AbortSignal.timeout(22000)
    });
    const output = Buffer.from(await r.arrayBuffer());
    await client.query('UPDATE gavro_app_state SET payload=$1::jsonb WHERE id=1', [fs.readFileSync(path.join(workDir, 'db.json'), 'utf8')]);
    const setCookie = r.headers.get('set-cookie');
    if (setCookie) {
      const nextSid = /sid=([a-f0-9]{64})/.exec(setCookie)?.[1];
      if (nextSid && sessions.has(nextSid)) {
        const ses = sessions.get(nextSid);
        await client.query('INSERT INTO gavro_sessions(sid,payload,expires) VALUES($1,$2::jsonb,$3) ON CONFLICT(sid) DO UPDATE SET payload=EXCLUDED.payload,expires=EXCLUDED.expires', [nextSid, JSON.stringify(ses), ses.expires]);
      }
      if (/sid=;/.test(setCookie) && sid) await client.query('DELETE FROM gavro_sessions WHERE sid=$1', [sid]);
    } else if (sid && sessions.has(sid)) {
      const ses = sessions.get(sid);
      await client.query('UPDATE gavro_sessions SET payload=$2::jsonb,expires=$3 WHERE sid=$1', [sid, JSON.stringify(ses), ses.expires]);
    }
    if (method === 'POST' && url.pathname === '/api/admin/upload' && r.status === 201) {
      const result = JSON.parse(output.toString());
      const filename = path.basename(result.url);
      const bytes = fs.readFileSync(path.join(uploadDir, filename));
      const mime = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      await client.query('INSERT INTO gavro_media(filename,mime,bytes) VALUES($1,$2,$3) ON CONFLICT(filename) DO NOTHING', [filename, mime, bytes]);
      result.url = '/api/media/' + filename;
      await client.query('COMMIT'); began = false;
      return { statusCode: 201, headers: { 'content-type': 'application/json', ...(setCookie ? { 'set-cookie': setCookie } : {}) }, body: JSON.stringify(result) };
    }
    await client.query('COMMIT'); began = false;
    const headers = { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' };
    if (setCookie) headers['set-cookie'] = setCookie;
    return { statusCode: r.status, headers, body: output.toString('base64'), isBase64Encoded: true };
  } catch (e) {
    if (began) await client.query('ROLLBACK').catch(() => {});
    console.error('Gavro API failed:', e.code || e.name); // Do not log credentials.
    return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ error: !process.env.DATABASE_URL ? 'Nedostaje DATABASE_URL u Netlify Environment variables. Dodajte ga i ponovite deploy.' : (!process.env.ADMIN_PASS || process.env.ADMIN_PASS.length < 16) ? 'ADMIN_PASS u Netlify podešavanjima mora imati najmanje 16 znakova. Posle izmene ponovite deploy.' : 'Baza nije dostupna. Proverite Supabase pooler URL, lozinku, status projekta i SSL sertifikat; zatim Netlify Function log.' }) };
  } finally { if (client) client.release(); }
}
exports.handler = handler;
