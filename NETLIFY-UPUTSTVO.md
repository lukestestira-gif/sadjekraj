# GAVRO — postavljanje na Netlify

## Važno
Ovaj sajt ima server za admin panel i rezervacije. Samo prevlačenje `public` foldera na Netlify Drop ne instalira server. ZIP prvo raspakujte. Za pun sajt koristite Git povezivanje ili Netlify CLI sa izgradnjom funkcija.

## Preporučeni postupak: Git + Netlify
1. Stavite sadržaj foldera `GAVRO-Hairstyle-Final-v16` u Git repozitorijum. Na njegovom vrhu treba da budu `netlify.toml`, `package.json`, `server.js`, `public`, `data` i `netlify`. Ne šaljite `.env` ili lozinke u Git.
2. Povežite postojeći Netlify projekat sa tim repozitorijumom, ili uvezite repozitorijum kao novi projekat.
3. Ako je sadržaj na vrhu repozitorijuma, Base directory ostavite prazno. Ako ste poslali i spoljni folder, Base directory mora biti `GAVRO-Hairstyle-Final-v16`.
4. Build command: `npm run build`; Publish directory: `public`; Functions directory: `netlify/functions`; Node: `22`. Podešavanja su već u `netlify.toml`.
5. U Netlify Environment variables dodajte sledeće vrednosti, dostupne Functions okruženju i produkciji:
   - `DATABASE_URL`: u svom Supabase projektu otvorite **Connect → Transaction pooler** i kopirajte stvarni URI. Ubacite lozinku baze i URL-kodirajte posebne znakove u lozinci. Ne koristite anon/publishable API ključ umesto lozinke baze. Ne nagađajte region ni hostname.
   - `ADMIN_USER`: korisničko ime po izboru (podrazumevano `admin`).
   - `ADMIN_PASS`: vaša nova tajna lozinka sa najmanje 16 znakova. Stara lokalna demo lozinka nije Netlify prijava.
   - `SALON_TIME_ZONE`: `Europe/Belgrade`.
   - Ako Function log prijavi problem sa poverenjem u SSL sertifikat: `DATABASE_CA_CERT` = sadržaj CA sertifikata preuzetog iz vašeg Supabase projekta, uključujući BEGIN/END CERTIFICATE redove. Podržani su pravi novi redovi ili zapis `\n`. TLS provera ostaje uključena.
6. Pokrenite novi deploy. Dodavanje promenljivih bez novog deploy-a nije završeno podešavanje.
7. Proverite da Netlify prikazuje funkciju `api` i da je Supabase projekat aktivan. Tabele se prave automatski pri prvom standardnom API zahtevu; korisnik baze mora imati potrebne dozvole.

## Provera
- `/uploads/frame-1.jpg` mora otvoriti fotografiju. Ako je 404, proverite Publish/Base directory i da li ste poslali sve fajlove.
- `/api/public` mora vratiti JSON sa podešavanjima, uslugama i galerijom. HTML/404 znači problem sa deploy-em funkcije ili preusmeravanjem. JSON 503 sadrži poruku o konfiguraciji/bazi.
- `/admin` ili `/admin.html`: prijavite se vrednostima `ADMIN_USER` i `ADMIN_PASS` iz Netlifyja.
- Napravite probnu rezervaciju, proverite je u adminu i obrišite je. Dodajte probnu fotografiju i proverite da opstaje posle novog deploy-a.
- Ako vidite staru verziju, osvežite stranicu bez keša ili otvorite privatni prozor. Nova verzija service worker-a briše prethodni keš pri aktivaciji.

## Šta je ispravljeno
- Priložene fotografije nisu imale `active` oznaku, pa ih je API izostavljao. Dopunjeni su početni podaci i migracija starih zapisa. Slike sa `active: false` ostaju skrivene.
- Ako API nije dostupan, sajt može prikazati početne javne podatke i lokalne fotografije iz `site-data.json`. To je rezervni prikaz iz paketa, ne trenutna baza. Sajt jasno prijavljuje da online zakazivanje nije dostupno.
- Greške konfiguracije i povezivanja sada vraćaju JSON umesto neobrađenog pada funkcije. Admin prikazuje objašnjenje i kada funkcija nije objavljena.
- Admin resursi više se ne poslužuju iz starog service-worker keša; podržan je i `/admin/`.
- `npm run build` priprema javni rezervni prikaz bez rezervacija i pristupnih podataka. Baza `data/db.json` ne sme biti Publish directory.

## Provereno i preostalo
Lokalni automatizovani testovi prolaze: rezervacije, admin kontrola, neradni dani, reset lokalne lozinke, galerija i obrada grešaka adaptera. Greške baze testirane su simulacijom. Živa Netlify funkcija, SSL veza sa vašim Supabase projektom i prijava u produkciji nisu proverene bez URL-a sajta i podešavanja vašeg naloga.

Zvanična dokumentacija:
- https://docs.netlify.com/build/functions/get-started/
- https://docs.netlify.com/deploy/create-deploys/
- https://supabase.com/docs/guides/database/connecting-to-postgres
