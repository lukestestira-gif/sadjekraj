const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Barber123!';
const ADMIN_AUTH_FILE = path.join(__dirname, 'data', 'admin-auth.json');
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const SALON_TIME_ZONE = process.env.SALON_TIME_ZONE || 'Europe/Belgrade';
const bookingAttempts = new Map();
const cancellationAttempts = new Map();


const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.GAVRO_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const sessions = new Map();
const loginAttempts = new Map();
const eventClients = new Set();
function broadcastEvent(type, extra = {}) {
  const payload = `data: ${JSON.stringify({ type, ...extra, at: Date.now() })}\n\n`;
  for (const res of [...eventClients]) { try { res.write(payload); } catch { eventClients.delete(res); } }
}

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = {
      settings: {
        salonName: 'Gavro Hair Style',
        heroTitle: 'Dobar fade se vidi. Dobar barber se pamti.',
        heroSubtitle: 'Premium šišanje, fade i brada bez čekanja. Izaberi termin online za manje od minut.',
        phone: '+381 62 1892596',
        address: 'Jovana Cvijića 25, Loznica',
        instagram: '',
        accent: '#d8ff3e',
        currency: 'RSD',
        openingHours: 'Pon–Pet 09:00–18:00 · Subota 09:00–16:00 · Nedelja zatvoreno',
        aboutTitle: 'Online zakazivanje termina',
        aboutText: 'Rezerviši svoj termin brzo i jednostavno. Izaberi uslugu, vreme i potvrdi dolazak online.'
      },
      services: [
        { id: 'svc_hair', name: 'Šišanje', description: 'Konsultacija, šišanje i styling.', duration: 45, price: 1500, cost: 250, active: true },
        { id: 'svc_fade', name: 'Skin Fade', description: 'Precizan fade sa završnim stylingom.', duration: 50, price: 1800, cost: 300, active: true },
        { id: 'svc_beard', name: 'Brada', description: 'Oblikovanje, konture i završna nega.', duration: 30, price: 1000, cost: 180, active: true },
        { id: 'svc_combo', name: 'Hair + Beard', description: 'Kompletan tretman kose i brade.', duration: 75, price: 2400, cost: 400, active: true }
      ],
      barbers: [
        { id: 'barber_gavro', name: 'Gavro', role: 'Barber', initials: 'GV', color: '#d8a45d', workStart:'09:00', workEnd:'18:00', workDays:[1,2,3,4,5,6], active: true, bio: 'Moderni stilovi i detaljan završni styling.', photo: 'https://images.unsplash.com/photo-1517832606299-7ae9b720a186?auto=format&fit=crop&w=900&q=80' }
      ],
      bookings: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}
function readDb() {
  ensureData();
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.settings = db.settings || {};
  db.services = Array.isArray(db.services) ? db.services : [];
  db.barbers = Array.isArray(db.barbers) ? db.barbers : [];
  db.bookings = Array.isArray(db.bookings) ? db.bookings : [];
  db.blackouts = Array.isArray(db.blackouts) ? db.blackouts : [];

  db.gallery = Array.isArray(db.gallery) ? db.gallery : [];
  db.settings.heroImage = db.settings.heroImage || '';
  db.settings.logoImage = db.settings.logoImage || '';
  db.settings.heroEyebrow = db.settings.heroEyebrow || 'BARBER STUDIO · EST. 2026';
  db.settings.marqueeText = db.settings.marqueeText || 'FRESH FADE|MID FADE|LOW FADE|SKIN FADE|TAPER|BURST FADE|BEARD|CLEAN LINES';
  db.settings.primaryCtaText = db.settings.primaryCtaText || 'Zakaži termin';
  db.settings.servicesTitle = db.settings.servicesTitle || 'Izaberi tretman.';
  db.settings.servicesSubtitle = db.settings.servicesSubtitle || 'Jasna cena, vreme i slobodni termini. Bez poziva i čekanja.';
  db.settings.worksTitle = db.settings.worksTitle || 'Rezultat govori.';
  db.settings.worksSubtitle = db.settings.worksSubtitle || 'Fade, tekstura, brada i clean-up iz naše stolice.';
  db.settings.barbersTitle = db.settings.barbersTitle || 'Izaberi svog barbera.';
  db.settings.barbersSubtitle = db.settings.barbersSubtitle || 'Rezerviši termin direktno kod Gavra.';
  db.settings.bookingTitle = db.settings.bookingTitle || 'Stolica čeka. Izaberi vreme.';
  db.settings.bookingSubtitle = db.settings.bookingSubtitle || 'Prikazujemo samo termine koji su stvarno slobodni kod izabranog barbera.';
  db.settings.footerText = db.settings.footerText || 'Rezervacija bez čekanja. Stil bez kompromisa.';
  db.settings.tiktok = db.settings.tiktok || '';
  db.settings.appTitle = db.settings.appTitle || 'Gavro Hair Style';
  db.settings.appText = db.settings.appText || 'Instaliraj aplikaciju za brži pristup rezervacijama.';
  db.barbers = db.barbers.map(b => ({ photo:'', bio:'', ...b }));
  // Migrate only untouched Gavro defaults. Custom salon data and reservations remain intact.
  let migrated=false;
  // Older bundled gallery records omitted the publication flag. Preserve explicit hidden entries.
  for (const image of db.gallery) {
    if (image.active === undefined) { image.active = true; migrated = true; }
  }
  const gavroDefaults = ['Gavro Hair Style','Gavro Hairstyle'].includes(db.settings.salonName) && /Loznica/i.test(db.settings.address||'');
  if(gavroDefaults){
    if(db.settings.salonName==='Gavro Hair Style'){db.settings.salonName='Gavro Hairstyle';migrated=true;}
    if(!db.settings.instagram){db.settings.instagram='https://www.instagram.com/hairstyle_by_gavro/';migrated=true;}
    if(db.settings.logoImage==='/uploads/photo_mux78nxc_1c376b7c.png'){db.settings.logoImage='';migrated=true;}
    if(db.barbers.length===1&&db.barbers[0].photo?.includes('photo-1517832606299-7ae9b720a186')){db.barbers[0].photo='';migrated=true;}
    const demoImages=['photo_mux79cwe_64b3b44f.png','photo-1593702275687-f8b402bf1fb5','photo-1653875700329-a7c8aca94c95','photo-1605497788044-5a32c7078486'];
    if(db.gallery.length===4&&db.gallery.every(g=>demoImages.some(d=>String(g.image).includes(d)))){db.gallery=[];migrated=true;}
  }
  // Existing installations automatically get management codes for old reservations.
  for(const booking of db.bookings) {
    if(!/^[A-F0-9]{14}$/.test(String(booking.code||''))) {
      booking.code=newBookingCode(db);migrated=true;
    }
  }
  if(migrated)writeDb(db);
  return db;
}
function writeDb(db) {
  // A temporary file + atomic rename avoids partial JSON files during a crash.
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': typeof data === 'object' && !Buffer.isBuffer(data) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}
function json(res, status, obj, headers = {}) { send(res, status, obj, { 'Cache-Control':'no-store, no-cache, must-revalidate', ...headers }); }
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    return [decodeURIComponent(pair.slice(0, i)), decodeURIComponent(pair.slice(i + 1))];
  }));
}
function getSession(req) {
  const sid = parseCookies(req).sid;
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(sid); return null; }
  s.expires = Date.now() + SESSION_TTL_MS;
  return s;
}
function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) { json(res, 401, { error: 'Niste prijavljeni.' }); return false; }
  if (session.mustChangePassword) { json(res, 403, { error: 'Pre korišćenja panela postavite novu lozinku.' }); return false; }
  return true;
}
function readAdminAuth() {
  if (process.env.ADMIN_PASS || !fs.existsSync(ADMIN_AUTH_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(ADMIN_AUTH_FILE, 'utf8')); } catch { return null; }
}
function passwordMatches(password, auth) {
  if (!auth) {
    const actual = crypto.createHash('sha256').update(password).digest();
    const expected = crypto.createHash('sha256').update(ADMIN_PASS).digest();
    return crypto.timingSafeEqual(actual, expected);
  }
  try {
    const actual = crypto.scryptSync(password, auth.salt, 64);
    const expected = Buffer.from(auth.hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function secureCookie(req, sid, maxAge) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Prevelik zahtev')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('Neispravan JSON')); }
    });
    req.on('error', reject);
  });
}
function safeText(v, max = 200) { return String(v ?? '').trim().slice(0, max); }
function number(v, min, max) { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
function publicData(db) {
  return { settings: db.settings, services: db.services.filter(x => x.active), barbers: db.barbers.filter(x => x.active), gallery: db.gallery.filter(x => x.active) };
}
function dayKey(iso) { return String(iso || '').slice(0, 10); }
function toMinutes(hhmm) { const [h,m] = String(hhmm).split(':').map(Number); return h * 60 + m; }
function overlaps(startA, durationA, startB, durationB) { const a=toMinutes(startA), b=toMinutes(startB); return a < b + Number(durationB || 30) && b < a + Number(durationA || 30); }
function dateWeekday(iso) { const [y,m,d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d, 12).getDay(); }
function barberWorksOn(barber, date) { const days = Array.isArray(barber.workDays) && barber.workDays.length ? barber.workDays.map(Number) : [1,2,3,4,5,6]; return days.includes(dateWeekday(date)); }
function slotFitsShift(barber, date, time, duration) { if (!barber || !barber.active || !barberWorksOn(barber,date)) return false; const start=toMinutes(time), shiftStart=toMinutes(barber.workStart||'09:00'), shiftEnd=toMinutes(barber.workEnd||'20:00'); return start >= shiftStart && start + Number(duration||30) <= shiftEnd; }
function isBarberFree(db, barber, date, time, duration, ignoreId='') { return !isBlackout(db,barber.id,date) && slotFitsShift(barber,date,time,duration) && !db.bookings.some(b => b.id!==ignoreId && b.date===date && b.barberId===barber.id && b.status!=='cancelled' && overlaps(time,duration,b.time,b.duration)); }
function clientClock() {
  // A booking is interpreted in the SALON timezone, not in the customer's browser timezone.
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone:SALON_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return { date:`${values.year}-${values.month}-${values.day}`, minutes:Number(values.hour)*60+Number(values.minute) };
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d=new Date(value+'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===value;
}
function futureDateWithinRange(value, clock, days=60) {
  if (!validDate(value) || value<clock.date) return false;
  const ms=Date.parse(value+'T12:00:00Z')-Date.parse(clock.date+'T12:00:00Z');
  return ms<=days*86400000;
}
function timeIsOpen(date,time,minimumMinutes=15) {
  const clock=clientClock();
  return date>clock.date || (date===clock.date && toMinutes(time)>=clock.minutes+minimumMinutes);
}
function isBlackout(db,barberId,date) {
  return (db.blackouts||[]).some(b=>b.dateFrom<=date && date<=b.dateTo && (!b.barberId || b.barberId===barberId));
}
function newBookingCode(db) {
  let code;
  do { code=crypto.randomBytes(7).toString('hex').toUpperCase(); }
  while(db.bookings.some(b=>b.code===code));
  return code;
}
function publicBooking(b) {
  return { code:b.code, name:b.name, serviceName:b.serviceName,
    barberName:b.barberName, date:b.date, time:b.time, duration:b.duration,
    price:b.price, status:b.status, createdAt:b.createdAt };
}
function normalizedPhone(phone) { return String(phone||'').replace(/[^0-9]/g,''); }
function matchPhone(phone) { const digits=normalizedPhone(phone); return digits.startsWith('00381') ? '381'+digits.slice(5) : digits.startsWith('0') && digits.length>=9 ? '381'+digits.slice(1) : digits; }
function metrics(db) {
  const today = clientClock().date;
  const month = today.slice(0,7);
  const completed = db.bookings.filter(b => b.status === 'completed');
  const revenue = completed.reduce((s,b) => s + Number(b.price || 0), 0);
  const profit = completed.reduce((s,b) => s + Number(b.price || 0) - Number(b.cost || 0), 0);
  const monthCompleted = completed.filter(b => String(b.date).startsWith(month));
  const monthRevenue = monthCompleted.reduce((s,b) => s + Number(b.price || 0), 0);
  const monthProfit = monthCompleted.reduce((s,b) => s + Number(b.price || 0) - Number(b.cost || 0), 0);
  const upcoming = db.bookings.filter(b => ['pending','confirmed'].includes(b.status) && b.date >= today).length;
  const todayBookings = db.bookings.filter(b => b.date === today && b.status !== 'cancelled').length;
  return { totalBookings: db.bookings.length, todayBookings, upcoming, revenue, profit, monthRevenue, monthProfit };
}
function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.webp':'image/webp'})[ext] || 'application/octet-stream';
}
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const db = readDb();

  if (method === 'GET' && p === '/api/events') {
    res.writeHead(200, {
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    });
    res.write(`data: ${JSON.stringify({type:'connected',at:Date.now()})}\n\n`);
    eventClients.add(res);
    req.on('close', () => eventClients.delete(res));
    return;
  }

  if (method === 'GET' && p === '/api/public') return json(res, 200, publicData(db));

  if (method === 'GET' && p === '/api/next-available') {
    const service=db.services.find(s=>s.id===safeText(url.searchParams.get('serviceId'),80)&&s.active);
    const barberId=safeText(url.searchParams.get('barberId'),80);
    if(!service || (barberId!=='any'&&!db.barbers.some(b=>b.id===barberId&&b.active))) return json(res,400,{error:'Izaberite uslugu i barbera.'});
    const barbers=db.barbers.filter(b=>b.active&&(barberId==='any'||b.id===barberId));
    const clock=clientClock(), options=[];
    for(let i=0;i<21&&options.length<4;i++) {
      const d=new Date(clock.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);
      const date=d.toISOString().slice(0,10);
      const minStart=Math.min(...barbers.map(b=>toMinutes(b.workStart||'09:00')));
      const maxEnd=Math.max(...barbers.map(b=>toMinutes(b.workEnd||'20:00')));
      for(let mins=minStart;mins<maxEnd&&options.length<4;mins+=15) {
        const time=`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
        if(!timeIsOpen(date,time))continue;
        const matching=barbers.filter(b=>isBarberFree(db,b,date,time,service.duration));
        if(matching.length) options.push({date,time,barberIds:matching.map(b=>b.id)});
      }
    }
    return json(res,200,{slots:options});
  }

  if (method === 'GET' && p === '/api/availability') {
    const date = safeText(url.searchParams.get('date'), 10);
    const barberId = safeText(url.searchParams.get('barberId'), 80);
    const serviceId = safeText(url.searchParams.get('serviceId'), 80);
    const svc = db.services.find(s => s.id === serviceId && s.active);
    const clock=clientClock(url.searchParams.get('tzOffset'));
    if (!validDate(date) || !svc) return json(res, 400, { error: 'Nedostaju podaci.' });
    if (!futureDateWithinRange(date,clock)) return json(res, 200, { slots: [] });
    const barbers = barberId === 'any' ? db.barbers.filter(b => b.active) : db.barbers.filter(b => b.id === barberId && b.active);
    if (!barbers.length) return json(res, 200, { slots: [] });
    const minStart = Math.min(...barbers.map(b=>toMinutes(b.workStart||'09:00')));
    const maxEnd = Math.max(...barbers.map(b=>toMinutes(b.workEnd||'20:00')));
    const slots=[];
    for (let mins=minStart; mins<maxEnd; mins+=15) {
      const time=`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
      if(date===clock.date && mins < clock.minutes + 15) continue;
      const available = barbers.filter(b=>isBarberFree(db,b,date,time,svc.duration));
      if (available.length) slots.push({ time, barberIds: available.map(b=>b.id) });
    }
    return json(res, 200, { slots });
  }

  if (method === 'POST' && p === '/api/bookings') {
    const ip=req.socket.remoteAddress||'unknown', now=Date.now();
    for(const [key,entry] of bookingAttempts)if(entry.resetAt<=now)bookingAttempts.delete(key);
    const attempt=bookingAttempts.get(ip)||{count:0,resetAt:now+3600000};
    attempt.count++;bookingAttempts.set(ip,attempt);
    if(attempt.count>24)return json(res,429,{error:'Previše zahteva za zakazivanje. Kontaktirajte salon telefonom.'},{'Retry-After':String(Math.max(1,Math.ceil((attempt.resetAt-now)/1000)))});
    const body = await readBody(req);
    if(body.website)return json(res,400,{error:'Neispravan zahtev.'});
    const service = db.services.find(s => s.id === safeText(body.serviceId, 80) && s.active);
    let barber = body.barberId === 'any' ? null : db.barbers.find(b => b.id === safeText(body.barberId,80) && b.active);
    const date = safeText(body.date,10), time = safeText(body.time,5);
    const clock=clientClock(body.tzOffset);
    const name = safeText(body.name,100), phone = safeText(body.phone,50), note = safeText(body.note,400);
    if (!service || !validDate(date) || !/^\d{2}:\d{2}$/.test(time) || name.length < 2 || normalizedPhone(phone).length < 7) return json(res,400,{error:'Popunite sva obavezna polja.'});
    if (!futureDateWithinRange(date,clock)) return json(res,400,{error:'Rezervacije su dostupne u narednih 60 dana.'});
    if (toMinutes(time)%15!==0) return json(res,400,{error:'Termin mora biti na 15 minuta.'});
    if (date===clock.date && toMinutes(time) < clock.minutes + 15) return json(res,400,{error:'Izaberite termin koji još nije počeo.'});
    if (!barber) {
      const candidates = db.barbers.filter(b=>b.active);
      barber = candidates.find(b => isBarberFree(db,b,date,time,service.duration));
    }
    if (!barber || !slotFitsShift(barber,date,time,service.duration)) return json(res,409,{error:'Barber ne radi u tom terminu. Izaberite drugi termin.'});
    if (!isBarberFree(db,barber,date,time,service.duration)) return json(res,409,{error:'Termin je upravo zauzet. Izaberite drugi.'});
    const booking = { id:id('bk'), code:newBookingCode(db), createdAt:nowIso(), name, phone, note, serviceId:service.id, serviceName:service.name, barberId:barber.id, barberName:barber.name, date, time, duration:service.duration, price:service.price, cost:Number(service.cost||0), status:'pending' };
    db.bookings.push(booking); writeDb(db); broadcastEvent('bookings-changed',{date:booking.date});
    return json(res,201,{ ok:true, booking:publicBooking(booking) });
  }

  // Public self-service cancellation is disabled on this installation.
  if (method === 'POST' && p === '/api/bookings/cancel') {
    return json(res,404,{error:'Javno otkazivanje termina nije omogućeno. Kontaktirajte salon direktno.'});
  }

  if (method === 'POST' && p === '/api/admin/login') {
    const ip = req.socket.remoteAddress || 'unknown', now = Date.now();
    for (const [key, entry] of loginAttempts) if (entry.resetAt <= now) loginAttempts.delete(key);
    const attempts = loginAttempts.get(ip);
    if (attempts && attempts.count >= LOGIN_MAX_ATTEMPTS) return json(res,429,{error:'Previše neuspešnih pokušaja. Sačekajte 15 minuta.'},{'Retry-After':String(Math.ceil((attempts.resetAt-now)/1000))});
    const body = await readBody(req);
    const u = safeText(body.username,100), pass = String(body.password || '');
    const userHash = crypto.createHash('sha256').update(u).digest(), expectedUserHash = crypto.createHash('sha256').update(ADMIN_USER).digest();
    const goodUser = crypto.timingSafeEqual(userHash, expectedUserHash), goodPass = passwordMatches(pass, readAdminAuth());
    if (!goodUser || !goodPass) {
      const entry = attempts && attempts.resetAt > now ? attempts : { count:0, resetAt:now+LOGIN_WINDOW_MS };
      entry.count += 1; loginAttempts.set(ip, entry);
      return json(res,401,{error:'Pogrešan username ili lozinka.'});
    }
    loginAttempts.delete(ip);
    const mustChangePassword = !process.env.ADMIN_PASS && !fs.existsSync(ADMIN_AUTH_FILE);
    const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid,{ user:u, expires:now+SESSION_TTL_MS, mustChangePassword });
    return json(res,200,{ok:true,mustChangePassword,canChangePassword:!process.env.ADMIN_PASS},{'Set-Cookie':secureCookie(req,sid,SESSION_TTL_MS/1000)});
  }
  if (method === 'POST' && p === '/api/admin/logout') {
    const sid = parseCookies(req).sid; if (sid) sessions.delete(sid);
    return json(res,200,{ok:true},{'Set-Cookie':secureCookie(req,'',0)});
  }
  if (method === 'GET' && p === '/api/admin/session') {
    const session = getSession(req);
    return json(res,200,{authenticated:!!session,mustChangePassword:!!session?.mustChangePassword,canChangePassword:!process.env.ADMIN_PASS});
  }
  if (method === 'POST' && p === '/api/admin/password-change') {
    const session = getSession(req);
    if (!session) return json(res,401,{error:'Niste prijavljeni.'});
    if (process.env.ADMIN_PASS) return json(res,403,{error:'Lozinka se podešava preko ADMIN_PASS konfiguracije.'});
    const body = await readBody(req), nextPassword = String(body.newPassword || '');
    if (nextPassword.length < 12) return json(res,400,{error:'Nova lozinka mora imati najmanje 12 znakova.'});
    if (!session.mustChangePassword && !passwordMatches(String(body.currentPassword || ''), readAdminAuth())) return json(res,401,{error:'Trenutna lozinka nije ispravna.'});
    const salt = crypto.randomBytes(16).toString('hex'), hash = crypto.scryptSync(nextPassword, salt, 64).toString('hex');
    fs.writeFileSync(ADMIN_AUTH_FILE, JSON.stringify({ salt, hash, updatedAt:nowIso() }, null, 2), { mode:0o600 });
    sessions.clear();
    const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid,{ user:ADMIN_USER, expires:Date.now()+SESSION_TTL_MS, mustChangePassword:false });
    return json(res,200,{ok:true},{'Set-Cookie':secureCookie(req,sid,SESSION_TTL_MS/1000)});
  }

  if (p.startsWith('/api/admin/') && !requireAdmin(req,res)) return;

  if (method === 'GET' && p === '/api/admin/backup') {
    const filename = `barber-backup-${new Date().toISOString().slice(0,10)}.json`;
    return json(res,200,{exportedAt:nowIso(),data:db},{'Content-Disposition':`attachment; filename="${filename}"`});
  }
  if (method === 'GET' && p === '/api/admin/dashboard') {
    return json(res,200,{ metrics:metrics(db), bookings:[...db.bookings].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)), settings:db.settings, services:db.services, barbers:db.barbers, blackouts:db.blackouts, gallery:db.gallery });
  }
  if (method === 'PUT' && p === '/api/admin/settings') {
    const body = await readBody(req);
    db.settings = {
      ...db.settings,
      salonName:safeText(body.salonName,80),
      logoImage:safeText(body.logoImage ?? db.settings.logoImage,500),
      heroImage:safeText(body.heroImage ?? db.settings.heroImage,500),
      heroEyebrow:safeText(body.heroEyebrow,100),
      heroTitle:safeText(body.heroTitle,160),
      heroSubtitle:safeText(body.heroSubtitle,420),
      primaryCtaText:safeText(body.primaryCtaText,40)||'Zakaži termin',
      marqueeText:safeText(body.marqueeText,500),
      servicesTitle:safeText(body.servicesTitle,120), servicesSubtitle:safeText(body.servicesSubtitle,300),
      worksTitle:safeText(body.worksTitle,120), worksSubtitle:safeText(body.worksSubtitle,300),
      barbersTitle:safeText(body.barbersTitle,120), barbersSubtitle:safeText(body.barbersSubtitle,300),
      bookingTitle:safeText(body.bookingTitle,140), bookingSubtitle:safeText(body.bookingSubtitle,320),
      phone:safeText(body.phone,60), address:safeText(body.address,120), instagram:safeText(body.instagram,80), tiktok:safeText(body.tiktok,80),
      accent:/^#[0-9a-fA-F]{6}$/.test(String(body.accent)) ? body.accent : db.settings.accent,
      currency:safeText(body.currency,10)||'RSD', openingHours:safeText(body.openingHours,160),
      aboutTitle:safeText(body.aboutTitle,160), aboutText:safeText(body.aboutText,700),
      appTitle:safeText(body.appTitle ?? db.settings.appTitle,140), appText:safeText(body.appText ?? db.settings.appText,500),
      footerText:safeText(body.footerText,180),
      googleMapsUrl:safeText(body.googleMapsUrl,600),
      googleReviewUrl:safeText(body.googleReviewUrl,600),
      googleMapsEmbed:safeText(body.googleMapsEmbed,1000)
    };
    writeDb(db); broadcastEvent('site-changed'); return json(res,200,{ok:true,settings:db.settings});
  }
  if (method === 'POST' && p === '/api/admin/blackouts') {
    const body=await readBody(req);
    const dateFrom=safeText(body.dateFrom,10), dateTo=safeText(body.dateTo,10);
    const barberId=safeText(body.barberId,80);
    if(!validDate(dateFrom)||!validDate(dateTo)||dateTo<dateFrom||
       Date.parse(dateTo+'T12:00:00Z')-Date.parse(dateFrom+'T12:00:00Z')>90*86400000 ||
       (barberId&&!db.barbers.some(b=>b.id===barberId)))return json(res,400,{error:'Proverite datume i izabranog barbera (maksimalno 90 dana).'});
    const blackout={id:id('off'),dateFrom,dateTo,barberId,reason:safeText(body.reason,120)||'Neradni dan'};
    db.blackouts.push(blackout);writeDb(db);broadcastEvent('calendar-config-changed');
    return json(res,201,{ok:true,blackout,affectedBookings:db.bookings.filter(b=>b.status!=='cancelled'&&b.date>=dateFrom&&b.date<=dateTo&&(!barberId||b.barberId===barberId)).length});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/blackouts/')) {
    const bid=p.split('/').pop();const original=db.blackouts.length;
    db.blackouts=db.blackouts.filter(x=>x.id!==bid);
    if(original===db.blackouts.length)return json(res,404,{error:'Neradni dan nije pronađen.'});
    writeDb(db);broadcastEvent('calendar-config-changed');return json(res,200,{ok:true});
  }

  if (method === 'POST' && p === '/api/admin/services') {
    const b=await readBody(req); const service={id:id('svc'),name:safeText(b.name,80),description:safeText(b.description,200),duration:number(b.duration,15,240),price:number(b.price,0,1000000),cost:number(b.cost,0,1000000),active:b.active!==false};
    if(!service.name) return json(res,400,{error:'Naziv usluge je obavezan.'}); db.services.push(service); writeDb(db); return json(res,201,{ok:true,service});
  }
  if (method === 'PUT' && p.startsWith('/api/admin/services/')) {
    const sid=p.split('/').pop(); const i=db.services.findIndex(x=>x.id===sid); if(i<0)return json(res,404,{error:'Usluga nije pronađena.'}); const b=await readBody(req);
    db.services[i]={...db.services[i],name:safeText(b.name,80),description:safeText(b.description,200),duration:number(b.duration,15,240),price:number(b.price,0,1000000),cost:number(b.cost,0,1000000),active:!!b.active}; writeDb(db); return json(res,200,{ok:true,service:db.services[i]});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/services/')) { const sid=p.split('/').pop(); db.services=db.services.filter(x=>x.id!==sid); writeDb(db); return json(res,200,{ok:true}); }

  if (method === 'POST' && p === '/api/admin/barbers') {
    const b=await readBody(req); const name=safeText(b.name,80); if(!name)return json(res,400,{error:'Ime barbera je obavezno.'}); const barber={id:id('barber'),name,role:safeText(b.role,80)||'Barber',initials:safeText(b.initials,3).toUpperCase()||name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),color:/^#[0-9a-fA-F]{6}$/.test(String(b.color))?b.color:'#d8a45d',workStart:/^\d{2}:\d{2}$/.test(String(b.workStart))?b.workStart:'09:00',workEnd:/^\d{2}:\d{2}$/.test(String(b.workEnd))?b.workEnd:'20:00',workDays:Array.isArray(b.workDays)?b.workDays.map(Number).filter(x=>x>=0&&x<=6):[1,2,3,4,5,6],photo:safeText(b.photo,500),bio:safeText(b.bio,300),active:b.active!==false}; db.barbers.push(barber); writeDb(db); broadcastEvent('calendar-config-changed'); return json(res,201,{ok:true,barber});
  }
  if (method === 'PUT' && p.startsWith('/api/admin/barbers/')) {
    const bid=p.split('/').pop(); const i=db.barbers.findIndex(x=>x.id===bid); if(i<0)return json(res,404,{error:'Barber nije pronađen.'}); const b=await readBody(req); db.barbers[i]={...db.barbers[i],name:safeText(b.name,80),role:safeText(b.role,80),initials:safeText(b.initials,3).toUpperCase(),color:/^#[0-9a-fA-F]{6}$/.test(String(b.color))?b.color:(db.barbers[i].color||'#d8a45d'),workStart:/^\d{2}:\d{2}$/.test(String(b.workStart))?b.workStart:(db.barbers[i].workStart||'09:00'),workEnd:/^\d{2}:\d{2}$/.test(String(b.workEnd))?b.workEnd:(db.barbers[i].workEnd||'20:00'),workDays:Array.isArray(b.workDays)?b.workDays.map(Number).filter(x=>x>=0&&x<=6):(db.barbers[i].workDays||[1,2,3,4,5,6]),photo:safeText(b.photo ?? db.barbers[i].photo,500),bio:safeText(b.bio ?? db.barbers[i].bio,300),active:!!b.active}; writeDb(db); broadcastEvent('calendar-config-changed'); return json(res,200,{ok:true,barber:db.barbers[i]});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/barbers/')) { const bid=p.split('/').pop(); db.barbers=db.barbers.filter(x=>x.id!==bid); writeDb(db); broadcastEvent('calendar-config-changed'); return json(res,200,{ok:true}); }

  if (method === 'POST' && p === '/api/admin/upload') {
    const b = await readBody(req, 12 * 1024 * 1024);
    const raw = String(b.data || '');
    const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(res,400,{error:'Podržane su JPG, PNG i WEBP slike.'});
    const buf = Buffer.from(match[2], 'base64');
    if (!buf.length || buf.length > 6 * 1024 * 1024) return json(res,400,{error:'Slika mora biti manja od 6 MB.'});
    const signatureOk = match[1]==='image/png' ? buf.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) :
      match[1]==='image/jpeg' ? buf.subarray(0,3).equals(Buffer.from('ffd8ff','hex')) :
      buf.subarray(0,4).toString()==='RIFF' && buf.subarray(8,12).toString()==='WEBP';
    if(!signatureOk)return json(res,400,{error:'Datoteka nije ispravna slika odgovarajućeg tipa.'});
    const ext = match[1] === 'image/png' ? '.png' : match[1] === 'image/webp' ? '.webp' : '.jpg';
    const uploadDir = process.env.GAVRO_UPLOAD_DIR || path.join(PUBLIC_DIR,'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
    const filename = `${id('photo')}${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), buf);
    return json(res,201,{ok:true,url:`/uploads/${filename}`});
  }

  if (method === 'POST' && p === '/api/admin/gallery') {
    const b=await readBody(req); const image=safeText(b.image,500);
    if(!image)return json(res,400,{error:'Dodajte sliku.'});
    const item={id:id('gal'),title:safeText(b.title,100)||'Naš rad',caption:safeText(b.caption,220),image,barberId:safeText(b.barberId,80),active:b.active!==false};
    db.gallery.push(item); writeDb(db); return json(res,201,{ok:true,item});
  }
  if (method === 'PUT' && p.startsWith('/api/admin/gallery/')) {
    const gid=p.split('/').pop(); const i=db.gallery.findIndex(x=>x.id===gid); if(i<0)return json(res,404,{error:'Slika nije pronađena.'});
    const b=await readBody(req); db.gallery[i]={...db.gallery[i],title:safeText(b.title,100)||db.gallery[i].title,caption:safeText(b.caption,220),image:safeText(b.image||db.gallery[i].image,500),barberId:safeText(b.barberId,80),active:!!b.active};
    writeDb(db); return json(res,200,{ok:true,item:db.gallery[i]});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/gallery/')) {
    const gid=p.split('/').pop(); db.gallery=db.gallery.filter(x=>x.id!==gid); writeDb(db); return json(res,200,{ok:true});
  }

  if (method === 'POST' && p === '/api/admin/bookings') {
    const b=await readBody(req); const service=db.services.find(x=>x.id===safeText(b.serviceId,80)); const barber=db.barbers.find(x=>x.id===safeText(b.barberId,80));
    const name=safeText(b.name,100), phone=safeText(b.phone,50), date=safeText(b.date,10), time=safeText(b.time,5), note=safeText(b.note,400); const allowed=['pending','confirmed','completed','cancelled']; const status=allowed.includes(b.status)?b.status:'confirmed';
    if(!service||!barber||name.length<2||phone.length<3||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)) return json(res,400,{error:'Popunite sve podatke za termin.'});
    if(status!=='cancelled' && !slotFitsShift(barber,date,time,service.duration)) return json(res,409,{error:'Barber ne radi u tom terminu.'}); if(status!=='cancelled' && !isBarberFree(db,barber,date,time,service.duration)) return json(res,409,{error:'Barber već ima termin u tom periodu.'});
    const booking={id:id('bk'),createdAt:nowIso(),name,phone,note,serviceId:service.id,serviceName:service.name,barberId:barber.id,barberName:barber.name,date,time,duration:service.duration,price:service.price,cost:Number(service.cost||0),status}; db.bookings.push(booking); writeDb(db); broadcastEvent('bookings-changed',{date:booking.date}); return json(res,201,{ok:true,booking});
  }
  if (method === 'PUT' && p.startsWith('/api/admin/bookings/')) {
    const bid=p.split('/').pop(); const i=db.bookings.findIndex(x=>x.id===bid); if(i<0)return json(res,404,{error:'Zakazivanje nije pronađeno.'}); const b=await readBody(req); const current=db.bookings[i]; const allowed=['pending','confirmed','completed','cancelled'];
    const service=db.services.find(x=>x.id===safeText(b.serviceId||current.serviceId,80)); const barber=db.barbers.find(x=>x.id===safeText(b.barberId||current.barberId,80)); const date=/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))?b.date:current.date; const time=/^\d{2}:\d{2}$/.test(String(b.time))?b.time:current.time; const status=allowed.includes(b.status)?b.status:current.status;
    if(!service||!barber)return json(res,400,{error:'Barber ili usluga ne postoje.'}); if(status!=='cancelled'&&!slotFitsShift(barber,date,time,service.duration)) return json(res,409,{error:'Barber ne radi u tom terminu.'}); if(status!=='cancelled'&&!isBarberFree(db,barber,date,time,service.duration,current.id))return json(res,409,{error:'Barber već ima termin u tom periodu.'});
    db.bookings[i]={...current,name:safeText(b.name||current.name,100),phone:safeText(b.phone||current.phone,50),note:safeText(b.note??current.note,400),serviceId:service.id,serviceName:service.name,barberId:barber.id,barberName:barber.name,date,time,duration:service.duration,price:service.price,cost:Number(service.cost||0),status}; writeDb(db); broadcastEvent('bookings-changed',{date:db.bookings[i].date}); return json(res,200,{ok:true,booking:db.bookings[i]});
  }
  if (method === 'DELETE' && p.startsWith('/api/admin/bookings/')) { const bid=p.split('/').pop(); db.bookings=db.bookings.filter(x=>x.id!==bid); writeDb(db); broadcastEvent('bookings-changed'); return json(res,200,{ok:true}); }

  return json(res,404,{error:'Ruta nije pronađena.'});
}

setInterval(() => { for (const res of [...eventClients]) { try { res.write(': ping\n\n'); } catch { eventClients.delete(res); } } }, 25000).unref();

ensureData();
const server = http.createServer(async (req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  try {
    const url=new URL(req.url,`http://${req.headers.host || 'localhost'}`);
    if(url.pathname.startsWith('/api/')) return await handleApi(req,res,url);
    if (url.pathname === '/manifest.webmanifest') {
      const db = readDb(), st = db.settings || {};
      const icon = st.logoImage || '';
      const manifest = {
        name: st.salonName || 'Barber Booking',
        short_name: (st.salonName || 'Barber').slice(0, 12),
        description: 'Barber studio - online zakazivanje termina',
        start_url: '/?source=pwa', scope: '/', display: 'standalone',
        background_color: '#110f0d', theme_color: st.accent || '#d8a45d', orientation: 'portrait-primary',
        icons: icon ? [{src:icon,sizes:'any',purpose:'any maskable'}] : [
          {src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any maskable'},
          {src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}
        ]
      };
      return send(res,200,JSON.stringify(manifest),{'Content-Type':'application/manifest+json; charset=utf-8','Cache-Control':'no-store'});
    }
    if (url.pathname === '/admin') { req.url='/admin.html'; return serveStatic(req,res,'/admin.html') || send(res,404,'Not found'); }
    if(serveStatic(req,res,url.pathname)) return;
    send(res,404,'Not found');
  } catch(err) { console.error(err); if(!res.headersSent) json(res,500,{error:'Greška na serveru.'}); else res.end(); }
});
function listenOn(port, attempts = 0) {
  const onError = err => {
    server.off('listening', onListening);
    if (err && err.code === 'EADDRINUSE' && attempts < 9 && !process.env.PORT) {
      setTimeout(() => listenOn(port + 1, attempts + 1), 40);
      return;
    }
    throw err;
  };
  const onListening = () => {
    server.off('error', onError);
    console.log(`Barber site: http://localhost:${port} | Admin: http://localhost:${port}/admin`);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}
if (require.main === module) listenOn(PORT);
module.exports = { server, sessions };
