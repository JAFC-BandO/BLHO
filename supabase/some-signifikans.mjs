// Er forskellen mellem tidspunkterne reel, eller bare tilfaeldighed? Printer p-vaerdier i terminalen.
// Laeser kun (GET) -- og kun de fire kolonner, testen bruger. Selve regningen sker lokalt.
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role-noeglen>"
//   node supabase/some-signifikans.mjs
//   node supabase/some-signifikans.mjs --dage 180 --platform facebook --butik aarhus --kun-signifikante
//   $env:SUPABASE_SERVICE_ROLE_KEY = $null
//
// Valg: --dage N (90)  --platform facebook|instagram  --butik <del af navnet>  --min N (opslag, 20)
//       --perm N (20000)  --kun-signifikante  --fil data.json (raekker i stedet for databasen, til test)
//
// Metode: permutationstest paa visninger ift. kontoens normale opslag.
//  1. Hvert opslag maales mod sin egen kontos median, saa store og smaa butikker kan laegges sammen:
//     log((visninger+1)/(median+1)). Log, fordi et enkelt viralt opslag ellers styrer gennemsnittet.
//  2. Alle opslag fra samme kalendertime (fx mandag 3/11 kl. 15) flyttes samlet, naar timerne
//     blandes. Kaedens faelles kampagner og Metas gode og daarlige dage rammer mange butikker paa
//     én gang; uden den samling ville de se ud som mange uafhaengige opslag og give falske fund.
//  3. p = hvor ofte tilfaeldigt blandede timer giver en lige saa stor afvigelse (to-sidet).
//  4. q = p korrigeret for, at der testes mange timer paa én gang (Benjamini-Hochberg). Ved 168
//     tidspunkter er ca. 8 "signifikante" med p<0,05 ren tilfaeldighed, saa det er q, der afgoer.

const URL_BASE = 'https://irijatnmgvutrqngwpaa.supabase.co/rest/v1';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (navn, std) => { const i = process.argv.indexOf('--' + navn); return i > 0 ? process.argv[i + 1] : std; };
const DAGE = Number(arg('dage', 90)), MIN = Number(arg('min', 20)), PERM = Number(arg('perm', 20000));
const PLATFORM = arg('platform', null), BUTIK = arg('butik', null), FIL = arg('fil', null);
const KUN_SIG = process.argv.includes('--kun-signifikante');
const ALFA = 0.05;
const UGEDAGE = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];

const NUL = '\x1b[0m', GROEN = '\x1b[32m', ROED = '\x1b[31m', GRAA = '\x1b[90m', FED = '\x1b[1m';

async function hent(sti) {
  const r = await fetch(`${URL_BASE}/${sti}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`Supabase svarede ${r.status}: ${await r.text()}`);
  return r.json();
}

// Sider a 1000 raekker, én ad gangen, med kun de kolonner der skal bruges
async function hentOpslag() {
  const konti = await hent('some_konti?select=id,platform,navn,butikker(navn)&aktiv=is.true');
  const valgt = new Map(konti
    .filter(k => !PLATFORM || k.platform === PLATFORM)
    .filter(k => !BUTIK || `${k.navn} ${k.butikker?.navn || ''}`.toLowerCase().includes(BUTIK.toLowerCase()))
    .map(k => [k.id, k.platform]));
  if (!valgt.size) throw new Error('Ingen aktive konti matcher valget.');
  const fra = new Date(Date.now() - DAGE * 864e5).toISOString(), raekker = [];
  for (let start = 0; ; start += 1000) {
    const side = await hent(`some_opslag?select=konto_id,oprettet_at,visninger,type&visninger=not.is.null&oprettet_at=gte.${fra}&order=oprettet_at.asc,konto_id.asc,ekstern_id.asc&limit=1000&offset=${start}`);
    raekker.push(...side);
    process.stderr.write(`\rHenter opslag: ${raekker.length}`);
    if (side.length < 1000) break;
  }
  process.stderr.write('\n');
  return raekker
    .filter(o => valgt.has(o.konto_id) && !['STORY', 'created_event'].includes(o.type))
    .map(o => ({ ...o, platform: valgt.get(o.konto_id) }));
}

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
const DAG_NR = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function dansk(iso) {
  const d = Object.fromEntries(FORMAT.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return { dag: DAG_NR[d.weekday], time: Number(d.hour), klynge: `${d.year}-${d.month}-${d.day}T${d.hour}` };
}

// Saa testen giver samme tal hver gang, den koeres paa samme data
function rng(seed = 20261101) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// opslag: [{ x (centreret log-forhold), r (forhold), klynge, etiket }]
function test(opslag) {
  const klynger = new Map();
  for (const o of opslag) {
    const k = klynger.get(o.klynge) || { s: 0, n: 0, etiket: o.etiket };
    k.s += o.x; k.n++; klynger.set(o.klynge, k);
  }
  const K = [...klynger.values()], S = Float64Array.from(K, k => k.s), N = Int32Array.from(K, k => k.n);
  const navne = [...new Set(K.map(k => k.etiket))], nr = new Map(navne.map((e, i) => [e, i]));
  const L = Int32Array.from(K, k => nr.get(k.etiket));
  const sum = new Float64Array(navne.length), cnt = new Int32Array(navne.length);
  const tael = () => { sum.fill(0); cnt.fill(0); for (let i = 0; i < S.length; i++) { sum[L[i]] += S[i]; cnt[L[i]] += N[i]; } };
  tael();
  const obs = Float64Array.from(sum, (s, i) => Math.abs(s / cnt[i]));
  const hits = new Int32Array(navne.length), slump = rng();
  for (let p = 0; p < PERM; p++) {
    for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(slump() * (i + 1)), t = L[i]; L[i] = L[j]; L[j] = t; }
    tael();
    // Den blandede time sammenlignes med den rigtige time med samme etiket; en etiket uden
    // opslag i denne blanding kan ikke ske, for blandingen bevarer antallet af klynger pr. etiket
    for (let e = 0; e < hits.length; e++) if (Math.abs(sum[e] / cnt[e]) >= obs[e] - 1e-12) hits[e]++;
  }
  const grupper = new Map(navne.map(e => [e, []]));
  for (const o of opslag) grupper.get(o.etiket).push(o);
  const kAntal = new Map(navne.map(e => [e, 0]));
  for (const k of K) kAntal.set(k.etiket, kAntal.get(k.etiket) + 1);
  return navne.map((e, i) => {
    const g = grupper.get(e), rr = g.map(o => o.r).filter(v => v != null);
    return { etiket: e, n: g.length, klynger: kAntal.get(e), gange: rr.length ? median(rr) : null, p: (hits[i] + 1) / (PERM + 1) };
  });
}

// Benjamini-Hochberg: kun de tidspunkter med nok opslag er med i korrektionen
function bh(raekker) {
  const s = [...raekker].sort((a, b) => a.p - b.p);
  let q = 1;
  for (let i = s.length - 1; i >= 0; i--) { q = Math.min(q, s[i].p * s.length / (i + 1)); s[i].q = q; }
}

const pTekst = (p, minP) => p <= minP ? `<${minP.toFixed(4)}` : p.toFixed(4);
function vis(titel, raekker, etiketTekst) {
  const minP = 1 / (PERM + 1);
  console.log(`\n${FED}${titel}${NUL}`);
  const med = raekker.filter(r => r.n >= MIN);
  const faa = raekker.length - med.length;
  bh(med);
  const sig = med.filter(r => r.q < ALFA).sort((a, b) => b.gange - a.gange);
  const vises = KUN_SIG ? sig : med;
  console.log(GRAA + 'Tidspunkt'.padEnd(13) + 'Opslag'.padStart(7) + 'Kl.timer'.padStart(10) + 'Ift. normal'.padStart(13) + 'p'.padStart(9) + 'q'.padStart(9) + '  Signifikant' + NUL);
  for (const r of vises) {
    const erSig = r.q < ALFA, op = (r.gange ?? 1) >= 1;
    const farve = erSig ? (op ? GROEN : ROED) : '';
    console.log(farve + etiketTekst(r.etiket).padEnd(13) + String(r.n).padStart(7) + String(r.klynger).padStart(10)
      + ((r.gange == null ? '–' : r.gange.toFixed(2).replace('.', ',') + '×').padStart(13))
      + pTekst(r.p, minP).padStart(9) + pTekst(r.q, minP).padStart(9) + (erSig ? (op ? '  JA, flere visninger' : '  JA, færre visninger') : '  nej') + NUL);
  }
  console.log(`${GRAA}${med.length} testet${faa ? `, ${faa} sprunget over (under ${MIN} opslag)` : ''}. ${sig.length} signifikante ved q < ${String(ALFA).replace('.', ',')}.${NUL}`);
}

async function main() {
  if (!FIL && !KEY) { console.error('\nMangler SUPABASE_SERVICE_ROLE_KEY (Dashboard -> Project Settings -> API keys -> service_role).\n'); process.exit(1); }
  const start = Date.now();
  const raekker = FIL ? JSON.parse((await import('node:fs')).readFileSync(FIL, 'utf8')) : await hentOpslag();

  for (const pf of ['facebook', 'instagram']) {
    if (PLATFORM && PLATFORM !== pf) continue;
    const pr = new Map();
    for (const o of raekker) if (o.platform === pf && o.visninger != null) { (pr.get(o.konto_id) || pr.set(o.konto_id, []).get(o.konto_id)).push(o); }
    const opslag = [];
    let konti = 0;
    for (const liste of pr.values()) {
      if (liste.length < 5) continue;   // en konto med faerre har ikke noget brugbart "normalt opslag"
      konti++;
      const med = median(liste.map(o => o.visninger));
      const l = liste.map(o => Math.log((o.visninger + 1) / (med + 1)));
      const snit = l.reduce((a, b) => a + b, 0) / l.length;
      liste.forEach((o, i) => opslag.push({ x: l[i] - snit, r: med > 0 ? o.visninger / med : null, ...dansk(o.oprettet_at) }));
    }
    console.log(`\n${FED}=== ${pf.toUpperCase()} ===${NUL}  ${opslag.length} opslag, ${konti} konti, seneste ${DAGE} dage, ${PERM} permutationer`);
    if (!opslag.length) { console.log('Ingen opslag med visningstal.'); continue; }
    const kl = t => `${String(t).padStart(2, '0')}-${String(t + 1).padStart(2, '0')}`;
    vis('Time på døgnet', test(opslag.map(o => ({ ...o, etiket: o.time }))).sort((a, b) => a.etiket - b.etiket), kl);
    vis('Ugedag og time', test(opslag.map(o => ({ ...o, etiket: o.dag * 24 + o.time }))).sort((a, b) => a.etiket - b.etiket), e => `${UGEDAGE[Math.floor(e / 24)]} ${kl(e % 24)}`);
  }
  console.log(`\n${GRAA}Læs det sådan: q < 0,05 = forskellen er sandsynligvis reel. "nej" betyder, at data ikke kan skelne timen fra et normalt opslag; det betyder ikke, at timen er ligegyldig. Testen viser sammenhæng, ikke årsag: butikker kan også vælge bestemte opslag til bestemte tider. Færdig på ${((Date.now() - start) / 1000).toFixed(1)} s.${NUL}\n`);
}
main().catch(e => { console.error('\n' + e.message); process.exit(1); });
