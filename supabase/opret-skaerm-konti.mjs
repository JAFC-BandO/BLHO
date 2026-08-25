// Opretter det en butiks-SKAERM skal bruge for at komme i drift:
//   1) et login (rolle 'skaerm') som selve Android-boksen logger ind med
//   2) en raekke i `enheder`, hvis enheds-ID du skal taste ind i boksens opsaetning
//
// Adskilt fra opret-butiks-brugere.mjs med vilje: den opretter MENNESKER, denne opretter
// MASKINER. De to har vidt forskellige password-regler (se nedenfor), og man skal kunne
// koere den ene uden at roere den anden.
//
// ---------------------------------------------------------------------------
// PASSWORDS ER IKKE ENS HER
//
// Butiks-admins fik alle '12345678', fordi de TVINGES til at vaelge deres eget ved foerste
// login (skal_saette_password = true). Det kan en skaerm ikke -- der sidder intet menneske
// ved den, passwordet tastes ind i boksen én gang og bliver staaende i maaneder eller aar.
// Derfor faar hver skaerm sit EGET, tilfaeldigt genererede password her.
//
// >> Outputtet indeholder disse passwords i klartekst. Gem dem et sikkert sted med det
// >> samme (fx jeres password-manager) -- de kan ikke hentes frem igen bagefter, kun
// >> nulstilles. Ryd terminalen naar du er faerdig.
// ---------------------------------------------------------------------------
//
// SAADAN KOERER DU DEN
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role-noeglen>"
//   node supabase/opret-skaerm-konti.mjs            # toerloeb -- intet aendres
//   node supabase/opret-skaerm-konti.mjs --opret    # goer det
//   $env:SUPABASE_SERVICE_ROLE_KEY = $null
//
// Kan koeres igen uden risiko: findes login eller enhed allerede, springes den over.

import { randomBytes } from 'node:crypto';

const SUPABASE_URL = 'https://irijatnmgvutrqngwpaa.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPRET = process.argv.includes('--opret');

// Butikker der allerede koerer med skaerm i drift -- roeres ikke.
const SPRING_OVER = ['horsens', 'vanloese'];

// Internt domaene: skaerm-konti er ikke mennesker og skal aldrig kunne modtage mail.
const SKAERM_DOMAENE = 'intern.blho';

if (!SERVICE_KEY) {
  console.error('\nMangler SUPABASE_SERVICE_ROLE_KEY.');
  console.error('  PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role-noeglen>"\n');
  process.exit(1);
}

const hoveder = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

async function kald(sti, init = {}) {
  const svar = await fetch(SUPABASE_URL + sti, { ...init, headers: { ...hoveder, ...(init.headers || {}) } });
  const tekst = await svar.text();
  let krop = null;
  try { krop = tekst ? JSON.parse(tekst) : null; } catch { krop = tekst; }
  return { ok: svar.ok, status: svar.status, krop };
}

// Bevidst uden 0/O/1/l/I: passwordet skal kunne tastes korrekt af et menneske paa et
// Android-tastatur, evt. fra et udskrevet ark, uden tvivl om hvilket tegn det er.
const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function nytPassword(laengde = 20) {
  const b = randomBytes(laengde);
  return Array.from(b, x => ALFABET[x % ALFABET.length]).join('');
}

async function main() {
  console.log(OPRET ? '\n== OPRETTER (skriver til databasen) ==\n' : '\n== TOERLOEB -- intet aendres. Tilfoej --opret for at goere det rigtigt ==\n');

  const butikker = await kald('/rest/v1/butikker?select=id,navn,slug&order=navn');
  if (!butikker.ok) {
    console.error('Kunne ikke hente butikker:', butikker.status, butikker.krop);
    process.exitCode = 1;
    return;
  }

  const brugere = await kald('/auth/v1/admin/users?per_page=1000');
  if (!brugere.ok) {
    console.error('Kunne ikke hente eksisterende brugere:', brugere.status, brugere.krop);
    process.exitCode = 1;
    return;
  }
  const findes = new Map((brugere.krop.users || []).map(u => [(u.email || '').toLowerCase(), u.id]));

  const enheder = await kald('/rest/v1/enheder?select=id,butik_id,navn');
  if (!enheder.ok) {
    console.error('Kunne ikke hente enheder:', enheder.status, enheder.krop);
    process.exitCode = 1;
    return;
  }
  const harEnhed = new Set(enheder.krop.map(e => e.butik_id));

  const rapport = [];

  for (const butik of butikker.krop) {
    const email = `skaerm-${butik.slug}@${SKAERM_DOMAENE}`.toLowerCase();
    const linje = { butik: butik.navn, login: email, password: '', enheds_id: '', note: '' };

    if (SPRING_OVER.includes(butik.slug)) {
      rapport.push({ ...linje, login: '-', note: 'springes over -- skaerm koerer allerede' });
      continue;
    }

    // ---- 1. login til boksen ----
    // Holdes adskilt fra linje.password, som ogsaa kan indeholde forklarende tekst
    // ("(fandtes i forvejen)") -- kun en RIGTIG genereret kode maa skrives i databasen.
    let genereretKode = null;
    let brugerId = findes.get(email);
    if (brugerId) {
      linje.password = '(fandtes i forvejen)';
    } else if (!OPRET) {
      linje.password = '(genereres)';
    } else {
      genereretKode = nytPassword();
      const oprettet = await kald('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password: genereretKode, email_confirm: true }),
      });
      if (!oprettet.ok) {
        rapport.push({ ...linje, note: `FEJL login: ${oprettet.status} ${JSON.stringify(oprettet.krop)}` });
        continue;
      }
      brugerId = oprettet.krop.id;
      linje.password = genereretKode;
    }

    // ---- 2. brugere-raekken (rolle 'skaerm', koblet til butikken) ----
    if (brugerId) {
      const eksisterende = await kald(`/rest/v1/brugere?id=eq.${brugerId}&select=id`);
      if (eksisterende.ok && !eksisterende.krop.length) {
        if (OPRET) {
          const indsat = await kald('/rest/v1/brugere', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              id: brugerId,
              butik_id: butik.id,
              rolle: 'skaerm',
              navn: `Skærm - ${butik.navn.replace(/^Butik\s+/, '')}`,
              // Ingen tvungen password-skift: der sidder intet menneske ved en skaerm til
              // at gennemfoere den. Boksen ville bare moede skaermbilledet og gaa i staa.
              skal_saette_password: false,
              // Bevidst klartekst, og KUN for skaerm-konti: en boks' password skal kunne
              // slaas op igen naar enheden skal genopsaettes eller udskiftes -- modsat et
              // menneskes, der aldrig skal kunne laeses tilbage. Samme moenster som de
              // eksisterende skaerm-horsens/skaerm-vanlose.
              //
              // Hvad det betyder: RLS paa `brugere` er "kun egen raekke", saa ingen butik
              // kan se en anden butiks skaerm-password -- kun nogen med direkte database-
              // adgang. Og en skaerm-konto kan KUN laese (skriv til content/media/sabloner
              // kraever rolle='admin'), saa et laekket skaerm-password giver adgang til at
              // se én butiks skaermindhold, intet andet.
              //
              // Skrives kun naar vi selv lige har genereret koden. Fandtes login'et i
              // forvejen, kender vi ikke passwordet og maa ikke overskrive noget.
              ...(genereretKode ? { password: genereretKode } : {}),
            }),
          });
          if (!indsat.ok) linje.note = `BRUGERE-FEJL ${indsat.status} ${JSON.stringify(indsat.krop)}`;
        }
      } else {
        linje.note = 'brugere-raekke fandtes';
      }
    }

    // ---- 3. enheden (ID'et der tastes ind i boksen) ----
    if (harEnhed.has(butik.id)) {
      linje.enheds_id = '(havde allerede en enhed)';
    } else if (!OPRET) {
      linje.enheds_id = '(oprettes)';
    } else {
      const enhed = await kald('/rest/v1/enheder', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          butik_id: butik.id,
          navn: `${butik.navn.replace(/^Butik\s+/, '')} Skærm`,
          type: 'android',
        }),
      });
      linje.enheds_id = enhed.ok && enhed.krop[0] ? enhed.krop[0].id : `FEJL ${enhed.status}`;
    }

    rapport.push(linje);
  }

  console.table(rapport);

  const fejl = rapport.filter(r => (r.note || '').includes('FEJL') || String(r.enheds_id).includes('FEJL'));
  console.log(`\n${rapport.length} butikker behandlet, ${fejl.length} fejl.`);
  if (!OPRET) {
    console.log('Toerloeb -- intet blev aendret. Koer igen med --opret naar listen ser rigtig ud.\n');
  } else {
    console.log('\n*** GEM TABELLEN OVENFOR NU ***');
    console.log('Passwordene vises kun denne ene gang og kan ikke hentes frem igen.');
    console.log('Hver boks skal bruge sit eget login + sit eget enheds-ID (se ANDROID-KIOSK-SETUP.md).');
    console.log('Ryd terminalen bagefter, og:  $env:SUPABASE_SERVICE_ROLE_KEY = $null\n');
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
