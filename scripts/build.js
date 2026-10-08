'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'), 'utf8'));
const pick = (row, keys) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const data = {
  settings: pick(db.settings, ["salonName", "heroTitle", "heroSubtitle", "phone", "address", "instagram", "accent", "currency", "openingHours", "aboutTitle", "aboutText", "heroImage", "appTitle", "appText", "logoImage", "heroEyebrow", "marqueeText", "primaryCtaText", "servicesTitle", "servicesSubtitle", "worksTitle", "worksSubtitle", "barbersTitle", "barbersSubtitle", "bookingTitle", "bookingSubtitle", "footerText", "tiktok", "googleReviewUrl", "googleMapsUrl", "googleMapsEmbed"]),
  services: db.services.filter(x => x.active).map(x => pick(x, ['id','name','description','duration','price','active'])),
  barbers: db.barbers.filter(x => x.active).map(x => pick(x, ['id','name','role','initials','color','workStart','workEnd','workDays','active','bio','photo'])),
  gallery: db.gallery.filter(x => x.active !== false).map(x => pick(x, ['id','barberId','title','caption','image','active']))
};
fs.writeFileSync(path.join(root, 'public/site-data.json'), JSON.stringify(data, null, 2) + '\n');
console.log('Public fallback prepared; no bookings or credentials included.');
