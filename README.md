# GAVRO HAIRSTYLE — Premium v15

Sajt za Gavro Hairstyle iz Loznice sa online zakazivanjem, otkazivanjem i admin panelom. Rezervacije su čuvane u `data/db.json`.

## Pokretanje (Node.js 18+)

1. Raspakuj projekat u NOV folder.
2. Otvori terminal u folderu projekta i pokreni `npm start`.
3. Sajt: `http://localhost:3000/`; admin: `http://localhost:3000/admin`.

**Početna admin prijava pri svežem pokretanju** (kada `data/admin-auth.json` ne postoji i `ADMIN_PASS` nije postavljen):

- Korisnik: `admin`
- Privremena lozinka: `Barber123!`

Sistem odmah traži da postaviš novu jaku lozinku od najmanje 12 znakova, pre otvaranja admin panela.
Obavezno je promeni pre javnog objavljivanja i nikada ne ostavljaj privremenu lozinku na serveru dostupnom svima.

### Ako je admin šifra i dalje pogrešna

Raniji fajl `data/admin-auth.json` može da ima hash stare šifre. Nova ZIP verzija **ne sadrži** taj fajl, ali on može ostati u staroj instalaciji ili Docker volumenu.

1. **Zaustavi server.**
2. U folderu aplikacije pokreni `npm run reset-admin`.
3. Ponovo pokreni `npm start` (ili restartuj kontejner).
4. Prijavi se sa `admin` / `Barber123!`, pa odmah postavi novu šifru.

Reset čuva backup prethodne admin lozinke i **ne briše** rezervacije ili podešavanja salona.
Ako koristiš `ADMIN_PASS` postavljen u hostingu, terminalu ili Docker `.env`, on ima prioritet: promeni ga tamo i restartuj server. Komanda `npm run reset-admin` na to upozorava.
Ako je port 3000 zauzet, aplikacija može da se pokrene na sledećem portu (3001–3009).

## Izmene u verziji v15

- Ime i adresa povezani sa javnim profilom: **Gavro Hairstyle** — `@hairstyle_by_gavro` — Jovana Cvijića 25, Loznica. Instagram vodi na originalni profil.
- U sekciji Radovi nalaze se **dve originalne Instagram objave** (fotografija i reel) prikazane preko Instagram embed-a, sa direktnim linkovima na objave. Ne preuzimamo slike i ne predstavljamo generičke stock fotografije kao radove salona. Da bi se slike prikazivale nezavisno od Instagrama, otpremi originalne fotografije kroz Admin → Galerija.
- Posle zakazivanja klijent dobija jedinstven **kod rezervacije**. Opcija „Otkaži termin“ traži kod i broj telefona sa rezervacije; otkazani slot postaje ponovo slobodan. Otkazivanje je moguće **samo pre početka termina**.
- Otkazivanje je dostupno i putem manjeg linka u podnožju sajta. **Nema „Moji termini“, izmene termina ni „Dodaj u kalendar“.**
- Klijent može da vidi samo podatke o rezervaciji koju je upravo napravio; ne postoji javni spisak drugih rezervacija.
- Admin panel ostaje za upravljanje uslugama, radnim vremenom, terminima, galerijom i podešavanjima.
- Ažuriran PWA keš na v15.

### Instagram slike

Instagram ograničava automatsko preuzimanje sadržaja. Povezane objave se otvaraju sa Instagrama dok god su javne i dozvoljavaju ugrađeni prikaz. Za **lokalnu galeriju koja se uvek učitava** izvezi vlastite Instagram fotografije u JPG/PNG i dodaj ih kroz Admin → Galerija. Vidi i `INSTAGRAM-SLIKE.txt`.

### Kako radi otkazivanje

1. Klijent zakaže termin i sačuva prikazani kod (14 znakova).
2. Na potvrdi klikne **Otkaži termin** ili kasnije u podnožju sajta klikne isti link.
3. Unese kod rezervacije i broj telefona kojim je zakazao, pa potvrdi otkazivanje.
4. Sistem čuva status `cancelled` u bazi i odmah oslobađa termin. Početi ili već završeni termini ne mogu biti otkazani preko sajta.

## Admin i rezervacije

Admin panel sadrži termine, kalendar, barbere, usluge, neradne dane, galeriju, podešavanja i CSV/backup izvoz. Klijent može da rezerviše samo stvarno slobodan termin. Svako zakazivanje je dostupno osoblju u admin panelu. Bez automatskih SMS poruka ili online naplate.

## Objavljivanje

Za online rad je potreban Node.js hosting sa trajnim `data/` i `public/uploads/` direktorijumima i HTTPS-om. Samo static hosting nije dovoljan.

Docker: kopiraj `.env.example` kao `.env`, zameni `ADMIN_PASS` snažnom jedinstvenom lozinkom i pokreni `docker compose up -d --build`. Docker čuva salon u volumenu `barber_data`; ako koristiš taj metod, šifra je ona iz tvog `.env`, ne `Barber123!`.

## Testovi

`npm test` — pokreće provere u izdvojenom privremenom folderu, bez menjanja stvarnih rezervacija.
