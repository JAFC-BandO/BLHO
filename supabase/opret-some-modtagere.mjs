// Opretter et login til hver modtager af SoMe-rapporten og gemmer dem som butikkens mailgruppe
// (some_mail_grupper), saa de staar klar i skrivefeltet paa SoMe-siden.
//
// Pr. modtager: login i Supabase Auth (startkode 12345678, "Auto Confirm"), en raekke i `brugere`
// (rolle admin, skal_saette_password = true, saa koden skal skiftes ved foerste login) og -- hvis
// modtageren hoerer til flere butikker -- raekker i `bruger_butikker`. Findes loginet i forvejen,
// roeres kode og brugere-raekke ikke; kun butikkoblingen og mailgruppen sikres.
//
// Saadan koeres det (samme som opret-butiks-brugere.mjs):
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role-noeglen>"
//   node supabase/opret-some-modtagere.mjs            (toerloeb -- viser kun, hvad der ville ske)
//   node supabase/opret-some-modtagere.mjs --opret    (goer det for alvor)
//   $env:SUPABASE_SERVICE_ROLE_KEY = $null
// Kan koeres igen uden skade.

const SUPABASE_URL = 'https://irijatnmgvutrqngwpaa.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const START_PASSWORD = process.env.BLHO_START_PASSWORD || '12345678';
const OPRET = process.argv.includes('--opret');

// Butikkerne findes ved at et af ordene indgaar i butikkens slug eller navn (smaa bogstaver).
// Staar en butik ikke paa listen i toerloebet, ret ordene her.
const GRUPPER = [
  { butikker: ['herning', 'horsens'], mails: ['jc@boerneloppen.dk', 'mp@boerneloppen.dk'] },
  { butikker: ['aalborg'], mails: ['melissa@boerneloppen.dk'] },
  { butikker: ['randers', 'aarhus|århus'], mails: ['jacob@boerneloppen.dk', 'katrine@boerneloppen.dk'] },
  { butikker: ['kolding'], mails: ['nora@boerneloppen.dk'] },
  { butikker: ['odense'], mails: ['emilie@boerneloppen.dk'] },
  { butikker: ['slagelse', 'naestved|næstved'], mails: ['trine@boerneloppen.dk'] },
  { butikker: ['helsingoer|helsingør', 'vallensbaek|vallensbæk', 'lyngby'], mails: ['jossan@boerneloppen.dk', 'lea@boerneloppen.dk'] },
  { butikker: ['amager', 'vanloese|vanløse'], mails: ['pernille.balmer@boerneloppen.dk'] },
  { butikker: ['valby'], mails: ['ditte@boerneloppen.dk'] },
  { butikker: ['holbaek|holbæk'], mails: ['ak@boerneloppen.dk', 'sandra@boerneloppen.dk'] },
  { butikker: ['island|iceland|reykjav'], mails: ['andri@barnaloppan.is'] },
  { butikker: ['liege|liège|belg'], mails: ['manon@borneloppen.be', 'niro.gregory@gmail.com'] },
];

if (!SERVICE_KEY) {
  console.error('\nMangler SUPABASE_SERVICE_ROLE_KEY (Dashboard -> Project Settings -> API keys -> service_role).\n');
  process.exit(1);
}
const hoveder = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
async function kald(sti, init = {}) {
  const svar = await fetch(SUPABASE_URL + sti, { ...init, headers: { ...hoveder, ...(init.headers || {}) } });
  const tekst = await svar.text();
  let krop = null;
  try { krop = tekst ? JSON.parse(tekst) : null; } catch { krop = tekst; }
  return { ok: svar.ok, status: svar.status, krop };
}
const pænt = (email) => { const n = email.split('@')[0].replace(/[._]/g, ' '); return n.charAt(0).toUpperCase() + n.slice(1); };

async function main() {
  console.log(OPRET ? '\n== OPRETTER (skriver til databasen) ==\n' : '\n== TOERLOEB -- intet aendres. Tilfoej --opret for at goere det rigtigt ==\n');
  const bu = await kald('/rest/v1/butikker?select=id,navn,slug&order=navn');
  const us = await kald('/auth/v1/admin/users?per_page=1000');
  if (!bu.ok || !us.ok) { console.error('Kunne ikke hente butikker/brugere:', bu.status, us.status); process.exitCode = 1; return; }
  const findes = new Map((us.krop.users || []).map((u) => [(u.email || '').toLowerCase(), u.id]));
  const rapport = [];

  for (const g of GRUPPER) {
    // En butik pr. ordliste ("a|b" = enten a eller b)
    const fundet = [];
    for (const ord of g.butikker) {
      const re = new RegExp(ord, 'i');
      const b = bu.krop.filter((x) => re.test(x.slug || '') || re.test(x.navn || ''));
      if (b.length === 1) fundet.push(b[0]);
      else rapport.push({ butik: ord, mail: '-', handling: b.length ? 'FLERE MATCH' : 'INTET MATCH', note: b.map((x) => x.navn).join(', ') });
    }
    if (!fundet.length) continue;

    for (const mail of g.mails) {
      const email = mail.toLowerCase();
      const linje = { butik: fundet.map((b) => b.navn).join(' + '), mail: email, handling: '', note: '' };
      let id = findes.get(email);
      if (id) linje.handling = 'login fandtes';
      else if (!OPRET) linje.handling = 'ville oprette login';
      else {
        const r = await kald('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: START_PASSWORD, email_confirm: true }) });
        if (!r.ok) { linje.handling = 'FEJL'; linje.note = r.status + ' ' + JSON.stringify(r.krop); rapport.push(linje); continue; }
        id = r.krop.id; findes.set(email, id); linje.handling = 'login oprettet';
      }
      if (!id) { rapport.push(linje); continue; }

      // brugere-raekken: kun hvis den mangler (en eksisterende bruger roeres ikke)
      const ek = await kald(`/rest/v1/brugere?id=eq.${id}&select=butik_id`);
      let hjemme = ek.ok && ek.krop[0] ? ek.krop[0].butik_id : null;
      if (!hjemme) {
        const ins = await kald('/rest/v1/brugere', { method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ id, butik_id: fundet[0].id, rolle: 'admin', navn: pænt(email), skal_saette_password: true }) });
        linje.note = ins.ok ? 'brugere-raekke oprettet' : 'BRUGERE-FEJL ' + ins.status + ' ' + JSON.stringify(ins.krop);
        hjemme = fundet[0].id;
      }
      // Flere butikker: alle (ogsaa hjemmebutikken) i bruger_butikker, saa man kan skifte imellem dem
      const alle = [...new Set([...fundet.map((b) => b.id), hjemme])];
      if (alle.length > 1) {
        const bb = await kald('/rest/v1/bruger_butikker', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(alle.map((b) => ({ bruger_id: id, butik_id: b }))) });
        linje.note += (linje.note ? '; ' : '') + (bb.ok ? alle.length + ' butikker' : 'BUTIKS-FEJL ' + bb.status + ' ' + JSON.stringify(bb.krop));
      }
      rapport.push(linje);
    }

    // Mailgruppen paa hver butik i gruppen
    if (OPRET) {
      for (const b of fundet) {
        const m = await kald('/rest/v1/some_mail_grupper', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ butik_id: b.id, modtagere: g.mails.join(', '), opdateret_at: new Date().toISOString() }) });
        if (!m.ok) rapport.push({ butik: b.navn, mail: '-', handling: 'FEJL mailgruppe', note: m.status + ' ' + JSON.stringify(m.krop) });
      }
    }
  }
  console.table(rapport);
  const fejl = rapport.filter((r) => /FEJL|MATCH/.test(r.handling) || /FEJL/.test(r.note));
  console.log(`\n${rapport.length} linjer, ${fejl.length} med fejl/uklart match.`);
  console.log(OPRET ? 'Husk: $env:SUPABASE_SERVICE_ROLE_KEY = $null\n' : 'Toerloeb -- intet blev aendret.\n');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
