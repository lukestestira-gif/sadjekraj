#!/usr/bin/env node
'use strict';
// Reset the local stored credential without touching data/db.json (bookings, services, settings).
const fs = require('node:fs');
const path = require('node:path');
const authFile = path.join(__dirname, '..', 'data', 'admin-auth.json');
if (process.env.ADMIN_PASS) {
  console.error('ADMIN_PASS je postavljen u okruženju i ima prednost. Promeni ADMIN_PASS u hostingu/.env, pa restartuj server.');
  process.exit(1);
}
if (fs.existsSync(authFile)) {
  const backup = authFile + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  fs.renameSync(authFile, backup);
  console.log('Stara administratorska lozinka je sačuvana u: ' + backup);
} else {
  console.log('Nema postojeće admin lozinke za reset.');
}
console.log('Posle restartovanja servera: korisnik admin, privremena lozinka Barber123!');
console.log('Na prvom ulazu obavezno postavi svoju novu lozinku (minimum 12 znakova).');
