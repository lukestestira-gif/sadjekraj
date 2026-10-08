let API_AVAILABLE = false;
let DATA = { settings: {}, services: [], barbers: [], gallery: [] };
let BOOKING = { step: 1, serviceId: '', barberId: '', date: '', time: '', availableBarbers: [] };
let deferredPrompt = null;
let slotRequestId = 0;
let slotRefreshTimer = null;
function safeSessionRead(key){try{return sessionStorage.getItem(key);}catch{return null;}}
function safeSessionWrite(key,value){try{sessionStorage.setItem(key,value);}catch{}}


const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function esc(s) {
  return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

async function api(url, opts = {}) {
  const r = await fetch(url, {
    cache: 'no-store',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  let j;
  try { j = await r.json(); } catch { throw new Error('Server za zakazivanje nije dostupan.'); }
  if (!r.ok) throw new Error(j.error || 'Greška pri povezivanju.');
  return j;
}

function money(n) {
  return new Intl.NumberFormat('sr-RS').format(Number(n || 0)) + ' ' + (DATA.settings.currency || 'RSD');
}
function localISO(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
function humanDate(iso) {
  return iso ? parseDate(iso).toLocaleDateString('sr-RS', { weekday: 'short', day: '2-digit', month: 'short' }) : '—';
}
function selectedService() { return DATA.services.find(x => x.id === BOOKING.serviceId); }
function selectedBarber() { return DATA.barbers.find(x => x.id === BOOKING.barberId); }
function endTime(time, duration) {
  const [h, m] = time.split(':').map(Number), n = h * 60 + m + Number(duration || 30);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function setText(selector, value, fallback = '') {
  const el = $(selector);
  if (el) el.textContent = value || fallback;
}

function externalHttpUrl(value) {
  try {
    const u=new URL(String(value||''));
    return ['http:','https:'].includes(u.protocol)?u.href:'';
  }catch{return '';}
}
function googleMapEmbed(value) {
  const raw=String(value||'');
  const found=raw.match(/src\s*=\s*[\"']([^\"']+)[\"']/i);
  const link=externalHttpUrl(found?found[1]:raw);
  if(!link)return '';
  try {
    const url=new URL(link),host=url.hostname.toLowerCase();
    return (host==='google.com'||host.endsWith('.google.com'))&&url.pathname.startsWith('/maps')?link:'';
  }catch{return '';}
}

function applyLogo(url) {
  $$('.js-logo-mark').forEach(el => {
    if (url) {
      el.classList.add('has-image');
      el.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
      el.textContent = '';
    } else {
      el.classList.remove('has-image');
      el.style.backgroundImage = '';
      el.textContent = (DATA.settings.salonName || 'N').trim().charAt(0).toUpperCase() || 'N';
    }
  });
  const touch = document.querySelector('link[rel="apple-touch-icon"]');
  if (touch && url) touch.href = url;
}

function renderMarquee() {
  const raw = DATA.settings.marqueeText || 'FRESH FADE|MID FADE|LOW FADE|SKIN FADE|TAPER|BURST FADE|BEARD|CLEAN LINES';
  const items = raw.split('|').map(x => x.trim()).filter(Boolean);
  const safeItems = (items.length ? items : ['FRESH FADE', 'MID FADE', 'SKIN FADE']).map(x => `<span>${esc(x)}</span><b>✦</b>`).join('');
  $('#marqueeTrack').innerHTML = `<div class="marquee-set">${safeItems}</div><div class="marquee-set" aria-hidden="true">${safeItems}</div>`;
}

async function load() {
  try {
    DATA = await api('/api/public');
    if (!DATA.settings || !Array.isArray(DATA.services) || !Array.isArray(DATA.barbers)) throw new Error('Neispravni podaci servera.');
    API_AVAILABLE = true;
  } catch (error) {
    const response = await fetch('/site-data.json', { cache: 'no-store' });
    if (!response.ok) throw error;
    DATA = await response.json();
    API_AVAILABLE = false;
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'padding:18px;background:#241b12;color:#fff;text-align:center';
    notice.textContent = 'Online zakazivanje trenutno nije dostupno. Za termin pozovite ' + DATA.settings.phone + '.';
    $('#booking').prepend(notice);
    $('#bookingForm').querySelectorAll('input,button,select,textarea').forEach(el => el.disabled = true);
  }
  const s = DATA.settings;
  document.documentElement.style.setProperty('--accent', s.accent || '#d8a45d');
  document.title = `${s.salonName || 'Barber'} — Zakazivanje`;

  setText('#brandName', s.salonName, 'GAVRO HAIR STYLE');
  setText('#footerName', s.salonName, 'GAVRO HAIR STYLE');
  setText('#heroEyebrow', s.heroEyebrow, 'ONLINE ZAKAZIVANJE · GAVRO HAIR STYLE');
  setText('#heroTitle', s.heroTitle);
  setText('#heroSubtitle', s.heroSubtitle);
  setText('#openingHours', s.openingHours);
  setText('#phone', s.phone);
  setText('#aboutTitle', s.aboutTitle);
  setText('#aboutText', s.aboutText);
  setText('#address', s.address);
  const instagramEl=$('#instagram'); if(instagramEl){instagramEl.textContent='@hairstyle_by_gavro ↗';instagramEl.href='https://www.instagram.com/hairstyle_by_gavro/';}
  setText('#mapAddress', s.address);
  const mapsBtn = $('#mapsBtn'); if (mapsBtn) { const href=externalHttpUrl(s.googleMapsUrl);mapsBtn.href = href || '#'; mapsBtn.style.display = href ? 'inline-flex' : 'none'; }
  const reviewBtn = $('#reviewBtn'); if (reviewBtn) { const href=externalHttpUrl(s.googleReviewUrl);reviewBtn.href = href || '#'; reviewBtn.style.display = href ? 'inline-flex' : 'none'; }
  const map = $('#googleMapFrame'); if (map) { const embed=googleMapEmbed(s.googleMapsEmbed);if(embed){map.src=embed;map.title='Lokacija salona';map.style.display='block';}else{map.removeAttribute('src');map.style.display='none';} }
  setText('#appTitle', s.appTitle, 'Tvoj barber na telefonu.');
  setText('#appText', s.appText);
  setText('#servicesTitle', s.servicesTitle, 'Izaberi tretman.');
  setText('#servicesSubtitle', s.servicesSubtitle);
  setText('#worksTitle', s.worksTitle, 'Rezultat govori.');
  setText('#worksSubtitle', s.worksSubtitle);
  setText('#barbersTitle', s.barbersTitle, 'Izaberi svog barbera.');
  setText('#barbersSubtitle', s.barbersSubtitle);
  setText('#bookingTitle', s.bookingTitle, 'Stolica čeka. Izaberi vreme.');
  setText('#bookingSubtitle', s.bookingSubtitle);
  setText('#footerText', s.footerText, 'Rezervacija bez čekanja. Stil bez kompromisa.');
  $$('.js-primary-cta').forEach(el => el.textContent = s.primaryCtaText || 'Zakaži termin');

  const hero = s.heroImage || '';
  if (hero) $('#heroPhoto').style.backgroundImage = `url("${String(hero).replace(/"/g, '\\"')}")`;
  applyLogo(s.logoImage || '');
  renderMarquee();
  renderServices();
  renderGallery();
  renderBarbers();
  renderBookingChoices();
  initDates();
  updateSummary();
  updateInstallUI();
}

function renderServices() {
  $('#serviceGrid').innerHTML = DATA.services.map((x, i) => `
    <article class="service-card">
      <span class="service-num">${String(i + 1).padStart(2, '0')}</span>
      <h3>${esc(x.name)}</h3><p>${esc(x.description)}</p>
      <div class="service-bottom"><strong>${money(x.price)}</strong><span>${x.duration} min</span></div>
    <button type="button" class="service-book-trigger" data-service-book="${esc(x.id)}">Izaberi uslugu <span>↗</span></button>
    </article>`).join('');
  $$('[data-service-book]').forEach(btn => btn.onclick = () => {
    BOOKING.serviceId = btn.dataset.serviceBook; BOOKING.time = '';
    renderBookingChoices(); updateSummary(); setNextEnabled(1, true);
    location.hash = 'booking'; goStep(BOOKING.barberId ? 2 : 1);
  });
}

function renderGallery() {
  const items = DATA.gallery || [];
  $('#galleryGrid').innerHTML = items.length ? items.map(g => {
    const b = DATA.barbers.find(x => x.id === g.barberId);
    return `<article class="gallery-card" data-gallery="${esc(g.id)}"><img loading="lazy" src="${esc(g.image)}" alt="${esc(g.title || 'Barber rad')}"><div class="gallery-overlay"><span>${b ? esc(b.name.toUpperCase()) : esc((DATA.settings.salonName || 'BARBER').toUpperCase())}</span><strong>${esc(g.title || 'Naš rad')}</strong></div></article>`;
  }).join('') : ''; // The Instagram posts below are the verified gallery source.
  $$('.gallery-card').forEach(c => c.onclick = () => openLightbox(c.dataset.gallery));
}

function renderBarbers() {
  const barbers = DATA.barbers || [];
  const isSingle = barbers.length === 1;
  const section = $('#barbers');
  const title = section?.querySelector('.section-title');
  section?.classList.toggle('single-barber-section', isSingle);
  title?.classList.toggle('single-barber-title', isSingle);
  $('#barberGrid').classList.toggle('single-barber-grid', isSingle);
  $('#barberGrid').innerHTML = barbers.map(x => `<article class="barber-card ${isSingle ? 'single-barber-card' : ''}">
    ${x.photo ? `<div class="barber-photo" style="background-image:url('${esc(x.photo)}')"></div>` : `<div class="barber-avatar-fallback">${esc(x.initials)}</div>`}
    <div class="barber-shade"></div>
    <div class="barber-card-content"><small>${esc((x.role || 'BARBER').toUpperCase())}</small><h3>${esc(x.name)}</h3><p>${esc(x.bio || `${x.workStart || '09:00'}–${x.workEnd || '20:00'}`)}</p><button data-pick-barber="${esc(x.id)}">Zakaži kod ${esc(x.name)} →</button></div>
  </article>`).join('');
  $$('[data-pick-barber]').forEach(btn => btn.onclick = () => {
    BOOKING.barberId = btn.dataset.pickBarber;
    BOOKING.time = '';
    renderBookingChoices();
    updateSummary();
    location.hash = 'booking';
    setTimeout(() => goStep(BOOKING.serviceId ? 2 : 1), 50);
  });
}

function openLightbox(id) {
  const g = DATA.gallery.find(x => x.id === id);
  if (!g) return;
  const b = DATA.barbers.find(x => x.id === g.barberId);
  $('#lightboxImage').src = g.image;
  $('#lightboxTitle').textContent = g.title || 'Naš rad';
  $('#lightboxMeta').textContent = b ? `Barber: ${b.name}` : '';
  $('#lightbox').classList.remove('hidden');
}
$('#lightboxClose').onclick = () => $('#lightbox').classList.add('hidden');
$('#lightbox').addEventListener('click', e => { if (e.target === $('#lightbox')) $('#lightbox').classList.add('hidden'); });

function renderBookingChoices() {
  const singleBarber = DATA.barbers.length === 1;
  if (singleBarber && !BOOKING.barberId) BOOKING.barberId = DATA.barbers[0].id;
  $('#bookingServices').innerHTML = DATA.services.map(s => `<button type="button" class="choice-card service-choice ${BOOKING.serviceId === s.id ? 'selected' : ''}" data-service="${esc(s.id)}"><div><span class="choice-check">✓</span><small>${s.duration} MIN</small><h4>${esc(s.name)}</h4><p>${esc(s.description)}</p></div><strong>${money(s.price)}</strong></button>`).join('');
  $('#bookingBarbers').classList.toggle('single-choice-layout', singleBarber);
  $('#bookingBarbers').innerHTML = (singleBarber ? '' : `<button type="button" class="choice-card barber-choice ${BOOKING.barberId === 'any' ? 'selected' : ''}" data-barber="any"><div class="choice-avatar any">★</div><div><span class="choice-check">✓</span><small>NAJBRŽE</small><h4>Prvi slobodan</h4><p>Sistem bira prvog slobodnog barbera.</p></div></button>`) + DATA.barbers.map(b => `<button type="button" class="choice-card barber-choice ${BOOKING.barberId === b.id ? 'selected' : ''} ${singleBarber ? 'single-barber-choice' : ''}" data-barber="${esc(b.id)}">${b.photo ? `<div class="choice-avatar" style="background-image:url('${esc(b.photo)}')"></div>` : `<div class="choice-avatar" style="background:${esc(b.color)}">${esc(b.initials)}</div>`}<div><span class="choice-check">✓</span><small>${esc(b.role)}</small><h4>${esc(b.name)}</h4><p>${esc(b.workStart || '09:00')}–${esc(b.workEnd || '20:00')}</p></div></button>`).join('');

  $$('.service-choice').forEach(el => el.onclick = () => {
    BOOKING.serviceId = el.dataset.service;
    BOOKING.time = '';
    renderBookingChoices();
    setNextEnabled(1, true);
    updateSummary();
  });
  $$('.barber-choice').forEach(el => el.onclick = () => {
    BOOKING.barberId = el.dataset.barber;
    BOOKING.time = '';
    renderBookingChoices();
    setNextEnabled(2, true);
    updateSummary();
    if (BOOKING.date) refreshSlots();
  });
  setNextEnabled(2, !!BOOKING.barberId);
}

function initDates() {
  const today = new Date();
  $('#dateInput').min = localISO(today);
  const max = new Date(today); max.setDate(max.getDate() + 60);
  $('#dateInput').max = localISO(max);
  if (!BOOKING.date || BOOKING.date < localISO(today)) BOOKING.date = localISO(today);
  $('#dateInput').value = BOOKING.date;
  renderDateStrip();
}

function renderDateStrip() {
  const start = new Date();
  let html = '';
  for (let i = 0; i < 10; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = localISO(d), day = i === 0 ? 'DANAS' : d.toLocaleDateString('sr-RS', { weekday: 'short' }).toUpperCase();
    html += `<button type="button" class="date-chip ${BOOKING.date === iso ? 'selected' : ''}" data-date="${iso}"><small>${day}</small><strong>${d.getDate()}</strong><span>${d.toLocaleDateString('sr-RS', { month: 'short' })}</span></button>`;
  }
  $('#dateStrip').innerHTML = html;
  $$('.date-chip').forEach(b => b.onclick = () => selectDate(b.dataset.date));
}

function selectDate(iso) {
  BOOKING.date = iso;
  BOOKING.time = '';
  $('#dateInput').value = iso;
  renderDateStrip();
  updateSummary();
  refreshSlots();
}

async function refreshSlots({ quiet = false } = {}) {
  if (!BOOKING.serviceId || !BOOKING.barberId || !BOOKING.date) {
    $('#slotState').classList.remove('hidden');
    $('#slotState').textContent = 'Izaberi uslugu, barbera i datum.';
    $('#timeSlots').innerHTML = '';
    return;
  }
  const requestId = ++slotRequestId;
  const selectedBefore = BOOKING.time;
  if (!quiet) {
    $('#slotState').classList.remove('hidden');
    $('#slotState').textContent = 'Tražim slobodne termine...';
    $('#timeSlots').innerHTML = '';
  }
  $('#slotMeta').textContent = quiet ? $('#slotMeta').textContent : '';
  setNextEnabled(3, false);
  try {
    const d = await api(`/api/availability?date=${encodeURIComponent(BOOKING.date)}&serviceId=${encodeURIComponent(BOOKING.serviceId)}&barberId=${encodeURIComponent(BOOKING.barberId)}&tzOffset=${new Date().getTimezoneOffset()}&_=${Date.now()}`);
    if (requestId !== slotRequestId) return;
    const stillAvailable = d.slots.some(x => x.time === selectedBefore);
    if (!stillAvailable) BOOKING.time = '';
    if (!d.slots.length) {
      $('#slotState').classList.remove('hidden');
      $('#slotState').textContent = 'Nema slobodnih termina. Izaberi drugi dan ili barbera.';
      $('#timeSlots').innerHTML = '';
      $('#slotMeta').textContent = '0 slobodnih';
      updateSummary();
      return;
    }
    $('#slotState').classList.add('hidden');
    $('#slotMeta').textContent = `${d.slots.length} slobodnih · uživo`;
    const groups = [
      ['Jutro', d.slots.filter(x => +x.time.slice(0, 2) < 12)],
      ['Popodne', d.slots.filter(x => { const h = +x.time.slice(0, 2); return h >= 12 && h < 17; })],
      ['Veče', d.slots.filter(x => +x.time.slice(0, 2) >= 17)]
    ].filter(x => x[1].length);
    $('#timeSlots').innerHTML = groups.map(([name, slots]) => `<div class="time-group"><span>${name}</span><div class="slot-grid">${slots.map(x => `<button type="button" class="time-slot ${BOOKING.time === x.time ? 'selected' : ''}" data-time="${x.time}" data-barbers="${esc((x.barberIds || []).join(','))}">${x.time}</button>`).join('')}</div></div>`).join('');
    $$('.time-slot').forEach(btn => btn.onclick = () => {
      BOOKING.time = btn.dataset.time;
      BOOKING.availableBarbers = (btn.dataset.barbers || '').split(',').filter(Boolean);
      $$('.time-slot').forEach(x => x.classList.toggle('selected', x === btn));
      setNextEnabled(3, true);
      updateSummary();
    });
    setNextEnabled(3, !!BOOKING.time);
    updateSummary();
  } catch (e) {
    if (requestId !== slotRequestId) return;
    $('#slotState').classList.remove('hidden');
    $('#slotState').textContent = e.message;
  }
}

function activateStep(step, scroll = true) {
  BOOKING.step = step;
  $$('.booking-step-panel').forEach(p => p.classList.toggle('active', +p.dataset.step === step));
  $$('.progress-step').forEach((p, i) => {
    p.classList.toggle('active', i + 1 === step);
    p.classList.toggle('done', i + 1 < step);
  });
  if (scroll) document.querySelector('.booking-shell').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goStep(step) {
  if (step > 1 && !BOOKING.serviceId) return;
  if (step > 2 && !BOOKING.barberId) return;
  if (step > 3 && !BOOKING.time) return;
  activateStep(step, true);
  if (step === 3) refreshSlots();
  manageSlotPolling();
}

function setNextEnabled(step, enabled) {
  const b = document.querySelector(`.booking-step-panel[data-step="${step}"] .wizard-next`);
  if (b) b.disabled = !enabled;
}

$$('.wizard-next').forEach(b => b.onclick = () => goStep(+b.dataset.next));
$$('.wizard-back').forEach(b => b.onclick = () => goStep(+b.dataset.back));
$$('.progress-step').forEach(b => b.onclick = () => {
  const t = +b.dataset.go;
  if (t <= BOOKING.step || (t === 2 && BOOKING.serviceId) || (t === 3 && BOOKING.serviceId && BOOKING.barberId) || (t === 4 && BOOKING.time)) goStep(t);
});
$('#dateInput').addEventListener('change', e => selectDate(e.target.value));

function updateSummary() {
  const s = selectedService(), b = selectedBarber(), has = !!s;
  $('#summaryEmpty').classList.toggle('hidden', has);
  $('#summaryContent').classList.toggle('hidden', !has);
  if (!has) { $('#summaryReady').textContent = 'Nije završeno'; return; }
  $('#summaryService').textContent = s.name;
  $('#summaryDuration').textContent = `${s.duration} min`;
  $('#summaryPrice').textContent = money(s.price);
  $('#summaryBarber').textContent = BOOKING.barberId === 'any' ? 'Prvi slobodan' : (b?.name || '—');
  $('#summaryDate').textContent = BOOKING.date ? humanDate(BOOKING.date) : '—';
  $('#summaryTime').textContent = BOOKING.time || '—';
  const ready = BOOKING.serviceId && BOOKING.barberId && BOOKING.date && BOOKING.time;
  $('#summaryReady').textContent = ready ? 'Spremno' : 'Nije završeno';
  $('#summaryReady').classList.toggle('ready', !!ready);
}

$('#bookingForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!API_AVAILABLE) { alert('Online zakazivanje nije dostupno. Pozovite salon.'); return; }
  const btn = e.currentTarget.querySelector('.confirm-btn'), msg = $('#formMsg');
  msg.textContent = '';
  if (!BOOKING.serviceId || !BOOKING.barberId || !BOOKING.date || !BOOKING.time) { msg.textContent = 'Izaberi kompletan termin.'; return; }
  btn.disabled = true;
  btn.textContent = 'Rezervišem...';
  try {
    const payload = {
      serviceId: BOOKING.serviceId, barberId: BOOKING.barberId, date: BOOKING.date, time: BOOKING.time,
      name: $('#nameInput').value, phone: $('#phoneInput').value, note: $('#noteInput').value,
      tzOffset: new Date().getTimezoneOffset(), website:document.querySelector('input[name=website]')?.value||''
    };
    const d = await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
    $('#successText').textContent = `${d.booking.name}, tvoj termin je sačuvan.`;
    $('#successDetails').innerHTML = `<div><span>DATUM</span><strong>${humanDate(d.booking.date)}</strong></div><div><span>VREME</span><strong>${d.booking.time}–${endTime(d.booking.time, d.booking.duration)}</strong></div><div><span>BARBER</span><strong>${esc(d.booking.barberName)}</strong></div><div><span>USLUGA</span><strong>${esc(d.booking.serviceName)}</strong></div>`;
    const successPhone = document.getElementById('successPhoneLink'); if (successPhone) successPhone.href = `tel:${String((DATA.settings.phone || '')).replace(/[^+\d]/g,'')}`;
    resetBooking(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('#successModal').classList.remove('hidden'), 180);
  } catch (err) {
    msg.textContent = err.message;
    await refreshSlots();
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Rezerviši termin <span>↗</span>';
  }
});

function resetBooking(scroll = false) {
  BOOKING = { step: 1, serviceId: '', barberId: '', date: localISO(), time: '', availableBarbers: [] };
  $('#bookingForm').reset();
  $('#dateInput').value = BOOKING.date;
  renderBookingChoices();
  renderDateStrip();
  updateSummary();
  setNextEnabled(1, false); setNextEnabled(2, false); setNextEnabled(3, false);
  activateStep(1, scroll);
  manageSlotPolling();
}

$('#successClose').onclick = () => { $('#successModal').classList.add('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
$('#successModal').addEventListener('click', e => { if (e.target === $('#successModal')) { $('#successModal').classList.add('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); } });

function manageSlotPolling() {
  clearInterval(slotRefreshTimer);
  slotRefreshTimer = null;
  if (BOOKING.step === 3) slotRefreshTimer = setInterval(() => refreshSlots({ quiet: true }), 15000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && BOOKING.step === 3) refreshSlots({ quiet: true });
});

function connectLiveEvents() {
  // Slot polling already refreshes every 15 seconds while selecting a booking.
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  updateInstallUI();
});
function isStandalone() { return matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function updateInstallUI() {
  const installed = isStandalone();
  const banner = $('#mobileInstallBanner');
  if (banner) banner.classList.toggle('hidden', installed || safeSessionRead('barber:hideInstall')==='1');
  if (installed) $$('.js-install').forEach(b => { b.textContent = '✓ Instalirano'; b.disabled = true; });
}
async function tryInstall() {
  if (isStandalone()) { showInstallHelp('Aplikacija je već instalirana na ovom telefonu.'); return; }
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  showInstallHelp(ios ? 'Na iPhone-u otvori Share meni u Safari-ju i izaberi „Add to Home Screen“ / „Dodaj na početni ekran“.' : 'Otvori meni browsera (⋮) i izaberi „Install app“ ili „Add to Home screen“.');
}
function showInstallHelp(text) { $('#installHelp').textContent = text; $('#installModal').classList.remove('hidden'); }
$$('.js-install').forEach(b => b.onclick = tryInstall);
$('#dismissInstallBanner').onclick=()=>{safeSessionWrite('barber:hideInstall','1');$('#mobileInstallBanner').classList.add('hidden');};
$('#installTry').onclick = tryInstall;
$('#installClose').onclick = () => $('#installModal').classList.add('hidden');
$('#installModal').addEventListener('click', e => { if (e.target === $('#installModal')) $('#installModal').classList.add('hidden'); });
window.addEventListener('appinstalled', () => {
  $('#installModal').classList.add('hidden');
  $$('.js-install').forEach(b => { b.textContent = '✓ Aplikacija instalirana'; b.disabled = true; });
  updateInstallUI();
});

// Fast-lane discovery uses the same server-side availability rules as normal booking.
$('#findFastSlots').addEventListener('click', async () => {
  const btn=$('#findFastSlots'), results=$('#fastSlotResults');
  if(!BOOKING.serviceId||!BOOKING.barberId){results.classList.remove('hidden');results.textContent='Prvo izaberi uslugu i barbera.';return;}
  btn.disabled=true;btn.textContent='Tražim...';
  results.classList.remove('hidden');results.textContent='Pretražujem slobodne termine...';
  try {
    const currentService=BOOKING.serviceId,currentBarber=BOOKING.barberId;
    const r=await api(`/api/next-available?serviceId=${encodeURIComponent(currentService)}&barberId=${encodeURIComponent(currentBarber)}`);
    if(currentService!==BOOKING.serviceId||currentBarber!==BOOKING.barberId){results.classList.add('hidden');return;}
    if(!r.slots.length){results.textContent='Nema slobodnih termina u narednih 21 dan. Probaj drugog barbera.';return;}
    results.innerHTML=`<small>NAJBRŽI TERMINI</small><div>${r.slots.map(x=>`<button type="button" data-fast-date="${x.date}" data-fast-time="${x.time}"><strong>${humanDate(x.date)}</strong><span>${x.time} ↗</span></button>`).join('')}</div>`;
    results.querySelectorAll('[data-fast-date]').forEach(el=>el.onclick=async()=>{
      BOOKING.date=el.dataset.fastDate;BOOKING.time=el.dataset.fastTime;
      $('#dateInput').value=BOOKING.date;
      renderDateStrip();updateSummary();
      await refreshSlots();
      const slot=[...$$('.time-slot')].find(x=>x.dataset.time===BOOKING.time);
      if(slot){slot.click();slot.scrollIntoView({behavior:'smooth',block:'center'});}
      else {results.textContent='Termin je u međuvremenu zauzet. Pronađi drugi.';}
    });
  }catch(e){results.textContent=e.message;}
  finally{btn.disabled=false;btn.textContent='Pronađi ↗';}
});

// Semantic escape-to-close dialogs and keyboard access.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  for(const id of ['successModal','installModal','lightbox'])$('#'+id)?.classList.add('hidden');
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
connectLiveEvents();
load().catch(e => console.error(e));
