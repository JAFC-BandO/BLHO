// Opretter én admin-bruger pr. butik: login i Supabase Auth + den tilhoerende raekke i
// `brugere` (med butik_id, rolle og skal_saette_password), i ét kald pr. butik.
//
// Hvorfor et script og ikke bare SQL: en Auth-bruger kan IKKE laves med et insert i
// auth.users. Password-hashing, identities-raekken og bekraeftelsen haandteres af GoTrue,
// saa den eneste rigtige vej er Admin-API'et -- det er praecis det samme Dashboard'ets
// "Add user"-knap goer, bare 16 gange uden klikkeri.
//
// ---------------------------------------------------------------------------
// SAADAN KOERER DU DEN
//
//   1) Hent service_role-noeglen: Dashboard -> Project Settings -> API keys -> service_role
//      Den maa ALDRIG i git, i frontend eller deles i en chat. Den omgaar al RLS.
//
//   2) Toerloeb foerst -- viser hvad der VILLE ske, uden at aendre noget:
//        $env:SUPABASE_SERVICE_ROLE_KEY = "<noeglen>"
//        node supabase/opret-butiks-brugere.mjs
//
//   3) Naar listen ser rigtig ud, koer for alvor:
//        node supabase/opret-butiks-brugere.mjs --opret
//
//   4) Ryd noeglen ud af terminalen bagefter:
//        $env:SUPABASE_SERVICE_ROLE_KEY = $null
//
// Scriptet kan koeres igen uden risiko: findes brugeren eller brugere-raekken allerede,
// springes den over i stedet for at blive overskrevet. Saa naar I opretter butik nr. 17,
// koerer I bare den samme kommando igen.
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://irijatnmgvutrqngwpaa.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Startpassword. Brugeren TVINGES til at vaelge sit eget ved foerste login, fordi vi saetter
// skal_saette_password = true nedenfor (se foerste-login-flowet i butik-redigering).
// Kan overstyres uden at redigere filen:  $env:BLHO_START_PASSWORD = "<noget andet>"
const START_PASSWORD = process.env.BLHO_START_PASSWORD || '12345678';

const OPRET = process.argv.includes('--opret');
const EMAIL_DOMAENE = 'boerneloppen.dk';

// Butikker der IKKE skal have en generisk butiks-konto. Horsens og Vanloese koerer allerede
// i drift med navngivne personer paa (mp@ og pernille.balmer@) og har baade skaerm-konto og
// enhed -- de skal ikke have en ekstra faelles-login ovenpaa. Angives med butikkens slug.
const SPRING_OVER = ['horsens', 'vanloese'];

if (!SERVICE_KEY) {
  console.error('\nMangler SUPABASE_SERVICE_ROLE_KEY.\n');
  console.error('  PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role-noeglen>"');
  console.error('  Hentes i:    Dashboard -> Project Settings -> API keys -> service_role\n');
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

// Butikkens `slug` er allerede den ASCII-rene udgave af navnet (helsingoer, holbaek,
// naestved, vallensbaek, vanloese) -- praecis det e-mailen skal hedde. Ved at udlede
// e-mailen af slug'en i stedet for at skrive 16 adresser af i haanden, undgaar vi baade
// slaafejl og aeoeaa i local-part'en (som ikke kan regnes med i e-mail), og en ny butik
// faar automatisk den rigtige adresse naeste gang scriptet koerer.
const emailFor = (butik) => `${butik.slug}@${EMAIL_DOMAENE}`.toLowerCase();
const visningsnavnFor = (butik) => `${butik.navn} (admin)`;

async function main() {
  console.log(OPRET ? '\n== OPRETTER (skriver til databasen) ==\n' : '\n== TOERLOEB -- intet aendres. Tilfoej --opret for at goere det rigtigt ==\n');

  const butikker = await kald('/rest/v1/butikker?select=id,navn,slug&order=navn');
  if (!butikker.ok) {
    console.error('Kunne ikke hente butikker:', butikker.status, butikker.krop);
    // process.exitCode frem for process.exit(): fetch holder sockets aabne lidt endnu, og et
    // haardt exit midt i det giver en "Assertion failed ... uv_handle"-stoej fra Node paa
    // Windows, som ligner en crash men ikke er det. Vi lader processen slutte af sig selv.
    process.exitCode = 1;
    return;
  }

  // Alle eksisterende logins hentes ÉN gang, saa vi kan se hvad der allerede findes uden at
  // proeve at oprette det og laese en fejl bagefter.
  const brugere = await kald('/auth/v1/admin/users?per_page=1000');
  if (!brugere.ok) {
    console.error('Kunne ikke hente eksisterende brugere:', brugere.status, brugere.krop);
    process.exitCode = 1;
    return;
  }
  const findes = new Map((brugere.krop.users || []).map(u => [(u.email || '').toLowerCase(), u.id]));

  const rapport = [];

  for (const butik of butikker.krop) {
    const email = emailFor(butik);
    const linje = { butik: butik.navn, email, handling: '', note: '' };

    if (SPRING_OVER.includes(butik.slug)) {
      linje.handling = 'springes over';
      linje.note = 'har allerede navngiven admin i drift';
      linje.email = '-';
      rapport.push(linje);
      continue;
    }

    let brugerId = findes.get(email);

    if (brugerId) {
      linje.handling = 'login fandtes';
    } else if (!OPRET) {
      linje.handling = 'ville oprette login';
      brugerId = null;
    } else {
      const oprettet = await kald('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: START_PASSWORD,
          // Samme som "Auto Confirm User" i Dashboard'et -- der sendes ingen mail, og
          // brugeren kan logge ind med det samme. Vi har ikke mail-opsaetning paa projektet.
          email_confirm: true,
        }),
      });
      if (!oprettet.ok) {
        linje.handling = 'FEJL';
        linje.note = `${oprettet.status} ${JSON.stringify(oprettet.krop)}`;
        rapport.push(linje);
        continue;
      }
      brugerId = oprettet.krop.id;
      linje.handling = 'login oprettet';
    }

    // ---- brugere-raekken (koblingen til butikken) ----
    if (!brugerId) {
      linje.note = 'brugere-raekke oprettes naar login findes';
      rapport.push(linje);
      continue;
    }

    const eksisterende = await kald(`/rest/v1/brugere?id=eq.${brugerId}&select=id,butik_id`);
    if (eksisterende.ok && eksisterende.krop.length) {
      linje.note = 'brugere-raekke fandtes i forvejen -- roert ikke';
      rapport.push(linje);
      continue;
    }

    if (!OPRET) {
      linje.note = `ville koble til ${butik.navn}`;
      rapport.push(linje);
      continue;
    }

    const indsat = await kald('/rest/v1/brugere', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: brugerId,
        butik_id: butik.id,
        rolle: 'admin',
        navn: visningsnavnFor(butik),
        // Tvinger "vaelg dit eget password"-skaermen ved foerste login, saa
        // start-passwordet aldrig bliver det blivende.
        skal_saette_password: true,
      }),
    });
    linje.note = indsat.ok ? `koblet til ${butik.navn}` : `BRUGERE-FEJL ${indsat.status} ${JSON.stringify(indsat.krop)}`;
    rapport.push(linje);
  }

  console.table(rapport);

  const fejl = rapport.filter(r => r.handling === 'FEJL' || r.note.includes('FEJL'));
  console.log(`\n${rapport.length} butikker behandlet, ${fejl.length} fejl.`);
  if (!OPRET) console.log('Toerloeb -- intet blev aendret. Koer igen med --opret naar listen ser rigtig ud.\n');
  else console.log('Husk: ryd noeglen ud af terminalen ->  $env:SUPABASE_SERVICE_ROLE_KEY = $null\n');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
