let STATE = { metrics: {}, bookings: [], settings: {}, services: [], barbers: [], gallery: [], blackouts: [] };
let modalState = null;
let calendarDate = localISO();
let mobileCalendarBarberId = '';
let selectedCalendarBookingId = '';
let liveReloadTimer = null;
let resizeTimer = null;
let liveReloadPending = false;
let canChangePassword = true;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const statusNames = { pending: 'Na čekanju', confirmed: 'Potvrđeno', completed: 'Završeno', cancelled: 'Otkazano' };
const barberColors = ['#d8a45d', '#7f9c8d', '#b57966', '#7890a8', '#b493c4', '#8d9869', '#c17d4a'];

function localISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function money(n) { return new Intl.NumberFormat('sr-RS').format(n || 0) + ' ' + (STATE.settings.currency || 'RSD'); }
function endTime(t, d) {
  let [h, m] = t.split(':').map(Number), x = h * 60 + m + Number(d || 0);
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}
function timeToMinutes(t) { const [h, m] = String(t || '00:00').split(':').map(Number); return h * 60 + m; }

async function api(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  let j;
  try { j = await r.json(); } catch {
    throw new Error('Admin API nije dostupan. Objavite ceo projekat preko Git-a ili Netlify CLI-ja; samo public folder nije dovoljan.');
  }
  if (!r.ok) throw new Error(j.error || 'Server nije dostupan. Proverite Netlify Functions i podešavanja baze.');
  return j;
}
function fileData(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
}
async function uploadImage(file) {
  if (!file) return '';
  if (file.size > 6 * 1024 * 1024) throw new Error('Slika mora biti manja od 6 MB.');
  const data = await fileData(file);
  const d = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ data }) });
  return d.url;
}
async function bindUpload(fileSelector, hiddenName, previewSelector, statusSelector) {
  const input = $(fileSelector);
  if (!input) return;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const status = $(statusSelector);
    try {
      if (status) status.textContent = 'Uploadujem sliku...';
      const url = await uploadImage(file);
      const hidden = document.querySelector(`[name="${hiddenName}"]`);
      if (hidden) hidden.value = url;
      const preview = $(previewSelector);
      if (preview) preview.style.backgroundImage = `url('${url}')`;
      if (status) status.textContent = '✓ Slika je uploadovana.';
    } catch (e) {
      if (status) status.textContent = e.message;
      input.value = '';
    }
  };
}

async function init() {
  const s = await api('/api/admin/session');
  canChangePassword = s.canChangePassword !== false;
  if (s.authenticated && s.mustChangePassword) showPasswordSetup();
  else if (s.authenticated) { showApp(); await loadData(); connectLiveEvents(); }
  else $('#loginView').classList.remove('hidden');
}
function showApp() { $('#loginView').classList.add('hidden'); $('#app').classList.remove('hidden'); }
function showPasswordSetup() { $('#loginView').classList.add('hidden'); $('#app').classList.add('hidden'); $('#passwordSetupView').classList.remove('hidden'); }
async function startAdminApp() { $('#passwordSetupView').classList.add('hidden'); showApp(); $('#passwordChangeForm').classList.toggle('hidden', !canChangePassword); $('#passwordManagedMsg').classList.toggle('hidden', canChangePassword); await loadData(); connectLiveEvents(); }

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#loginMsg').textContent = '';
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: $('#loginUser').value, password: $('#loginPass').value }) });
    canChangePassword = result.canChangePassword !== false;
    if (result.mustChangePassword) showPasswordSetup();
    else await startAdminApp();
  } catch (err) { $('#loginMsg').textContent = err.message; }
});
$('#logoutBtn').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); });
$('#setupLogout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); };
$('#passwordSetupForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#passwordSetupMsg').textContent = '';
  if ($('#setupPassword').value !== $('#setupPasswordConfirm').value) { $('#passwordSetupMsg').textContent = 'Lozinke se ne poklapaju.'; return; }
  try {
    await api('/api/admin/password-change', { method:'POST', body:JSON.stringify({ newPassword:$('#setupPassword').value }) });
    await startAdminApp();
  } catch (err) { $('#passwordSetupMsg').textContent = err.message; }
});
$('#passwordChangeForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#passwordChangeMsg').textContent = '';
  try {
    await api('/api/admin/password-change', { method:'POST', body:JSON.stringify({ currentPassword:$('#currentPassword').value, newPassword:$('#newPassword').value }) });
    e.currentTarget.reset(); $('#passwordChangeMsg').textContent = 'Lozinka je promenjena.';
  } catch (err) { $('#passwordChangeMsg').textContent = err.message; }
});

async function loadData() {
  STATE = await api('/api/admin/dashboard?_=' + Date.now());
  STATE.gallery = STATE.gallery || [];
  STATE.blackouts = STATE.blackouts || [];
  STATE.barbers = STATE.barbers.map((b, i) => ({ ...b, color: b.color || barberColors[i % barberColors.length], photo: b.photo || '', bio: b.bio || '' }));
  document.documentElement.style.setProperty('--accent', STATE.settings.accent || '#d8a45d');
  renderAll();
}
function renderAll() {
  const m = STATE.metrics;
  $('#mToday').textContent = m.todayBookings;
  $('#mTotal').textContent = m.totalBookings;
  $('#mMonth').textContent = money(m.monthRevenue);
  $('#mProfit').textContent = money(m.monthProfit);
  const counts = {}; STATE.bookings.forEach(b => counts[b.serviceName] = (counts[b.serviceName] || 0) + 1);
  $('#mTopService').textContent = Object.keys(counts).length ? Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0] : '—';
  $('#recentBookings').innerHTML = bookingTable(STATE.bookings.slice(0, 6), false);
  renderBookings(); renderServices(); renderBarbers(); renderGallery(); fillSettings(); renderCalendar(); renderTodaySchedule(); renderBlackouts(); renderActivity();
  $('#today').textContent = new Date().toLocaleDateString('sr-RS', { weekday: 'short', day: '2-digit', month: 'short' });
}

function bookingTable(items, editable = true) {
  if (!items.length) return '<div class="empty">Još nema zakazivanja.</div>';
  return `<div class="table-wrap"><table class="booking-table"><thead><tr><th>KLIJENT</th><th>USLUGA</th><th>BARBER</th><th>DATUM</th><th>VREME</th><th>CENA</th><th>STATUS</th>${editable ? '<th>AKCIJE</th>' : ''}</tr></thead><tbody>${items.map(b => `<tr><td><strong>${esc(b.name)}</strong><br><small>${esc(b.phone)}</small>${b.code?`<br><small class="booking-code">KOD: ${esc(b.code)}</small>`:''}</td><td>${esc(b.serviceName)}</td><td><span class="barber-color" style="background:${getBarber(b.barberId)?.color || '#777'}"></span>${esc(b.barberName)}</td><td>${esc(b.date)}</td><td>${esc(b.time)}–${endTime(b.time, b.duration)}</td><td>${money(b.price)}</td><td><span class="badge ${b.status}">${statusNames[b.status]}</span></td>${editable ? `<td><button class="icon-btn" onclick="editBooking('${b.id}')">Uredi</button> <button class="icon-btn danger" onclick="deleteBooking('${b.id}')">×</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function renderBookings() {
  const q = $('#bookingSearch')?.value.toLowerCase() || '', status = $('#statusFilter')?.value || '';
  const arr = STATE.bookings.filter(b => (!status || b.status === status) && (!q || (b.name + b.phone + b.serviceName + b.barberName).toLowerCase().includes(q)));
  $('#allBookings').innerHTML = bookingTable(arr, true);
}
$('#bookingSearch').addEventListener('input', renderBookings);
$('#statusFilter').addEventListener('change', renderBookings);
async function deleteBooking(id) {
  if (!confirm('Obrisati ovaj termin? Ova akcija se ne može poništiti.')) return;
  try {
    await api(`/api/admin/bookings/${id}`, { method: 'DELETE' });
    selectedCalendarBookingId = '';
    if (modalState?.type === 'booking' && modalState.id === id) {
      $('#modal').classList.add('hidden');
      modalState = null;
      liveReloadPending = false;
    }
    await loadData();
  } catch (err) { alert(err.message); }
}
window.deleteBooking = deleteBooking;
function getBarber(id) { return STATE.barbers.find(x => x.id === id); }

function renderServices() {
  $('#serviceAdmin').innerHTML = STATE.services.map(x => `<article class="admin-card"><div class="top"><div><h3>${esc(x.name)}</h3><p>${esc(x.description)}</p></div><span class="dot ${x.active ? '' : 'off'}"></span></div><div class="meta"><span>${x.duration} min</span><span>${money(x.price)}</span><span>Trošak ${money(x.cost || 0)}</span><span>${x.active ? 'Aktivna' : 'Skrivena'}</span></div><div class="actions"><button onclick="editService('${x.id}')">Uredi</button><button onclick="removeService('${x.id}')">Obriši</button></div></article>`).join('');
}
function renderBarbers() {
  const dn = ['Ned', 'Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub'];
  $('#barberAdmin').innerHTML = STATE.barbers.map(x => {
    const days = (x.workDays?.length ? x.workDays : [1, 2, 3, 4, 5, 6]).map(d => dn[d]).join(', ');
    return `<article class="barber-admin-card"><div class="barber-admin-photo" style="${x.photo ? `background-image:url('${esc(x.photo)}')` : `background:linear-gradient(135deg,${x.color}55,#191512)`}"></div><div class="barber-admin-body"><h3><span class="barber-color" style="background:${x.color}"></span>${esc(x.name)}</h3><p>${esc(x.role)} · ${esc(x.bio || 'Bez opisa')}</p><div class="barber-meta"><span>${esc(x.workStart || '09:00')}–${esc(x.workEnd || '20:00')}</span><span>${days}</span><span>${x.active ? 'Aktivan' : 'Skriven'}</span></div><div class="barber-actions"><button onclick="editBarber('${x.id}')">Uredi</button><button onclick="removeBarber('${x.id}')">Obriši</button></div></div></article>`;
  }).join('');
}
function renderGallery() {
  const grid = $('#galleryAdmin');
  if (!STATE.gallery.length) { grid.innerHTML = '<div class="empty">Nema slika. Klikni „Dodaj sliku“ i ubaci prvi fade.</div>'; return; }
  grid.innerHTML = STATE.gallery.map(g => {
    const b = getBarber(g.barberId);
    return `<article class="gallery-admin-card"><img src="${esc(g.image)}" alt="${esc(g.title)}"><div><h3>${esc(g.title || 'Naš rad')}</h3><p>${b ? esc(b.name) : 'Bez barbera'} · ${g.active ? 'Objavljeno' : 'Skriveno'}</p><div class="actions"><button onclick="editGallery('${g.id}')">Uredi</button><button onclick="removeGallery('${g.id}')">Obriši</button></div></div></article>`;
  }).join('');
}

function fillSettings() {
  const f = $('#settingsForm');
  for (const [k, v] of Object.entries(STATE.settings)) if (f.elements[k]) f.elements[k].value = v || '';
  const hero = STATE.settings.heroImage || '';
  $('#heroPreview').style.backgroundImage = hero ? `url('${hero}')` : '';
  const logo = STATE.settings.logoImage || '';
  $('#logoPreview').style.backgroundImage = logo ? `url('${logo}')` : '';
  $('#logoPreview').classList.toggle('has-logo', !!logo);
  $('#logoPreview span').textContent = (STATE.settings.salonName || 'N').charAt(0).toUpperCase();
}
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget));
  await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(data) });
  $('#settingsMsg').textContent = '✓ Izmene su sačuvane i odmah su aktivne na sajtu.';
  await loadData();
  setTimeout(() => $('#settingsMsg').textContent = '', 2200);
});
$('#heroUpload').addEventListener('change', async e => {
  const f = e.target.files?.[0]; if (!f) return;
  $('#settingsMsg').textContent = 'Uploadujem hero sliku...';
  try {
    const url = await uploadImage(f); $('#settingsForm').elements.heroImage.value = url; $('#heroPreview').style.backgroundImage = `url('${url}')`;
    $('#settingsMsg').textContent = '✓ Hero slika je spremna. Klikni „Sačuvaj izmene“.';
  } catch (err) { $('#settingsMsg').textContent = err.message; }
});
$('#logoUpload').addEventListener('change', async e => {
  const f = e.target.files?.[0]; if (!f) return;
  $('#settingsMsg').textContent = 'Uploadujem logo...';
  try {
    const url = await uploadImage(f); $('#settingsForm').elements.logoImage.value = url; $('#logoPreview').style.backgroundImage = `url('${url}')`; $('#logoPreview').classList.add('has-logo');
    $('#settingsMsg').textContent = '✓ Logo je spreman. Klikni „Sačuvaj izmene“.';
  } catch (err) { $('#settingsMsg').textContent = err.message; }
});

function renderTodaySchedule() {
  const today = localISO(), list = STATE.bookings.filter(b => b.date === today && b.status !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time));
  $('#todaySchedule').innerHTML = list.length ? `<div class="today-strip">${list.map(b => `<div class="today-card" style="--worker:${getBarber(b.barberId)?.color || '#777'}"><time>${b.time}–${endTime(b.time, b.duration)}</time><strong>${esc(b.name)} · ${esc(b.barberName)}</strong><small>${esc(b.serviceName)}</small></div>`).join('')}</div>` : '<div class="empty">Danas nema zakazanih termina.</div>';
}

function calendarRange(barbers) {
  const starts = barbers.map(b => timeToMinutes(b.workStart || '09:00'));
  const ends = barbers.map(b => timeToMinutes(b.workEnd || '20:00'));
  return { start: Math.max(0, Math.floor(Math.min(...starts) / 60) - 1), end: Math.min(24, Math.ceil(Math.max(...ends) / 60) + 1) };
}
function barberWorksToday(b) {
  const days = (b.workDays?.length ? b.workDays : [1, 2, 3, 4, 5, 6]).map(Number);
  const scheduled=days.includes(new Date(calendarDate + 'T12:00:00').getDay());
  const blocked=STATE.blackouts.some(x=>x.dateFrom<=calendarDate&&calendarDate<=x.dateTo&&(!x.barberId||x.barberId===b.id));
  return scheduled&&!blocked;
}

function renderCalendar() {
  if (!$('#calendarGrid')) return;
  $('#calendarDate').value = calendarDate;
  const barbers = STATE.barbers.filter(b => b.active);
  $('#barberLegend').innerHTML = barbers.map(b => `<div class="legend-item"><i class="legend-dot" style="background:${b.color}"></i>${esc(b.name)}</div>`).join('');
  if (!barbers.length) { $('#calendarGrid').innerHTML = '<div class="empty">Dodaj aktivnog barbera da bi kalendar radio.</div>'; return; }
  if (window.matchMedia('(max-width:760px)').matches) { renderMobileCalendar(barbers); return; }

  const { start, end } = calendarRange(barbers), hourH = 68;
  let html = `<div class="cal-grid" data-start="${start}" data-hourh="${hourH}" style="grid-template-columns:68px repeat(${barbers.length},minmax(210px,1fr))"><div class="cal-head time-head">Vreme</div>${barbers.map(b => `<div class="cal-head" style="box-shadow:inset 0 -3px ${b.color}"><strong>${esc(b.name)}</strong><small>${esc(b.workStart || '09:00')}–${esc(b.workEnd || '20:00')}</small></div>`).join('')}`;
  for (let h = start; h < end; h++) html += `<div class="time-cell" style="grid-column:1;grid-row:${h - start + 2}">${String(h).padStart(2, '0')}:00</div>`;
  barbers.forEach((b, idx) => {
    const works = barberWorksToday(b);
    html += `<div class="barber-col ${works ? '' : 'day-off'}" data-barber="${b.id}" data-start="${start}" data-hourh="${hourH}" style="grid-column:${idx + 2};grid-row:2 / span ${end - start};min-height:${(end - start) * hourH}px"><div class="half-lines"></div>${works ? '' : '<div class="day-off-label">NERADNI DAN</div>'}`;
    const items = STATE.bookings.filter(x => x.date === calendarDate && x.barberId === b.id);
    for (const a of items) {
      const mins = timeToMinutes(a.time) - start * 60;
      if (mins < 0 || mins >= (end - start) * 60) continue;
      const top = mins / 60 * hourH, height = Math.max(34, Number(a.duration || 30) / 60 * hourH - 4);
      html += `<div class="cal-booking ${a.status === 'cancelled' ? 'cancelled' : ''}" data-booking="${a.id}" style="top:${top}px;height:${height}px;background:${b.color}"><strong>${esc(a.time)}–${esc(endTime(a.time, a.duration))} · ${esc(a.name)}</strong><span>${esc(a.serviceName)} · ${statusNames[a.status]}</span></div>`;
    }
    html += '</div>';
  });
  html += '</div>';
  $('#calendarGrid').innerHTML = html;
}

function renderMobileCalendar(barbers) {
  if (!barbers.some(b => b.id === mobileCalendarBarberId)) mobileCalendarBarberId = barbers[0].id;
  const b = barbers.find(x => x.id === mobileCalendarBarberId) || barbers[0];
  const { start, end } = calendarRange(barbers), hourH = 72, height = (end - start) * hourH;
  const works = barberWorksToday(b);
  const items = STATE.bookings.filter(x => x.date === calendarDate && x.barberId === b.id);
  if (!items.some(x => x.id === selectedCalendarBookingId)) selectedCalendarBookingId = '';
  const selectedBooking = items.find(x => x.id === selectedCalendarBookingId);
  let lines = '', labels = '';
  for (let h = start; h <= end; h++) {
    const y = (h - start) * hourH;
    lines += `<i class="mobile-hour-line" style="top:${y}px"></i>`;
    if (h < end) labels += `<span style="top:${y + 4}px">${String(h).padStart(2, '0')}:00</span>`;
  }
  const cards = items.map(a => {
    const mins = timeToMinutes(a.time) - start * 60;
    const top = mins / 60 * hourH, h = Math.max(48, Number(a.duration || 30) / 60 * hourH - 4);
    return `<button type="button" class="mobile-cal-booking ${a.status === 'cancelled' ? 'cancelled' : ''} ${a.id === selectedCalendarBookingId ? 'selected' : ''}" data-booking="${a.id}" aria-pressed="${a.id === selectedCalendarBookingId}" style="top:${top}px;height:${h}px;background:${b.color}"><strong>${esc(a.time)}–${esc(endTime(a.time, a.duration))} · ${esc(a.name)}</strong><span>${esc(a.serviceName)} · ${statusNames[a.status]}</span></button>`;
  }).join('');
  const actions = selectedBooking ? `<div class="mobile-selected-actions"><strong>${esc(selectedBooking.time)} · ${esc(selectedBooking.name)}</strong><div><button type="button" data-mobile-booking-action="edit" data-booking="${selectedBooking.id}">Uredi</button><button type="button" class="delete" data-mobile-booking-action="delete" data-booking="${selectedBooking.id}">Obriši</button></div></div>` : '<div class="mobile-selected-hint">Dodirni termin da ga označiš i obrišeš.</div>';
  $('#calendarGrid').innerHTML = `<div class="mobile-calendar"><div class="mobile-barber-tabs">${barbers.map(x => `<button type="button" class="mobile-barber-tab ${x.id === b.id ? 'active' : ''}" data-mobile-barber="${x.id}" style="--worker:${x.color}"><i></i><span>${esc(x.name)}</span><small>${esc(x.workStart || '09:00')}–${esc(x.workEnd || '20:00')}</small></button>`).join('')}</div>${actions}<div class="mobile-calendar-day"><div class="mobile-time-labels" style="height:${height}px">${labels}</div><div class="mobile-worker-timeline ${works ? '' : 'day-off'}" data-barber="${b.id}" data-start="${start}" data-hourh="${hourH}" style="height:${height}px">${lines}${cards}${works ? '' : '<div class="mobile-off-overlay">NERADNI DAN</div>'}</div></div><div class="mobile-cal-help">Dodirni prazno vreme da dodaš termin. Termin se pojavljuje ovde odmah kada klijent rezerviše.</div></div>`;
}

function shiftDate(days) {
  const d = new Date(calendarDate + 'T12:00:00'); d.setDate(d.getDate() + days); calendarDate = localISO(d); renderCalendar();
}
$('#prevDay').onclick = () => shiftDate(-1);
$('#nextDay').onclick = () => shiftDate(1);
$('#todayBtn').onclick = () => { calendarDate = localISO(); renderCalendar(); };
$('#calendarDate').onchange = e => { calendarDate = e.target.value; renderCalendar(); };

function openModal(type, obj = {}) {
  modalState = { type, id: obj.id }; $('#modal').classList.remove('hidden'); $('#modalError').textContent = '';
  $('#modalKicker').textContent = type === 'gallery' ? 'GALERIJA' : type === 'barber' ? 'TIM' : 'USLUGE';
  if (type === 'service') {
    $('#modalTitle').textContent = obj.id ? 'Uredi uslugu' : 'Nova usluga';
    $('#modalFields').innerHTML = `<label class="wide">Naziv<input name="name" value="${esc(obj.name || '')}" required></label><label class="wide">Opis<textarea name="description">${esc(obj.description || '')}</textarea></label><label>Trajanje (min)<input name="duration" type="number" min="15" value="${obj.duration || 30}" required></label><label>Cena<input name="price" type="number" min="0" value="${obj.price || 0}" required></label><label>Trošak<input name="cost" type="number" min="0" value="${obj.cost || 0}"></label><label>Aktivna<select name="active"><option value="true" ${obj.active !== false ? 'selected' : ''}>Da</option><option value="false" ${obj.active === false ? 'selected' : ''}>Ne</option></select></label>`;
  } else if (type === 'barber') {
    const color = obj.color || barberColors[STATE.barbers.length % barberColors.length], days = obj.workDays?.length ? obj.workDays.map(Number) : [1, 2, 3, 4, 5, 6], dn = [[1, 'Pon'], [2, 'Uto'], [3, 'Sre'], [4, 'Čet'], [5, 'Pet'], [6, 'Sub'], [0, 'Ned']];
    $('#modalTitle').textContent = obj.id ? 'Uredi barbera' : 'Novi barber';
    $('#modalFields').innerHTML = `<div class="upload-field"><span>FOTOGRAFIJA BARBERA</span><div id="barberPhotoPreview" class="upload-preview" style="${obj.photo ? `background-image:url('${esc(obj.photo)}')` : ''}"></div><input type="hidden" name="photo" value="${esc(obj.photo || '')}"><label>📷 Izaberi fotografiju<input id="barberPhotoFile" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><div id="barberUploadStatus" class="upload-status"></div></div><label class="wide">Ime<input name="name" value="${esc(obj.name || '')}" required></label><label>Uloga<input name="role" value="${esc(obj.role || 'Barber')}"></label><label>Inicijali<input name="initials" maxlength="3" value="${esc(obj.initials || '')}"></label><label class="wide">Kratak opis<input name="bio" value="${esc(obj.bio || '')}" placeholder="Npr. Skin fade, crop i clean lines"></label><label>Boja u kalendaru<input name="color" type="color" value="${color}"></label><label>Početak smene<input name="workStart" type="time" value="${obj.workStart || '09:00'}"></label><label>Kraj smene<input name="workEnd" type="time" value="${obj.workEnd || '20:00'}"></label><label>Aktivan<select name="active"><option value="true" ${obj.active !== false ? 'selected' : ''}>Da</option><option value="false" ${obj.active === false ? 'selected' : ''}>Ne</option></select></label><div class="wide work-days-field"><span>Radni dani</span><div class="work-days">${dn.map(([v, n]) => `<label><input type="checkbox" name="workDays" value="${v}" ${days.includes(v) ? 'checked' : ''}><b>${n}</b></label>`).join('')}</div></div>`;
    bindUpload('#barberPhotoFile', 'photo', '#barberPhotoPreview', '#barberUploadStatus');
  } else if (type === 'gallery') {
    const barberId = obj.barberId || '';
    $('#modalTitle').textContent = obj.id ? 'Uredi sliku' : 'Dodaj rad';
    $('#modalFields').innerHTML = `<div class="upload-field"><span>FADE / RAD FOTOGRAFIJA</span><div id="galleryImagePreview" class="upload-preview" style="${obj.image ? `background-image:url('${esc(obj.image)}')` : ''}"></div><input type="hidden" name="image" value="${esc(obj.image || '')}"><label>📷 Fotografija sa telefona<input id="galleryImageFile" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><div id="galleryUploadStatus" class="upload-status"></div></div><label class="wide">Naslov<input name="title" value="${esc(obj.title || '')}" placeholder="Skin Fade"></label><label class="wide">Opis<input name="caption" value="${esc(obj.caption || '')}" placeholder="Kratak opis rada"></label><label>Barber<select name="barberId"><option value="">Bez oznake</option>${STATE.barbers.map(b => `<option value="${b.id}" ${b.id === barberId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><label>Objavljeno<select name="active"><option value="true" ${obj.active !== false ? 'selected' : ''}>Da</option><option value="false" ${obj.active === false ? 'selected' : ''}>Ne</option></select></label>`;
    bindUpload('#galleryImageFile', 'image', '#galleryImagePreview', '#galleryUploadStatus');
  }
}

function openBookingModal(obj = {}) {
  modalState = { type: 'booking', id: obj.id }; $('#modal').classList.remove('hidden'); $('#modalError').textContent = '';
  $('#deleteModalBooking').classList.toggle('hidden', !obj.id);
  $('#modalKicker').textContent = 'TERMIN'; $('#modalTitle').textContent = obj.id ? 'Uredi termin' : 'Novi termin';
  const barberId = obj.barberId || STATE.barbers.find(b => b.active)?.id || '', serviceId = obj.serviceId || STATE.services.find(s => s.active)?.id || '';
  $('#modalFields').innerHTML = `<label>Klijent<input name="name" value="${esc(obj.name || '')}" required></label><label>Telefon<input name="phone" value="${esc(obj.phone || '')}" required></label><label>Datum<input name="date" type="date" value="${obj.date || calendarDate}" required></label><label>Vreme<input name="time" type="time" step="900" value="${obj.time || '09:00'}" required></label><label>Barber<select name="barberId">${STATE.barbers.filter(b => b.active || b.id === barberId).map(b => `<option value="${b.id}" ${b.id === barberId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><label>Usluga<select name="serviceId">${STATE.services.filter(s => s.active || s.id === serviceId).map(s => `<option value="${s.id}" ${s.id === serviceId ? 'selected' : ''}>${esc(s.name)} · ${s.duration} min</option>`).join('')}</select></label><label>Status<select name="status">${Object.entries(statusNames).map(([k, v]) => `<option value="${k}" ${k === (obj.status || 'confirmed') ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="wide">Napomena<textarea name="note">${esc(obj.note || '')}</textarea></label>`;
}

function closeModal() {
  $('#modal').classList.add('hidden');
  modalState = null;
  if (liveReloadPending) {
    liveReloadPending = false;
    loadData().catch(() => {});
  }
}
$('#closeModal').onclick = closeModal;
$('#deleteModalBooking').onclick = () => {
  if (modalState?.type === 'booking' && modalState.id) deleteBooking(modalState.id);
};
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
$('#modalForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget), raw = Object.fromEntries(fd);
  try {
    if (modalState.type === 'service') {
      const body = { ...raw, duration: +raw.duration, price: +raw.price, cost: +raw.cost, active: raw.active === 'true' };
      await api(modalState.id ? `/api/admin/services/${modalState.id}` : '/api/admin/services', { method: modalState.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    } else if (modalState.type === 'barber') {
      const body = { ...raw, workDays: fd.getAll('workDays').map(Number), active: raw.active === 'true' };
      await api(modalState.id ? `/api/admin/barbers/${modalState.id}` : '/api/admin/barbers', { method: modalState.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    } else if (modalState.type === 'gallery') {
      const body = { ...raw, active: raw.active === 'true' };
      await api(modalState.id ? `/api/admin/gallery/${modalState.id}` : '/api/admin/gallery', { method: modalState.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    } else {
      await api(modalState.id ? `/api/admin/bookings/${modalState.id}` : '/api/admin/bookings', { method: modalState.id ? 'PUT' : 'POST', body: JSON.stringify(raw) });
    }
    $('#modal').classList.add('hidden'); modalState = null; await loadData();
  } catch (err) { $('#modalError').textContent = err.message; }
});

$('#addService').onclick = () => openModal('service', { active: true });
$('#addBarber').onclick = () => openModal('barber', { active: true });
$('#addGallery').onclick = () => openModal('gallery', { active: true });
$('#newBooking').onclick = () => openBookingModal({ date: calendarDate, status: 'confirmed' });
$('#headerNewBooking').onclick = () => openBookingModal({ date: calendarDate, status: 'confirmed' });
$('#dashNewBooking').onclick = () => openBookingModal({ date: calendarDate, status: 'confirmed' });
window.editService = id => openModal('service', STATE.services.find(x => x.id === id));
window.editBarber = id => openModal('barber', STATE.barbers.find(x => x.id === id));
window.editGallery = id => openModal('gallery', STATE.gallery.find(x => x.id === id));
window.editBooking = id => openBookingModal(STATE.bookings.find(x => x.id === id));
window.removeService = async id => { if (confirm('Obrisati uslugu?')) { await api(`/api/admin/services/${id}`, { method: 'DELETE' }); await loadData(); } };
window.removeBarber = async id => { if (confirm('Obrisati barbera?')) { await api(`/api/admin/barbers/${id}`, { method: 'DELETE' }); await loadData(); } };
window.removeGallery = async id => { if (confirm('Obrisati ovu sliku iz galerije?')) { await api(`/api/admin/gallery/${id}`, { method: 'DELETE' }); await loadData(); } };

$('#calendarGrid').addEventListener('click', e => {
  const mobileAction = e.target.closest('[data-mobile-booking-action]');
  if (mobileAction) {
    if (mobileAction.dataset.mobileBookingAction === 'edit') editBooking(mobileAction.dataset.booking);
    else deleteBooking(mobileAction.dataset.booking);
    return;
  }
  const booked = e.target.closest('.cal-booking,.mobile-cal-booking');
  if (booked) {
    if (booked.classList.contains('mobile-cal-booking')) {
      selectedCalendarBookingId = selectedCalendarBookingId === booked.dataset.booking ? '' : booked.dataset.booking;
      renderCalendar();
    } else editBooking(booked.dataset.booking);
    return;
  }
  const tab = e.target.closest('.mobile-barber-tab');
  if (tab) { mobileCalendarBarberId = tab.dataset.mobileBarber; selectedCalendarBookingId = ''; renderCalendar(); return; }
  const timeline = e.target.closest('.mobile-worker-timeline');
  if (timeline && !timeline.classList.contains('day-off')) {
    const rect = timeline.getBoundingClientRect(), start = Number(timeline.dataset.start || 8), hourH = Number(timeline.dataset.hourh || 72);
    let mins = Math.max(0, Math.min((rect.height / hourH) * 60 - 15, (e.clientY - rect.top) / hourH * 60));
    mins = Math.floor(mins / 15) * 15 + start * 60;
    const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    openBookingModal({ date: calendarDate, time, barberId: timeline.dataset.barber, status: 'confirmed' });
    return;
  }
  const col = e.target.closest('.barber-col');
  if (!col || col.classList.contains('day-off')) return;
  const rect = col.getBoundingClientRect(), start = Number(col.dataset.start || 8), hourH = Number(col.dataset.hourh || 68);
  let mins = Math.max(0, Math.min((rect.height / hourH) * 60 - 15, (e.clientY - rect.top) / hourH * 60));
  mins = Math.floor(mins / 15) * 15 + start * 60;
  const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  openBookingModal({ date: calendarDate, time, barberId: col.dataset.barber, status: 'confirmed' });
});

function switchTab(id) {
  $$('.tab').forEach(x => x.classList.toggle('active', x.id === id));
  $$('.nav-btn').forEach(x => x.classList.toggle('active', x.dataset.tab === id));
  const names = { dashboard: 'Dashboard', calendar: 'Kalendar', bookings: 'Zakazivanja', services: 'Usluge', barbers: 'Barberi', gallery: 'Galerija', site: 'Uredi sajt', blackouts: 'Neradni dani' };
  $('#pageTitle').textContent = names[id] || id; $('#crumb').textContent = (names[id] || id).toUpperCase();
  if (id === 'calendar') renderCalendar();
}
window.switchTab = switchTab;
$$('.nav-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

function connectLiveEvents() {
  if (window.__barberLiveConnected) return;
  window.__barberLiveConnected = true;
  setInterval(() => {
    if (!document.hidden && $('#modal').classList.contains('hidden')) loadData().catch(() => {});
  }, 15000);
}

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if ($('#calendar').classList.contains('active')) renderCalendar(); }, 160);
});


// Dashboard visualises real booking records, never fabricated KPI values.
function renderActivity(){
  const totals=[];let peak=1;
  for(let i=6;i>=0;i--){
    const day=new Date();day.setDate(day.getDate()-i);const date=localISO(day);
    const count=STATE.bookings.filter(b=>b.date===date&&b.status!=='cancelled').length;
    peak=Math.max(peak,count);
    totals.push({date,count,day:day.toLocaleDateString('sr-RS',{weekday:'short'}).replace('.','')});
  }
  $('#bookingActivity').innerHTML=totals.map(x=>`<div class="activity-day" title="${x.date}: ${x.count} termina"><div class="activity-bar-track"><div class="activity-bar" style="height:${Math.max(x.count?12:2,x.count/peak*100)}%"><span>${x.count||''}</span></div></div><small>${esc(x.day)}</small></div>`).join('');
}
function renderBlackouts(){
  const select=$('#blackoutBarber'),previous=select.value;
  select.innerHTML='<option value="">Ceo salon</option>'+STATE.barbers.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  select.value=previous;
  const today=localISO();
  const form=$('#blackoutForm');
  if(!form.elements.dateFrom.value)form.elements.dateFrom.value=today;
  if(!form.elements.dateTo.value)form.elements.dateTo.value=today;
  const records=[...STATE.blackouts].sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom));
  $('#blackoutList').innerHTML=records.length?records.map(x=>{
    const worker=STATE.barbers.find(b=>b.id===x.barberId);
    const affected=STATE.bookings.filter(b=>b.status!=='cancelled'&&b.date>=x.dateFrom&&b.date<=x.dateTo&&(!x.barberId||b.barberId===x.barberId)).length;
    return `<div class="blackout-item"><div><small>${esc(x.dateFrom)} ${x.dateFrom!==x.dateTo?'→ '+esc(x.dateTo):''}</small><h3>${esc(x.reason)}</h3><p>${esc(worker?.name||'Ceo salon')}${affected?` · <strong>${affected} postojećih termina — proveri kalendar</strong>`:''}</p></div><button class="ghost" type="button" data-delete-blackout="${esc(x.id)}">Ukloni blokadu</button></div>`;
  }).join(''):'<div class="empty">Nema dodatih odsustava. Novi termini se prikazuju prema smenama barbera.</div>';
  $$('#blackoutList [data-delete-blackout]').forEach(btn=>btn.onclick=async()=>{
    if(!confirm('Ukloniti ovaj neradni dan?'))return;
    try{await api('/api/admin/blackouts/'+encodeURIComponent(btn.dataset.deleteBlackout),{method:'DELETE'});await loadData();}
    catch(e){$('#blackoutMessage').textContent=e.message;}
  });
}
$('#blackoutForm').addEventListener('submit',async e=>{
  e.preventDefault();const message=$('#blackoutMessage');message.textContent='';
  const body=Object.fromEntries(new FormData(e.currentTarget));
  if(body.dateTo<body.dateFrom){message.textContent='Krajnji datum ne sme biti pre početnog.';return;}
  const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;
  try{
    const d=await api('/api/admin/blackouts',{method:'POST',body:JSON.stringify(body)});
    await loadData();
    message.textContent=d.affectedBookings?`Blokada je dodata. Pažnja: ${d.affectedBookings} postojećih rezervacija treba ručno proveriti.`:'Neradni dani su sačuvani. Novi termini su blokirani.';
  }catch(err){message.textContent=err.message;}
  finally{btn.disabled=false;}
});
$('#exportBookings').addEventListener('click',()=>{
  const fields=['Datum','Vreme','Klijent','Telefon','Usluga','Barber','Trajanje (min)','Cena','Status','Kod'];
  const rows=STATE.bookings.map(b=>[b.date,b.time,b.name,b.phone,b.serviceName,b.barberName,b.duration,b.price,statusNames[b.status]||b.status,b.code||'']);
  const csv=[fields,...rows].map(row=>row.map(value=>{
    // Neutralize formulas when CSV is opened in Excel or Sheets.
    let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }).join(';')).join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='barber-rezervacije-'+localISO()+'.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
});

init().catch(error => {
  $('#app').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#loginMsg').textContent = error.message;
});
