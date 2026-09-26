// Vagtplan-assistentens logik, uden DOM: hvad AI'en faar at vide om planen (kontekst), og
// hvordan dens handlinger udfoeres paa planen (udfoer). AI'en forstaar kun sproget -- selve
// planlaegningen (afloesere, regler, huller) klares af motor.js, saa planen altid overholder
// reglerne, uanset hvad AI'en foreslaar.
//
// Arbejder paa den samme form som vagtplanens snapshot (index.html: snap()):
//   { plan: { t2, ekstra, ekstraRegel, start, holdStart, vagter, undtagelser }, opsaetning }
// og returnerer en ny, som siden saa kan vise som forslag og anvende (kan fortrydes).
//
// Ingen persondata her -- navnene kommer fra opsaetningen i Supabase.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const lavMotor = node ? require('./motor.js').lavMotor : root.lavVagtplanMotor;
  const O = node ? require('./opsaetning.js') : root.VagtplanOpsaetning;

  const DAG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
  const DAG_KORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
  const kl = m => String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const timer = h => String(Math.round(h * 100) / 100).replace('.', ',');
  // "15:15", "15.15", "9:00", "15" -> minutter, rundet til hele kvarterer. Ugyldigt -> null.
  function tilMin(t) {
    if (t == null || t === '') return null;
    const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(String(t).trim());
    if (!m || +m[1] > 24 || +(m[2] || 0) > 59) return null;
    return Math.round((+m[1] * 60 + +(m[2] || 0)) / 15) * 15;
  }
  // Datoer regnes i hele dage (UTC), saa sommertid ikke giver skaeve dage.
  const dagNr = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) / 864e5 : NaN; };
  const fraDagNr = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };
  const lokalDato = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  function isoUge(n) {
    const t = new Date(n * 864e5), wd = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - wd);
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  }
  // "tir 6/10"
  const datoTekst = s => { const n = dagNr(s), t = new Date(n * 864e5); return DAG_KORT[(t.getUTCDay() + 6) % 7] + ' ' + t.getUTCDate() + '/' + (t.getUTCMonth() + 1); };
  const noegle = x => [x.w, x.d, x.p, x.s, x.e].join();
  const rens = x => { const y = { w: x.w, d: x.d, p: x.p, s: x.s, e: x.e }; if (x.laast) y.laast = true; return y; };

  function motorFra(o) {
    const pl = o.plan, M = lavMotor(o.opsaetning, { rullende: false, holdStart: pl.holdStart });
    M.T2 = M.T2VALG.includes(pl.t2) ? pl.t2 : M.T2VALG[0];
    M.EKSTRA = pl.ekstra; M.EKSTRA_REGEL = pl.ekstraRegel; M.START = pl.start;
    M.S = (pl.vagter || []).filter(x => M.P[x.p] && x.w < M.NW).map(rens);
    M.saetUndtagelser(pl.undtagelser, pl.start);
    return M;
  }

  // Navnet AI'en (eller lederen) skriver -> medarbejderens id. Praecist, saa begyndelsen af
  // navnet, saa det naermeste stavemaessigt (Freja/Freya) -- men kun hvis det er entydigt.
  function afstand(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function findPerson(C, navn) {
    const n = String(navn || '').trim().toLowerCase();
    if (!n) return null;
    const ps = C.personer, lav = p => p.navn.toLowerCase();
    const ens = ps.filter(p => lav(p) == n || lav(p).split(' ')[0] == n);
    if (ens.length == 1) return ens[0].id;
    const start = ps.filter(p => lav(p).startsWith(n));
    if (start.length == 1) return start[0].id;
    const afst = ps.map(p => ({ p, a: afstand(lav(p).split(' ')[0], n.split(' ')[0]) })).sort((x, y) => x.a - y.a);
    if (afst.length && afst[0].a <= 2 && (afst.length == 1 || afst[1].a > afst[0].a)) return afst[0].p.id;
    return null;
  }

  // ---------- Kontekst til AI'en ----------
  // Kompakt tekst om planen. Loen og e-mail sendes IKKE med -- kun det planlaegningen kraever.
  function kontekst(o, idag, info) {
    info = info || {};
    const M = motorFra(o), C = o.opsaetning, s0 = dagNr(o.plan.start), i0 = dagNr(lokalDato(idag || new Date()));
    const dato = (w, d) => fraDagNr(s0 + 7 * w + d);
    const navn = p => p == 'uk' ? 'Ekstra person' : M.P[p][0];
    const ud = [];
    const idagD = (new Date(i0 * 864e5).getUTCDay() + 6) % 7;
    ud.push(`I dag er det ${DAG[idagD]} ${fraDagNr(i0)} (uge ${isoUge(i0)}).`);
    ud.push(`Vagtplan: "${info.planNavn || 'Vagtplan'}"${info.butik ? ' for ' + info.butik : ''}, ${M.NW} ${M.NW == 1 ? 'uge' : 'uger'}: uge ${isoUge(s0)}–${isoUge(s0 + 7 * (M.NW - 1))}, fra mandag ${dato(0, 0)} til søndag ${dato(M.NW - 1, 6)}.`);
    ud.push('', 'Butikkens regler:');
    O.beskrivRegler(C).forEach(r => ud.push(`- ${r.titel}: ${r.tekst}`));
    if (C.noter) ud.push(`- Andre aftaler: ${C.noter}`);
    const job = C.jobtyper || {};
    ud.push('', 'Medarbejdere (brug præcis disse navne):');
    O.tilModel(C).forEach(m => ud.push(`- ${m.navn} (${job[m.type] || m.type}): ${O.beskriv(m)}.`));
    ud.push('"Ekstra person" er en pladsholder for en ekstra medarbejder/vikar, der skal findes.');
    const und = (o.plan.undtagelser || []).filter(u => M.P[u.p]).sort((a, b) => dagNr(a.dato) - dagNr(b.dato));
    ud.push('', 'Aftaler på bestemte datoer: ' + (und.length ? '' : 'ingen.'));
    und.forEach(u => ud.push(`- ${navn(u.p)}: ${u.tid ? 'kan kun ' + kl(u.tid[0]) + '–' + kl(u.tid[1]) : 'fri'} ${DAG[(dagNr(u.dato) - s0 + 7000) % 7]} ${u.dato}`));
    ud.push('', 'Vagter (🔒 = låst fast):');
    for (let w = 0; w < M.NW; w++) {
      ud.push(`Uge ${isoUge(s0 + 7 * w)} (${dato(w, 0)} – ${dato(w, 6)}):`);
      for (let d = 0; d < 7; d++) {
        const v = M.S.filter(x => x.w == w && x.d == d).sort((a, b) => a.s - b.s || a.e - b.e);
        ud.push(`  ${DAG_KORT[d]} ${dato(w, d)}: ` + (M.lukket(d) ? 'lukket' : v.length ? v.map(x => `${navn(x.p)} ${kl(x.s)}–${kl(x.e)}${x.laast ? ' 🔒' : ''}`).join(', ') : 'ingen vagter'));
      }
    }
    ud.push('', 'Timer pr. uge (uge: timer):');
    Object.keys(M.P).filter(p => p != 'uk').forEach(p => {
      const h = M.WK.map(w => M.hrs(p, w));
      ud.push(`- ${navn(p)}: ` + h.map((x, w) => `${isoUge(s0 + 7 * w)}: ${timer(x)}`).join(', ') + ` (snit ${timer(h.reduce((a, b) => a + b, 0) / M.NW)})`);
    });
    M.ext();
    const I = M.check().filter(i => !i.soft);
    ud.push('', 'Problemer lige nu: ' + (I.length ? '' : 'ingen – planen går op.'));
    I.slice(0, 25).forEach(i => ud.push(`- ${i.w < 0 ? 'Alle uger' : 'Uge ' + isoUge(s0 + 7 * i.w)}${i.d >= 0 ? ' ' + DAG[i.d] + ' ' + dato(i.w, i.d) : ''}: ${i.t}`));
    return ud.join('\n');
  }

  // ---------- Udfoer handlinger ----------
  // Handlingerne udfoeres i en fast raekkefoelge -- faste aendringer og aftaler foerst, saa de
  // gaelder, naar vagterne laegges -- og til sidst repareres de beroerte uger (eller der laves en
  // helt ny plan). log: [{ tekst, fejl? }] -- det der skete, i lederens sprog.
  const RAEKKEFOELGE = { tilgaengelighed: 0, timer: 0, fjern_aftale: 1, fri: 2, kun_tid: 2, vagt: 3, overdrag: 4, fri_antal: 5, ny_plan: 6 };
  function udfoer(o0, handlinger, valg) {
    valg = valg || {};
    const o = JSON.parse(JSON.stringify(o0));
    o.plan.undtagelser = (o.plan.undtagelser || []).slice();
    let C = o.opsaetning, M = motorFra(o);
    const und = o.plan.undtagelser, s0 = dagNr(o.plan.start);
    // Dage der er gaaet -- og i dag, hvor vagterne allerede er meldt ud -- flytter planlaeggeren
    // ikke rundt paa. Handler beskeden om i dag (fx en sygemelding), maa i dag godt rettes.
    const idagNr = valg.idag ? dagNr(lokalDato(valg.idag)) : null;
    const omIdag = idagNr != null && (Array.isArray(handlinger) ? handlinger : []).some(h => h && Array.isArray(h.datoer) && h.datoer.some(x => dagNr(x) == idagNr));
    const fraDag = idagNr == null ? null : idagNr - s0 + (omIdag ? 0 : 1);
    const log = [], uger = new Set();
    // Dem lederen har bestemt noget for (fri, tider, vagter), faar ikke nye vagter af planlaeggeren
    // -- ellers kunne en fridag blive til en anden vagt samme weekend.
    const ikkeTil = new Set();
    let nyPlan = false;
    const ok = t => log.push({ tekst: t }), fejl = t => log.push({ tekst: t, fejl: true });
    const navn = p => p == 'uk' ? 'Ekstra person' : M.P[p][0];
    const synk = () => M.saetUndtagelser(und, o.plan.start);
    const fjernUnd = (p, dato) => { for (let i = und.length - 1; i >= 0; i--) if (und[i].p == p && und[i].dato == dato) und.splice(i, 1); synk(); };
    const saetUnd = (p, dato, tid) => { fjernUnd(p, dato); und.push(tid ? { p, dato, tid } : { p, dato, tid: null }); synk(); };
    const egen = (p, w, d) => M.S.find(x => x.p == p && x.w == w && x.d == d);
    const genbyg = () => {
      const S = M.S, t2 = M.T2;
      o.opsaetning = C;
      o.plan.vagter = S; o.plan.t2 = t2;
      M = motorFra(o);
    };
    // Personen og de datoer handlingen gaelder -- kun datoer der ligger i planen
    function hvem(h, felt) {
      const p = findPerson(C, h[felt || 'navn']);
      if (!p) { fejl(`Jeg kan ikke finde en medarbejder, der hedder "${h[felt || 'navn'] || ''}".`); return null; }
      return p;
    }
    function datoer(h) {
      const ud = [], uden = [];
      [...new Set(Array.isArray(h.datoer) ? h.datoer : [])].sort().forEach(s => {
        const n = dagNr(s) - s0;
        if (n >= 0 && n < M.NW * 7) ud.push({ dato: fraDagNr(dagNr(s)), w: Math.floor(n / 7), d: n % 7 });
        else if (!isNaN(n)) uden.push(s);
      });
      if (uden.length) fejl(`${uden.map(datoTekst).join(', ')} ligger uden for vagtplanen og er sprunget over.`);
      return ud;
    }
    const liste = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' og ' + a[a.length - 1];

    const hs = (Array.isArray(handlinger) ? handlinger : []).filter(h => h && RAEKKEFOELGE[h.type] != null)
      .map((h, i) => ({ h, i })).sort((a, b) => RAEKKEFOELGE[a.h.type] - RAEKKEFOELGE[b.h.type] || a.i - b.i).map(x => x.h);
    for (const h of hs) {
      if (h.type == 'ny_plan') { nyPlan = true; continue; }
      const p = hvem(h); if (!p) continue;

      if (h.type == 'tilgaengelighed' || h.type == 'timer') {
        const model = O.tilModel(C), m = model.find(x => x.id == p);
        if (h.type == 'tilgaengelighed') {
          const fra = tilMin(h.fra), til = tilMin(h.til);
          const ds = [...new Set((h.ugedage || []).map(Number))].filter(d => d >= 0 && d <= 6 && !M.lukket(d)).sort();
          if (!ds.length) { fejl(`Jeg ved ikke, hvilke ugedage ${navn(p)}s tider skal ændres for.`); continue; }
          const rettet = [];
          ds.forEach(d => {
            if (h.kan === false) {
              m.dage[d] = null; rettet.push(d);
              // Faste vagter paa en dag personen ikke kan mere, giver ingen mening -- de fjernes
              const fv = m.vagter.filter(v => v.d == d);
              if (fv.length) { m.vagter = m.vagter.filter(v => v.d != d); ok(`${navn(p)}s faste vagt ${DAG[d]} ${fv.map(v => kl(v.s) + '–' + kl(v.e)).join(', ')} er fjernet.`); }
              return;
            }
            const [a, b] = M.O(d), s = fra != null ? Math.max(a, fra) : a, e = til != null ? Math.min(b, til) : b;
            if (e - s < M.MIN_VAGT) { fejl(`${DAG[d]}: ${kl(s)}–${kl(e)} er kortere end en vagt.`); return; }
            m.dage[d] = [s, e]; rettet.push(d);
          });
          if (!rettet.length) continue;
          ok(`${navn(p)} ${h.kan === false ? 'kan ikke længere arbejde' : 'kan nu arbejde'} ${liste(rettet.map(d => DAG[d] + 'e'))}${h.kan === false || (fra == null && til == null) ? '' : ' ' + kl(m.dage[rettet[0]][0]) + '–' + kl(m.dage[rettet[0]][1])} (gælder fremover).`);
        } else {
          const art = ['ingen', 'min', 'praecis', 'oenske'].includes(h.timeart) ? h.timeart : null, t = Number(String(h.timer).replace(',', '.'));
          if (!art || (art != 'ingen' && !(t > 0 && t <= 60))) { fejl(`Jeg forstod ikke, hvor mange timer ${navn(p)} skal have.`); continue; }
          m.timer = art == 'ingen' ? { art } : art == 'praecis' ? { art, t, fridag: !!m.timer.fridag } : { art, t };
          ok(`${navn(p)}: ${art == 'ingen' ? 'intet timekrav' : art == 'min' ? `mindst ${timer(t)} timer om ugen i snit` : art == 'praecis' ? `præcis ${timer(t)} timer hver uge` : `gerne mindst ${timer(t)} timer om ugen`} (gælder fremover).`);
        }
        C = O.fraModel(model, C); genbyg();
        // Gaelder fremover: uger der er gaaet, roeres ikke
        M.WK.forEach(w => { if (fraDag == null || w >= Math.floor(fraDag / 7)) uger.add(w); });
        continue;
      }

      if (['fri', 'fri_antal', 'kun_tid', 'vagt'].includes(h.type)) ikkeTil.add(p);
      const ds = datoer(h);
      if (!ds.length) { if (!(h.datoer || []).length) fejl(`Jeg ved ikke, hvilke datoer det gælder for ${navn(p)}.`); continue; }

      if (h.type == 'fri') {
        ds.forEach(({ dato, w, d }) => { saetUnd(p, dato, null); const x = egen(p, w, d); if (x) delete x.laast; uger.add(w); });
        ok(`${navn(p)} har fri ${liste(ds.map(x => datoTekst(x.dato)))}.`);
      } else if (h.type == 'kun_tid') {
        const fra = tilMin(h.fra), til = tilMin(h.til);
        if (fra == null && til == null) { fejl(`Jeg forstod ikke, hvornår ${navn(p)} kan arbejde.`); continue; }
        const brugt = [];
        ds.forEach(({ dato, w, d }) => {
          if (M.lukket(d)) return;
          const [a, b] = M.O(d), s = fra != null ? Math.max(a, fra) : a, e = til != null ? Math.min(b, til) : b;
          if (e <= s) { fejl(`${datoTekst(dato)}: ${kl(s)}–${kl(e)} er ikke et tidsrum.`); return; }
          saetUnd(p, dato, [s, e]);
          const x = egen(p, w, d); if (x && (x.s < s || x.e > e)) delete x.laast;
          uger.add(w); brugt.push(`${datoTekst(dato)} ${kl(s)}–${kl(e)}`);
        });
        if (brugt.length) ok(`${navn(p)} kan kun arbejde ${liste(brugt)}.`);
      } else if (h.type == 'fjern_aftale') {
        const fjernet = [];
        ds.forEach(({ dato, w, d }) => {
          const havde = und.some(u => u.p == p && u.dato == dato), x = egen(p, w, d);
          fjernUnd(p, dato);
          if (x && x.laast) delete x.laast;
          if (havde || x) fjernet.push(datoTekst(dato));
        });
        ok(fjernet.length ? `Aftalerne for ${navn(p)} ${liste(fjernet)} er fjernet.` : `${navn(p)} havde ingen aftaler de dage.`);
      } else if (h.type == 'vagt') {
        if ((h.fra && tilMin(h.fra) == null) || (h.til && tilMin(h.til) == null)) { fejl(`Jeg forstod ikke tidspunktet for ${navn(p)}s vagt.`); continue; }
        const lagt = [];
        ds.forEach(({ dato, w, d }) => {
          if (M.lukket(d)) { fejl(`Butikken har lukket ${datoTekst(dato)}.`); return; }
          const x = lagVagt(p, dato, w, d, tilMin(h.fra), tilMin(h.til));
          if (x) { lagt.push(`${datoTekst(dato)} ${kl(x.s)}–${kl(x.e)}`); uger.add(w); }
        });
        if (lagt.length) ok(`${navn(p)} skal arbejde ${liste(lagt)} (låst).`);
      } else if (h.type == 'overdrag') {
        const q = hvem(h, 'til_navn'); if (!q) continue;
        const givet = [];
        ds.forEach(({ dato, w, d }) => {
          const x = egen(p, w, d);
          if (!x) { fejl(`${navn(p)} har ingen vagt ${datoTekst(dato)}.`); return; }
          if (egen(q, w, d)) { fejl(`${navn(q)} har allerede en vagt ${datoTekst(dato)}.`); return; }
          // Lederens besked gaelder, ogsaa hvis det er uden for q's normale tider
          if (!M.kanTage(q, w, d, x.s, x.e)) saetUnd(q, dato, [x.s, x.e]);
          x.p = q; x.laast = true; uger.add(w);
          givet.push(`${datoTekst(dato)} ${kl(x.s)}–${kl(x.e)}`);
        });
        if (givet.length) ok(`${navn(q)} overtager ${navn(p)}s vagt ${liste(givet)}.`);
      } else if (h.type == 'fri_antal') {
        const antal = Math.max(0, Math.round(Number(h.antal) || 0));
        const kand = ds.filter(({ w, d }) => { const x = egen(p, w, d); return x && !x.laast && !(w * 7 + d < fraDag); });
        const valgt = [];
        // Proev hver mulig dag: giv fri, reparer ugen, og se hvor godt planen saa gaar op.
        // Den dag der er nemmest at daekke, vinder -- og saa videre, til der er antal dage.
        for (let k = 0; k < antal && kand.length; k++) {
          let bedst = null;
          kand.forEach((c, j) => {
            const S0 = M.S;
            M.S = S0.map(x => Object.assign({}, x));
            saetUnd(p, c.dato, null);
            M.reparer([c.w], { runder: valg.proeveRunder != null ? valg.proeveRunder : 200, ikkeTil, fraDag });
            const pt = M.vurder().point;
            if (!bedst || pt < bedst.pt) bedst = { pt, j, S: M.S };
            fjernUnd(p, c.dato); M.S = S0;
          });
          const c = kand.splice(bedst.j, 1)[0];
          saetUnd(p, c.dato, null); M.S = bedst.S;
          valgt.push(c); uger.add(c.w);
        }
        valgt.sort((a, b) => a.w - b.w || a.d - b.d);
        if (valgt.length) ok(`${navn(p)} får fri ${liste(valgt.map(c => datoTekst(c.dato)))} – de dage var nemmest at dække.`);
        if (valgt.length < antal) fejl(`${navn(p)} har kun ${valgt.length} ${valgt.length == 1 ? 'vagt' : 'vagter'} i perioden, der kan blive til fridage (ikke ${antal}).`);
      }
    }

    // Laeg (eller ret) p's vagt paa datoen og laas den. fra/til kan mangle -- saa vaelges tiden.
    function lagVagt(p, dato, w, d, fra, til) {
      const [a, b] = M.O(d), faste = M.fasteNoegler();
      // Har personen fri den dag, gaelder lederens nye besked
      if (M.undtagelse(p, w, d) === null) fjernUnd(p, dato);
      const x = egen(p, w, d);
      if (fra == null && til == null) {
        if (x) { x.laast = true; return x; }
        // Normalt ikke den dag -- men lederen siger, personen skal
        if (!M.av(p, d, w)) saetUnd(p, dato, [a, b]);
        // Muligheder: overtag en vagt der ikke ligger fast (saa resten af dagen er uroert), eller
        // en ny vagt dér hvor der mangler folk. Hver proeves af med en reparation af ugen, og den
        // der giver den bedste plan, vinder -- at overtage en ungarbejders vagt kan fx bryde
        // hendes minimum, at overtage den ansvarliges kan efterlade to ungarbejdere alene.
        const muligheder = [];
        M.S.forEach((y, i) => { if (y.w == w && y.d == d && !y.laast && !faste.has(noegle(y)) && M.kan(p, y)) muligheder.push({ i, straf: y.p == 'uk' ? 0 : 6 }); });
        const r = M.best(p, w, d, M.LEN);
        if (r) muligheder.push({ ny: [r.s, r.e], straf: 0 });
        if (!muligheder.length) { fejl(`${navn(p)} kan ikke få en vagt ${datoTekst(dato)}.`); return null; }
        const S0 = M.S;
        let bedst = null;
        muligheder.forEach(m => {
          M.S = S0.map(y => Object.assign({}, y));
          let x;
          if (m.ny) M.S.push(x = { w, d, p, s: m.ny[0], e: m.ny[1], laast: true });
          else { x = M.S[m.i]; x.p = p; x.laast = true; }
          if (muligheder.length > 1) M.reparer([w], { runder: 300, ikkeTil, fraDag });
          const pt = M.vurder().point + m.straf;
          if (!bedst || pt < bedst.pt) bedst = { pt, S: M.S };
          M.S = S0;
        });
        // (reparationen arbejder paa kopier, saa vagten findes igen i den valgte udgave)
        M.S = bedst.S;
        return egen(p, w, d);
      }
      let s = fra, e = til;
      if (s == null || e == null) {
        // Kun det ene klokkeslaet: vaelg den vagtlaengde der passer planen bedst
        let bedst = null;
        M.LEN.forEach(L => {
          const ss = s != null ? s : e - L, ee = e != null ? e : s + L;
          if (ss < a || ee > b) return;
          const gl = x ? [x.s, x.e] : null, y = x || { w, d, p, s: ss, e: ee };
          if (x) { x.s = ss; x.e = ee; } else M.S.push(y);
          const pt = M.vurder().point;
          if (x) { x.s = gl[0]; x.e = gl[1]; } else M.S.pop();
          if (!bedst || pt < bedst.pt) bedst = { pt, s: ss, e: ee };
        });
        if (!bedst) { s = s != null ? s : Math.max(a, e - M.MIN_VAGT); e = e != null ? e : Math.min(b, s + M.MIN_VAGT); }
        else { s = bedst.s; e = bedst.e; }
      }
      s = Math.max(a, s); e = Math.min(b, e);
      if (e - s < M.MIN_VAGT) { fejl(`${datoTekst(dato)}: en vagt skal være mindst ${timer(M.MIN_VAGT / 60)} timer (${kl(s)}–${kl(e)} er for kort).`); return null; }
      if (!M.kanTage(p, w, d, s, e)) saetUnd(p, dato, [s, e]);
      if (x) { x.s = s; x.e = e; x.laast = true; return x; }
      // Samme tider som en vagt der ikke ligger fast (ekstra person foerst)? Saa overtages den.
      const y = M.S.filter(y => y.w == w && y.d == d && y.s == s && y.e == e && !y.laast && !faste.has(noegle(y)))
        .sort((u, v) => (v.p == 'uk') - (u.p == 'uk'))[0];
      if (y) { y.p = p; y.laast = true; return y; }
      const ny = { w, d, p, s, e, laast: true };
      M.S.push(ny);
      return ny;
    }

    if (nyPlan) { M.foreslaa(valg.runder); ok('Hele planen er lavet forfra efter reglerne og aftalerne.'); }
    else if (uger.size) { M.reparer([...uger], { runder: valg.runder, ikkeTil, fraDag }); tilbage(); }

    // Oprydning: planlaeggeren kan have flyttet vagter, som lige saa godt kunne blive hos den der
    // havde dem (fx en byttet weekend, der hverken er bedre eller daarligere). De gives tilbage --
    // én ad gangen og parvis -- naar det ikke giver nye regelbrud og planen hoejst bliver en smule
    // daarligere (samme graense som reparer()'s straf for at flytte en vagt). Saa ser lederen kun
    // de aendringer, der er brug for.
    function tilbage() {
      const k = x => [x.w, x.d, x.s, x.e].join(), foer = new Map();
      motorFra(o0).S.forEach(x => { if (!foer.has(k(x))) foer.set(k(x), []); foer.get(k(x)).push(x.p); });
      const enDagOk = (p, x) => p == 'uk' || (M.kanTage(p, x.w, x.d, x.s, x.e) && M.S.filter(y => y.p == p && y.w == x.w && y.d == x.d).length == 1);
      let nu = M.vurder();
      const proev = (par) => {
        const gl = par.map(([y]) => y.p);
        par.forEach(([y, q]) => { y.p = q; });
        let ok = par.every(([y, q]) => enDagOk(q, y));
        if (ok) { const v = M.vurder(); ok = v.hard <= nu.hard && v.point <= nu.point + 10 * par.length; if (ok) nu = v; }
        if (!ok) par.forEach(([y], i) => { y.p = gl[i]; });
        return ok;
      };
      for (let runde = 0; runde < 20; runde++) {
        const aendret = [];
        M.S.forEach(y => {
          if (y.laast || (fraDag != null && y.w * 7 + y.d < fraDag)) return;
          const ps = foer.get(k(y)) || [];
          if (!ps.length || ps.includes(y.p)) return;
          const har = M.S.filter(z => k(z) == k(y)).map(z => z.p), mangler = ps.filter(p => !har.includes(p));
          mangler.forEach(q => aendret.push([y, q]));
        });
        let bedre = aendret.some(c => proev([c]));
        for (let i = 0; !bedre && i < aendret.length; i++) for (let j = i + 1; !bedre && j < aendret.length; j++) {
          if (aendret[i][0] != aendret[j][0] && aendret[i][0].w == aendret[j][0].w) bedre = proev([aendret[i], aendret[j]]);
        }
        if (!bedre) break;
      }
    }
    o.opsaetning = C;
    o.plan.t2 = M.T2;
    o.plan.vagter = M.S.map(rens);
    o.plan.undtagelser = und.filter(u => M.P[u.p]).sort((a, b) => dagNr(a.dato) - dagNr(b.dato) || String(a.p).localeCompare(b.p));
    return { ny: o, log, uger: nyPlan ? M.WK.slice() : [...uger].sort((a, b) => a - b) };
  }

  // ---------- Forskel mellem to udgaver ----------
  // Til forslags-kortet: hvad der er aendret, dag for dag.
  //   vagter: [{ w, d, dato, type: 'ny'|'fjernet'|'person'|'tid'|'laast', p, q (ny person), s, e, fra: [s,e] }]
  //   aftaler: [{ dato, p, type: 'ny'|'fjernet', tid }], medarbejdere: [{ p, navn, foer, efter }]
  function forskel(a, b) {
    const Ma = motorFra(a), Mb = motorFra(b), s0 = dagNr(b.plan.start);
    const navn = p => p == 'uk' ? 'Ekstra person' : ((Mb.P[p] || Ma.P[p] || [p])[0]);
    const vagter = [];
    for (let w = 0; w < Math.max(Ma.NW, Mb.NW); w++) for (let d = 0; d < 7; d++) {
      const dato = fraDagNr(s0 + 7 * w + d), ra = Ma.S.filter(x => x.w == w && x.d == d), rb = Mb.S.filter(x => x.w == w && x.d == d);
      const tag = (fn, lav) => ra.slice().forEach(x => {
        const j = rb.findIndex(y => fn(x, y)); if (j < 0) return;
        const y = rb[j]; lav(x, y); ra.splice(ra.indexOf(x), 1); rb.splice(j, 1);
      });
      tag((x, y) => x.p == y.p && x.s == y.s && x.e == y.e, (x, y) => { if (y.laast && !x.laast) vagter.push({ w, d, dato, type: 'laast', p: y.p, s: y.s, e: y.e }); });
      tag((x, y) => x.p == y.p && x.p != 'uk', (x, y) => vagter.push({ w, d, dato, type: 'tid', p: y.p, s: y.s, e: y.e, fra: [x.s, x.e], laast: !!y.laast }));
      tag((x, y) => x.s == y.s && x.e == y.e, (x, y) => vagter.push({ w, d, dato, type: 'person', p: x.p, q: y.p, s: y.s, e: y.e, laast: !!y.laast }));
      ra.forEach(x => vagter.push({ w, d, dato, type: 'fjernet', p: x.p, s: x.s, e: x.e }));
      rb.forEach(y => vagter.push({ w, d, dato, type: 'ny', p: y.p, s: y.s, e: y.e, laast: !!y.laast }));
    }
    vagter.forEach(v => { v.navn = navn(v.p); if (v.q) v.qNavn = navn(v.q); });
    const ua = a.plan.undtagelser || [], ub = b.plan.undtagelser || [], k = u => u.p + '|' + u.dato + '|' + JSON.stringify(u.tid || null);
    const aftaler = ub.filter(u => !ua.some(v => k(v) == k(u))).map(u => ({ dato: u.dato, p: u.p, navn: navn(u.p), type: 'ny', tid: u.tid || null }))
      .concat(ua.filter(u => !ub.some(v => k(v) == k(u)) && !ub.some(v => v.p == u.p && v.dato == u.dato)).map(u => ({ dato: u.dato, p: u.p, navn: navn(u.p), type: 'fjernet', tid: u.tid || null })))
      .sort((x, y) => dagNr(x.dato) - dagNr(y.dato));
    const ma = O.tilModel(a.opsaetning), mb = O.tilModel(b.opsaetning);
    const medarbejdere = mb.map(m => { const f = ma.find(x => x.id == m.id); return f && O.beskriv(f) != O.beskriv(m) ? { p: m.id, navn: m.navn, foer: O.beskriv(f), efter: O.beskriv(m) } : null; }).filter(Boolean);
    return { vagter, aftaler, medarbejdere };
  }

  // Regelbrud (ikke oensker) i en udgave af planen
  function problemer(o) { const M = motorFra(o); M.ext(); return M.check().filter(i => !i.soft); }
  // Oensker der ikke er opfyldt (fx en weekend med baade loerdag og soendag)
  function oensker(o) { const M = motorFra(o); M.ext(); return M.check().filter(i => i.soft); }

  const API = { kontekst, udfoer, forskel, problemer, oensker, findPerson, tilMin, datoTekst, dagNr, fraDagNr, isoUge, motorFra, DAG, DAG_KORT, kl };
  if (node) module.exports = API;
  else root.VagtplanAssistent = API;
})(this);
