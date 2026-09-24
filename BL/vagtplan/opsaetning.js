// Oversaetter mellem vagtplanens opsaetning (det motor.js regner paa) og en simpel
// "medarbejder"-model, som medarbejder-dialogen i index.html redigerer. Ingen persondata her --
// den ligger kun i Supabase.
//
// Én medarbejder i modellen:
//   { id, navn, email, loen: { type: 'ingen' | 'time' | 'fast', beloeb } (kr./time eller kr./md.),
//     type: 'L'|'S'|'F'|'U',
//     dage: 7 x (null = kan ikke | [fra, til]) -- mandag..soendag,
//     timer: { art: 'ingen' } | { art: 'min', t } (snit over 4 uger) | { art: 'praecis', t, fridag }
//            | { art: 'oenske', t } (gerne mindst t hver uge),
//     kunFaste, fordeles (planlaeggeren maa give ekstra vagter),
//     vagter: [{ d, s, e, hold: null (hver uge) | 0-2 (weekend-hold: uge 1+4, 2+5, 3+6) }] }
(function (root) {
  const AABEN = 525, LUK_HVERDAG = 1095, LUK_WEEKEND = 1035;
  // Butikkens standard-regler kommer fra motor.js (samme fil i browseren og i node)
  const STD = typeof module !== 'undefined' && module.exports ? require('./motor.js').STANDARD_REGLER : root.VagtplanStandardRegler;
  const regler = C => Object.assign({}, STD, C.butiksregler || {});
  // Butikkens aabningstid en given dag -- null = lukket
  const aab = (C, d) => { const v = regler(C).aabning[d]; return v && v[1] > v[0] ? v : null; };
  const FRIDAG_TEKST = 'skal arbejde man/ons/fre eller tirs/tors (fridag imellem)';

  // Samme regel som motor.js' av(): lukket dag, ikkeDage, saa tid.dage[d], saa hverdag/weekend.
  // null i en tid betyder butikkens aabning/lukketid den dag.
  function tilgaengelig(t, d, C) {
    const a = aab(C, d);
    if (!a) return null;
    if (t.ikkeDage && t.ikkeDage.includes(d)) return null;
    const v = t.dage && t.dage[d] !== undefined ? t.dage[d] : d > 4 ? t.weekend : t.hverdag;
    if (v === null) return null;
    if (v === undefined) return a.slice();
    return [v[0] == null ? a[0] : v[0], v[1] == null ? a[1] : v[1]];
  }
  // Tilbage fra 7 dage til den kompakte form: hverdag/weekend = den tid flest af gruppens
  // dage har, ikkeDage = dagene uden kryds, og dage = de enkelte dage med andre tider. En tid
  // der er lig butikkens aabning/lukketid (paa alle de dage den gaelder) gemmes som null, saa
  // den foelger med, hvis aabningstiderne aendres.
  function kompakt(dage, C) {
    const tid = {};
    [[[0, 1, 2, 3, 4], 'hverdag'], [[5, 6], 'weekend']].forEach(([ds, felt]) => {
      const aabne = ds.filter(d => dage[d]);
      if (!aabne.length) { tid[felt] = null; return; }
      const tael = {}; aabne.forEach(d => { const k = dage[d].join('-'); tael[k] = (tael[k] || 0) + 1; });
      const std = Object.keys(tael).sort((a, b) => tael[b] - tael[a])[0].split('-').map(Number);
      const bruger = aabne.filter(d => dage[d].join('-') == std.join('-'));
      const s0 = bruger.every(d => aab(C, d) && aab(C, d)[0] == std[0]) ? null : std[0];
      const s1 = bruger.every(d => aab(C, d) && aab(C, d)[1] == std[1]) ? null : std[1];
      if (!(s0 == null && s1 == null)) tid[felt] = [s0, s1];
      ds.forEach(d => {
        if (!dage[d]) { if (aab(C, d)) (tid.ikkeDage = tid.ikkeDage || []).push(d); }
        else if (dage[d].join('-') != std.join('-')) (tid.dage = tid.dage || {})[d] = dage[d].slice();
      });
    });
    return tid;
  }

  function tilModel(C) {
    const faste = C.faste || [], rot = C.weekendRotation || [], fyld = C.fyldere || [];
    return C.personer.map(p => {
      const t = p.tid || {};
      const ug = (C.ugeTimer || []).find(x => x.p == p.id), mn = (C.minSnit || []).find(x => x.p == p.id), ma = (C.maalTimer || []).find(x => x.p == p.id);
      const timer = mn ? { art: 'min', t: mn.timer } : ug ? { art: 'praecis', t: ug.timer, fridag: !!ug.dagMoenstre } : ma ? { art: 'oenske', t: ma.timer } : { art: 'ingen' };
      const vagter = faste.filter(x => x.p == p.id).map(x => ({ d: x.d, s: x.s, e: x.e, hold: x.rotation == null ? null : x.rotation }))
        .concat(...rot.map((hold, h) => hold.filter(x => x.p == p.id).map(x => ({ d: x.d, s: x.s, e: x.e, hold: h }))));
      return {
        id: p.id, navn: p.navn, email: p.email || '', type: p.type,
        loen: typeof p.timeloen == 'number' ? { type: 'time', beloeb: p.timeloen } : typeof p.maanedsloen == 'number' ? { type: 'fast', beloeb: p.maanedsloen } : { type: 'ingen', beloeb: null },
        dage: [0, 1, 2, 3, 4, 5, 6].map(d => tilgaengelig(t, d, C)),
        timer, kunFaste: !!p.kunFaste, fordeles: fyld.includes(p.id), vagter,
      };
    });
  }

  // Tilbage til opsaetningen. Alt der ikke handler om medarbejderne (titel, regler, ...)
  // beholdes. Raekkefoelgen af medarbejdere bestemmer raekkefoelgen alle steder.
  function fraModel(model, C) {
    const gammel = {}; (C.personer || []).forEach(p => { gammel[p.id] = p; });
    const personer = model.map(m => {
      const tid = kompakt(m.dage, C);
      const p = Object.assign({}, gammel[m.id] || {}, { id: m.id, navn: m.navn, type: m.type });
      delete p.tid; delete p.kunFaste; delete p.email; delete p.timeloen; delete p.maanedsloen;
      if (m.email) p.email = m.email;
      if (m.loen && m.loen.type == 'time' && m.loen.beloeb != null) p.timeloen = m.loen.beloeb;
      if (m.loen && m.loen.type == 'fast' && m.loen.beloeb != null) p.maanedsloen = m.loen.beloeb;
      if (Object.keys(tid).length) p.tid = tid;
      if (m.kunFaste) p.kunFaste = true;
      return p;
    });
    // Et weekend-hold pr. "hver N. weekend" i butikkens regler (standard 3). Faar butikken faerre
    // hold, flyttes vagter i hold der ikke findes mere over i de eksisterende.
    const nHold = Math.max(1, regler(C).weekendHver || 3);
    const faste = [], weekendRotation = Array.from({ length: nHold }, () => []);
    model.forEach(m => m.vagter.filter(v => v.d < 5 || v.hold == null).sort((a, b) => a.d - b.d || a.s - b.s)
      .forEach(v => faste.push(v.hold == null ? { p: m.id, d: v.d, s: v.s, e: v.e } : { p: m.id, d: v.d, s: v.s, e: v.e, rotation: v.hold % nHold })));
    // Weekend-hold: loerdag foer soendag, og inden for samme dag i medarbejdernes raekkefoelge
    // (samme raekkefoelge som den oprindelige opsaetning -- den bruges af weekend-aflastningen).
    weekendRotation.forEach((_, h) => [5, 6].forEach(d => model.forEach(m => m.vagter.filter(v => v.hold != null && v.hold % nHold === h && v.d == d)
      .forEach(v => weekendRotation[h].push({ p: m.id, d: v.d, s: v.s, e: v.e })))));
    const fordeles = model.filter(m => m.fordeles && !m.kunFaste);
    const hverdagsDage = m => [0, 1, 2, 3, 4].filter(d => m.dage[d]);
    // Planlaeggeren fordeler vagter i den raekkefoelge -- de eksisterende beholder deres
    // plads (ellers aendrer alle forslag sig, bare fordi én medarbejder er rettet), nye kommer sidst.
    const orden = (ids, gl) => (gl || []).filter(id => ids.includes(id)).concat(ids.filter(id => !(gl || []).includes(id)));
    return Object.assign({}, C, {
      personer, faste, weekendRotation,
      hulFyldere: orden(fordeles.filter(m => m.type != 'U').map(m => m.id), C.hulFyldere),
      fyldere: orden(fordeles.map(m => m.id), C.fyldere),
      // Planlaeggeren giver dem med et minimum ekstra hverdagsvagter (som den oprindelige
      // vagtplan gjorde for én ungarbejder).
      ekstraDage: fordeles.filter(m => m.timer.art == 'min').map(m => ({ p: m.id, dage: hverdagsDage(m), laengder: [435, 300, 240, 180], antal: 3 })),
      maalTimer: model.filter(m => m.timer.art == 'oenske').map(m => ({ p: m.id, timer: m.timer.t })),
      ugeTimer: model.filter(m => m.timer.art == 'praecis').map(m => m.timer.fridag
        ? { p: m.id, timer: m.timer.t, dagMoenstre: ['0,2,4', '1,3'], dagMoenstreTekst: FRIDAG_TEKST }
        : { p: m.id, timer: m.timer.t }),
      minSnit: model.filter(m => m.timer.art == 'min').map(m => ({ p: m.id, timer: m.timer.t })),
      standardPerson: model.some(m => m.id == C.standardPerson) ? C.standardPerson : (model.find(m => m.type == 'L') || model[0] || {}).id,
    });
  }

  // Ét menneskeligt resumé pr. medarbejder (til listen og til "Regler").
  const DAG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
  const kl = m => String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const liste = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' og ' + a[a.length - 1];
  function dagListe(ds) {
    const s = ds.join();
    if (s == '0,1,2,3,4,5,6') return 'alle dage';
    if (s == '0,1,2,3,4') return 'hverdage';
    if (s == '5,6') return 'weekend';
    const loeb = [];
    ds.forEach(d => { const l = loeb[loeb.length - 1]; if (l && l[1] == d - 1) l[1] = d; else loeb.push([d, d]); });
    // 3+ dage i traek skrives som "onsdag–fredag", ellers dagene enkeltvis
    return liste([].concat(...loeb.map(([a, b]) => b - a >= 2 ? [DAG[a] + '–' + DAG[b]] : ds.filter(d => d >= a && d <= b).map(d => DAG[d]))));
  }
  function beskriv(m) {
    const dele = [];
    if (m.timer.art == 'min') dele.push(`mindst ${m.timer.t} timer om ugen i snit over 4 uger`);
    if (m.timer.art == 'praecis') dele.push(`${m.timer.t} timer hver uge` + (m.timer.fridag ? ', man/ons/fre eller tirs/tors (fridag imellem)' : ''));
    if (m.timer.art == 'oenske') dele.push(`gerne mindst ${m.timer.t} timer om ugen`);
    const v = m.vagter.slice().sort((a, b) => a.d - b.d || a.s - b.s).map(x => `${DAG[x.d]} ${kl(x.s)}–${kl(x.e)}${x.hold == null ? '' : ` (weekend-hold ${x.hold + 1})`}`);
    if (v.length) dele.push('faste vagter ' + liste(v));
    if (m.kunFaste) dele.push('kun de faste vagter');
    else {
      // Dage med samme tider samles: "mandag–tirsdag og torsdag–fredag 15:15–18:15"
      const grupper = {};
      m.dage.forEach((v, d) => { if (v) { const k = kl(v[0]) + '–' + kl(v[1]); (grupper[k] = grupper[k] || []).push(d); } });
      const kan = Object.keys(grupper).map(k => dagListe(grupper[k]) + ' ' + k);
      dele.push(kan.length ? 'kan arbejde ' + liste(kan) : 'kan ikke arbejde nogen dage');
    }
    return dele.join('; ');
  }

  // Butikkens regler som tekst (til "Regler") -- skrevet ud fra felterne, saa de altid passer.
  function beskrivRegler(C) {
    const R = regler(C), ud = [];
    const grupper = {};
    [0, 1, 2, 3, 4, 5, 6].forEach(d => { const a = aab(C, d), k = a ? kl(a[0]) + '–' + kl(a[1]) : 'lukket'; (grupper[k] = grupper[k] || []).push(d); });
    ud.push({ titel: 'Åbningstider', tekst: liste(Object.keys(grupper).map(k => dagListe(grupper[k]) + ' ' + k)) + '.' });
    const linje = bp => bp.slice().sort((a, b) => a.fra - b.fra).map(b =>
      'fra ' + kl(b.fra) + (b.ellerFra != null ? ' (eller ' + kl(b.ellerFra) + ')' : '') + ' ' +
      (b.min == b.max ? 'præcis ' + b.min : b.min == 0 ? 'højst ' + b.max : b.min + '–' + b.max) + ' på arbejde').join(', ');
    const bem = R.bemanding || {};
    if (bem.weekend) {
      ud.push({ titel: 'Bemanding på hverdage', tekst: linje(bem.hverdag || []) + '.' });
      ud.push({ titel: 'Bemanding i weekenden', tekst: linje(bem.weekend) + '.' });
    } else ud.push({ titel: 'Bemanding', tekst: linje(bem.hverdag || []) + '.' });
    ud.push({ titel: 'Generelt', tekst: [
      'Aldrig mere end ' + R.maksAltid + ' på arbejde ad gangen.',
      'En vagt er mindst ' + String(R.minVagt / 60).replace('.', ',') + ' timer.',
      R.ansvarlig ? 'Der skal altid være en ansvarlig, som ikke er ungarbejder – ungarbejdere kan ikke stå alene.' : '',
      'Alle arbejder højst hver ' + R.weekendHver + '. weekend, og helst kun lørdag eller søndag.',
    ].filter(Boolean).join(' ') });
    return ud;
  }

  const API = { tilModel, fraModel, beskriv, beskrivRegler, regler, AABEN, LUK_HVERDAG, LUK_WEEKEND };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.VagtplanOpsaetning = API;
})(this);
