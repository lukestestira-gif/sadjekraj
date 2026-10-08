'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/api.js'), 'utf8');
function adapter(env, Pool) {
  const exports = {};
  vm.runInNewContext(source, {
    exports, process: { env: { ...env } }, URL, Buffer, console: { error() {} },
    require(name) {
      if (name === 'pg') return { Pool };
      if (name === 'node:fs') return { mkdirSync() {} };
      if (name === '../../server') return { server: {}, sessions: new Map() };
      if (name === '../../data/db.json') return {};
      return require(name);
    }
  });
  return exports.handler;
}
test('Netlify configuration failures return useful JSON instead of uncaught errors', async () => {
  for (const [env, message] of [[{}, /DATABASE_URL/], [{ DATABASE_URL: 'postgresql://example.invalid/db' }, /ADMIN_PASS/]]) {
    const response = await adapter(env, class {} )({ path: '/api/admin/session' });
    assert.equal(response.statusCode, 503);
    assert.match(JSON.parse(response.body).error, message);
  }
});
test('Netlify connection and media query failures are caught', async () => {
  class Pool {
    async connect() { throw new Error('private connection details'); }
    async query() { throw new Error('private query details'); }
  }
  const handler = adapter({ DATABASE_URL: 'postgresql://user:secret@example.invalid/db', ADMIN_PASS: 'a-test-password-long-enough' }, Pool);
  for (const endpoint of ['/api/admin/login', '/.netlify/functions/api/media/test.png']) {
    const response = await handler({ path: endpoint });
    assert.equal(response.statusCode, 503);
    assert.match(JSON.parse(response.body).error, /Baza nije dostupna/);
    assert.doesNotMatch(response.body, /private|secret/);
  }
});
test('public fallback contains packaged photos and no private reservation fields', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/site-data.json')));
  assert.equal(data.gallery.length, 3);
  assert.equal(data.bookings, undefined);
  assert.ok(data.services.every(x => x.cost === undefined));
  for (const url of [data.settings.heroImage, ...data.gallery.map(x => x.image)]) {
    assert.ok(fs.existsSync(path.join(__dirname, '../public', url)));
  }
});
