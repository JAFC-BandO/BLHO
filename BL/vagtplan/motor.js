// Vagtplan-motoren: selve planlaegningen og regeltjekket, uden DOM og uden persondata.
// Alt om de konkrete medarbejdere (navne, jobtype, hvornaar de kan, faste vagter, weekend-
// rotation, timekrav) kommer fra opsaetningen i Supabase-tabellen `vagtplan` -- intet af det
// maa staa her, fordi repoet er offentligt. Butikkens regler (aabningstider, bemanding, max
// paa arbejde, mindste vagt, ansvarlig, weekender) kommer fra C.butiksregler; mangler de,
// bruges STANDARD_REGLER nedenfor (den oprindelige vagtplans regler).
//
// Tider er minutter efter midnat (525 = 08:45). Dage er 0-6 (mandag-soendag). Uger er 0 til
// planens antal uger - 1 (C.uger: 3, 6, 9 eller 12; standard 6).
(function (root) {
  // Butikkens regler. aabning: [fra, til] pr. ugedag (null = lukket). bemanding: tidslinjer
  // for hverdage og weekend (weekend: null = samme som hverdage) -- hver linje gaelder fra
  // "fra" og til naeste linje eller lukketid; "ellerFra" er et alternativt starttidspunkt
  // planlaeggeren maa vaelge (det der var "2 pers. fra 15:00 eller 15:15"). maksAltid: aldrig
  // flere paa arbejde ad gangen. minVagt: mindste vagt i minutter. ansvarlig: der skal altid
  // vaere én der ikke er ungarbejder (og ungarbejdere kan ikke staa alene). weekendHver: alle
  // arbejder hoejst hver N. weekend.
  const STANDARD_REGLER = {
    aabning: [[525, 1095], [525, 1095], [525, 1095], [525, 1095], [525, 1095], [525, 1035], [525, 1035]],
    bemanding: {
      hverdag: [{ fra: 525, min: 1, max: 1 }, { fra: 600, min: 2, max: 2 }, { fra: 780, min: 1, max: 2 }, { fra: 900, ellerFra: 915, min: 2, max: 2 }],
      weekend: null,
    },
    maksAltid: 2, minVagt: 180, ansvarlig: true, weekendHver: 3,
  };

  // valg.rullende (standard true): planen gentager sig, saa sidste uge efterfoelges af foerste
  //   (saadan var den oprindelige vagtplan). false = en periode med datoer, der ikke gentager
  //   sig -- saa kan den have et vilkaarligt antal uger.
  // valg.holdStart (0-2): hvilket weekend-hold planens foerste uge har. Saa fortsaetter holdene
  //   fra én periode til den naeste, uanset hvor mange uger perioderne har.
  function lavMotor(C, valg) {
    valg = valg || {};
    const RULLENDE = valg.rullende !== false, HOLD_START = [0, 1, 2].includes(valg.holdStart) ? valg.holdStart : 0;
    const R = C.jobtyper;
    const RG = Object.assign({}, STANDARD_REGLER, C.butiksregler || {});
    RG.bemanding = Object.assign({}, STANDARD_REGLER.bemanding, RG.bemanding || {});
    // Raekkefoelgen i C.personer bestemmer raekkefoelgen i dropdown, timetabel og advarsler.
    // 'uk' (ekstra person) er motorens eget begreb og tilfoejes altid sidst.
    const P = {}, TID = {};
    C.personer.forEach(p => { P[p.id] = [p.navn, p.type]; TID[p.id] = p.tid || {}; });
    P.uk = ['Ekstra person', 'S']; TID.uk = {};
    const D = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
    // Aabningstid pr. dag; en lukket dag er et tomt tidsrum (ingen krav, ingen vagter).
    const O = d => RG.aabning[d] || [0, 0];
    const lukket = d => O(d)[1] <= O(d)[0];
    const f = m => String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const MIN_VAGT = RG.minVagt;
    const LEN0 = [180, 195, 210, 225, 240, 255, 270, 300, 330, 360, 390, 420, 435, 480, 510];
    // Vagtlaengder planlaeggeren proever: den oprindelige liste fra mindste vagt og op
    const LEN = MIN_VAGT < 180 ? Array.from({ length: (180 - MIN_VAGT) / 15 }, (_, i) => MIN_VAGT + i * 15).concat(LEN0)
      : LEN0.filter(l => l >= MIN_VAGT).length ? LEN0.filter(l => l >= MIN_VAGT) : [MIN_VAGT];
    // Bemandingens tidslinjer. FLEKS = linjen med et alternativt starttidspunkt (hoejst én).
    const tidslinje = d => (d > 4 && RG.bemanding.weekend) || RG.bemanding.hverdag;
    const FLEKS = RG.bemanding.hverdag.concat(RG.bemanding.weekend || []).find(b => b.ellerFra != null) || null;
    // Hvornaar eftermiddagsholdet tidligst kan komme -- planlaeggeren daekker hullerne foer det
    // med ekstra personer i sit foerste gennemloeb (som den oprindelige vagtplan: 15:15).
    const SKIFT = FLEKS ? FLEKS.ellerFra : Math.max(0, ...RG.bemanding.hverdag.map(b => b.fra));
    // Planens laengde i uger. En rullende plan skal gaa op i 3 (weekend-holdene skiftes hver 3.
    // weekend, og efter sidste uge kommer foerste igen); en periode kan have 1-12 uger.
    const NW = RULLENDE ? ([3, 6, 9, 12].includes(C.uger) ? C.uger : 6) : (Number.isInteger(C.uger) && C.uger >= 1 && C.uger <= 12 ? C.uger : 6);
    const WK = [...Array(NW).keys()];
    const ROT = C.weekendRotation || [], NR = ROT.length || 3;
    const holdAf = w => (w + HOLD_START) % NR; // weekend-hold for planens uge w
    // EKSTRA: hvor mange ekstra personer der maa bruges (dropdown'en). null = ingen graense og
    // ingen weekend-aflastning -- saadan opfoerte den oprindelige vagtplan sig.
    const M = {
      P, R, D, O, f, NW, WK, NR, S: [], EX: [], T2: FLEKS ? FLEKS.fra : 900, EKSTRA: null, RULLENDE, HOLD_START, holdAf,
      REGLER: RG, MIN_VAGT, lukket,
      // De starttidspunkter "Foreslå ny plan" proever for den fleksible bemandings-linje
      T2VALG: FLEKS ? [FLEKS.fra, FLEKS.ellerFra] : [FLEKS ? FLEKS.fra : 900],
      // Hvor tit en ekstra person maa arbejde weekend: afstand = mindst hver N. weekend
      // (1 = hver weekend), begge = maa tage baade loerdag og soendag samme weekend.
      // Standard = samme regel som personalet (hver 3. weekend, én dag).
      EKSTRA_REGEL: { afstand: 3, begge: false },
      // Aftaler paa bestemte datoer: 'p|w|d' -> null (fri hele dagen) eller [fra, til] (kan kun
      // i det tidsrum). Siden laegger dem ind ud fra planens datoer (plan.undtagelser).
      UNDTAG: new Map(),
    };
    // Krav pr. 15 minutter for en dag: mn = mindst, mx = hoejst paa arbejde. Afhaenger af T2
    // (hvornaar den fleksible linje starter), saa cachen nulstilles naar T2 aendres.
    let kravCache = {}, kravT2 = null;
    function krav(d) {
      if (kravT2 !== M.T2) { kravCache = {}; kravT2 = M.T2; }
      if (kravCache[d]) return kravCache[d];
      const [a, b] = O(d), n = Math.max(0, (b - a) / 15), mn = Array(n).fill(0), mx = Array(n).fill(RG.maksAltid);
      const bp = tidslinje(d).map(x => ({ fra: x.ellerFra != null && M.T2 == x.ellerFra ? x.ellerFra : x.fra, min: x.min, max: x.max })).sort((x, y) => x.fra - y.fra);
      for (let i = 0; i < n; i++) {
        const t = a + i * 15; let cur = null;
        bp.forEach(x => { if (x.fra <= t) cur = x; });
        if (cur) { mn[i] = Math.min(cur.min, RG.maksAltid); mx[i] = Math.min(cur.max, RG.maksAltid); }
      }
      return (kravCache[d] = { a, mn, mx });
    }
    const need = (t, d) => { const k = krav(d), i = (t - k.a) / 15; return k.mn[i] || 0; };
    const maks = (t, d) => { const k = krav(d), i = (t - k.a) / 15; return k.mx[i] != null ? k.mx[i] : RG.maksAltid; };

    // Weekend-aflastning: i weekend-rotationen er der folk der tager baade loerdag og soendag,
    // fordi der ikke er folk nok. Hver ekstra person kan tage én weekenddag pr. 3 uger (samme
    // regel som ext() nedenfor), saa med N ekstra personer overtages soendagen for de N foerste
    // af dem. Raekkefoelgen skifter mellem rotationens uger, saa aflastningen fordeles.
    const DOBBELT = (() => {
      const pr = ROT.map(hold => hold.filter(x => x.d == 6 && hold.some(y => y.d == 5 && y.p == x.p)));
      const ud = [];
      for (let j = 0; pr.some(l => l[j]); j++) pr.forEach((l, r) => { if (l[j]) ud.push({ r, x: l[j] }); });
      return ud;
    })();
    M.maxAflastning = DOBBELT.length;
    // Hvilke weekenddage de ekstra personer overtager (gen() bygger ud fra det, forbedr()
    // kan finpudse). Regnes EKSAKT: for hver ekstra person proeves alle de weekend-moenstre
    // EKSTRA_REGEL tillader (fx hver 3. weekend), og der vaelges den kombination der
    // aflaster flest "dobbelt-weekender" (samme person loerdag OG soendag). Uge for uge faar
    // den foerste dobbelt-person soendagen overtaget, den naeste loerdagen osv.
    let aflCache = null, aflNoegle = null;
    // Antal uger mellem to uger -- rundt om, hvis planen er rullende.
    const ugeAfstand = (a, b) => { const q = Math.abs(a - b); return RULLENDE ? Math.min(q, NW - q) : q; };
    function aflosning() {
      const rg = M.EKSTRA_REGEL, N = M.EKSTRA > 0 ? M.EKSTRA : 0;
      const k = N + '|' + rg.afstand + '|' + rg.begge;
      if (k === aflNoegle) return aflCache;
      const ud = new Set();
      if (N > 0) {
        const dob = WK.map(w => { const hold = ROT[holdAf(w)] || []; return [...new Set(hold.filter(x => x.d == 6 && hold.some(y => y.d == 5 && y.p == x.p)).map(x => x.p))]; });
        if (NW > 6) {
          // Lange planer (9-12 uger): DP'en nedenfor bliver for stor. Vaelg i stedet uge for
          // uge, og tag kun en aflastning med, hvis dagene stadig kan fordeles paa EKSTRA
          // personer efter EKSTRA_REGEL.
          const valgt = [];
          WK.forEach(w => dob[w].forEach((p, j) => {
            for (const d of j % 2 ? [5, 6] : [6, 5]) {
              if (kanFordeles(valgt.concat([{ w, d }]), N, rg)) { valgt.push({ w, d }); ud.add(w + '|' + d + '|' + p); break; }
            }
          }));
          aflNoegle = k; aflCache = ud;
          return ud;
        }
        // De weekend-moenstre én ekstra person maa have (uger med indbyrdes afstand >= afstand)
        const moenstre = [];
        for (let m = 1; m < 1 << NW; m++) {
          const ws = WK.filter(w => m >> w & 1);
          if (ws.every(x => ws.every(y => x == y || ugeAfstand(x, y) >= rg.afstand))) moenstre.push(ws);
        }
        const pr = rg.begge ? 2 : 1; // dage én ekstra kan overtage i en weekend
        // DP over de ekstra personer; tilstand = hvor mange dage der er overtaget i hver uge
        let dp = new Map([[Array(NW).fill(0).join(), { v: 0, dage: 0 }]]);
        for (let e = 0; e < N; e++) {
          const ny = new Map(dp);
          for (const [key, st] of dp) {
            const s = key.split(',').map(Number);
            for (const ws of moenstre) {
              const t = s.slice(); let dage = st.dage;
              ws.forEach(w => { const add = Math.min(pr, dob[w].length - t[w]); t[w] += add; dage += add; });
              const v = t.reduce((x, y) => x + y, 0), kk = t.join(), gl = ny.get(kk);
              if (!gl || v > gl.v || (v == gl.v && dage < gl.dage)) ny.set(kk, { v, dage });
            }
          }
          dp = ny;
        }
        let bedst = null;
        for (const [key, st] of dp) if (!bedst || st.v > bedst.st.v) bedst = { key, st };
        bedst.key.split(',').map(Number).forEach((r, w) => {
          dob[w].slice(0, r).forEach((p, j) => ud.add(w + '|' + (j % 2 ? 5 : 6) + '|' + p));
        });
      }
      aflNoegle = k; aflCache = ud;
      return ud;
    }
    const afloest = (w, x) => aflosning().has(w + '|' + x.d + '|' + x.p);
    // Kan disse weekenddage ({w, d}) fordeles paa K ekstra personer efter reglen rg?
    function kanFordeles(dage, K, rg) {
      const hvem = Array.from({ length: K }, () => []);
      const ok = (n, x) => hvem[n].every(y => {
        if (y.w == x.w && y.d == x.d) return false;
        const a = ugeAfstand(x.w, y.w); return a == 0 ? rg.begge : a >= rg.afstand;
      });
      const soeg = (j, maxN) => {
        if (j == dage.length) return true;
        for (let n = 0; n <= Math.min(maxN + 1, K - 1); n++) {
          if (!ok(n, dage[j])) continue;
          hvem[n].push(dage[j]);
          if (soeg(j + 1, Math.max(maxN, n))) return true;
          hvem[n].pop();
        }
        return false;
      };
      return soeg(0, -1);
    }

    function ext() {
      const S = M.S, EX = []; const ex = [];
      S.map((x, i) => i).filter(i => S[i].p == 'uk').sort((a, b) => S[a].w - S[b].w || S[a].d - S[b].d || S[a].s - S[b].s).forEach(i => {
        const x = S[i];
        for (let n = 0; ; n++) {
          const e = ex[n] || (ex[n] = { D: new Set(), K: [] });
          if (e.D.has(x.w + '-' + x.d)) continue;
          // Weekend-reglen for ekstra personer (EKSTRA_REGEL). Med standard-reglen (afstand 3,
          // ikke begge dage) er det praecis den oprindelige vagtplans regel.
          if (x.d > 4 && e.K.some(k => { const a = ugeAfstand(k, x.w); return a == 0 ? !M.EKSTRA_REGEL.begge : a < M.EKSTRA_REGEL.afstand; })) continue;
          e.D.add(x.w + '-' + x.d); if (x.d > 4) e.K.push(x.w); EX[i] = n + 1; break;
        }
      });
      // Den graadige fordeling ovenfor er den oprindelige vagtplans -- men den kan bruge flere
      // ekstra personer end noedvendigt. Er der valgt et antal, og bruger den flere, soeges
      // der eksakt efter en fordeling inden for antallet (faa vagter, saa det er hurtigt).
      const brugt = Math.max(0, ...EX.filter(Boolean));
      if (M.EKSTRA != null && brugt > M.EKSTRA) { const alt = fordelEksakt(M.EKSTRA); if (alt) { M.EX = alt; return; } }
      M.EX = EX;
    }
    function fordelEksakt(K) {
      const S = M.S, idx = S.map((x, i) => i).filter(i => S[i].p == 'uk');
      // Weekendvagter foerst (de har flest begraensninger)
      idx.sort((a, b) => (S[b].d > 4) - (S[a].d > 4) || S[a].w - S[b].w || S[a].d - S[b].d);
      const rg = M.EKSTRA_REGEL, hvem = [], tildelt = Array.from({ length: K }, () => []);
      let skridt = 0;
      const ok = (n, x) => tildelt[n].every(y => {
        if (y.w == x.w && y.d == x.d) return false;
        if (x.d > 4 && y.d > 4) { const a = ugeAfstand(x.w, y.w); return a == 0 ? rg.begge : a >= rg.afstand; }
        return true;
      });
      const soeg = (j, maxN) => {
        if (++skridt > 200000) return false;
        if (j == idx.length) return true;
        const x = S[idx[j]];
        for (let n = 0; n <= Math.min(maxN + 1, K - 1); n++) {
          if (!ok(n, x)) continue;
          tildelt[n].push(x); hvem[j] = n;
          if (soeg(j + 1, Math.max(maxN, n))) return true;
          tildelt[n].pop();
        }
        return false;
      };
      if (!soeg(0, -1)) return null;
      const EX = []; idx.forEach((i, j) => { EX[i] = hvem[j] + 1; });
      return EX;
    }
    const timer = m => String(m / 60).replace('.', ','); // 180 -> "3", 150 -> "2,5"
    const pm = s => { const [x, y] = s.split(':').map(Number); return x * 60 + y; };
    const nmi = i => M.S[i].p == 'uk' ? 'Ekstra person ' + (M.EX[i] || '') : P[M.S[i].p][0];

    // Hvornaar en medarbejder kan arbejde en given dag. tid.hverdag/tid.weekend: udeladt =
    // hele aabningstiden, null = aldrig, [start, slut] hvor null i et felt = aabning/lukning.
    // tid.dage: { dag: [start, slut] } for enkelte dage med andre tider end resten.
    // w (valgfri) = planens uge: saa gaelder en aftale paa datoen (M.UNDTAG) i stedet for det
    // normale -- ogsaa naar den giver flere timer end normalt ("kan godt lørdag d. 10.").
    const undtagelse = (p, w, d) => M.UNDTAG.size ? M.UNDTAG.get(p + '|' + w + '|' + d) : undefined;
    function av(p, d, w) {
      const [a, b] = O(d), t = TID[p] || {};
      if (lukket(d)) return null;
      const u = w != null ? undtagelse(p, w, d) : undefined;
      if (u !== undefined) {
        if (!u) return null;
        const s = Math.max(a, u[0]), e = Math.min(b, u[1]);
        return s < e ? [s, e] : null;
      }
      if (t.ikkeDage && t.ikkeDage.includes(d)) return null;
      const v = t.dage && t.dage[d] !== undefined ? t.dage[d] : d > 4 ? t.weekend : t.hverdag;
      if (v === null) return null;
      if (v === undefined) return [a, b];
      return [v[0] == null ? a : v[0], v[1] == null ? b : v[1]];
    }
    function cov(w, d) {
      const [a, b] = O(d), n = (b - a) / 15, c = Array(n).fill(0), m = Array(n).fill(0);
      M.S.filter(x => x.w == w && x.d == d).forEach(x => {
        for (let t = Math.max(x.s, a); t < Math.min(x.e, b); t += 15) { const i = (t - a) / 15; c[i]++; if (P[x.p][1] != 'U') m[i]++; }
      });
      return { a, c, m, d };
    }
    function sc(p, cv, s, e) {
      let v = 0; const y = P[p][1] == 'U';
      for (let t = s; t < e; t += 15) {
        const i = (t - cv.a) / 15, nd = need(t, cv.d) - cv.c[i] > 0;
        if (cv.c[i] >= maks(t, cv.d)) return -1;
        if (y) { if (RG.ansvarlig && cv.m[i] == 0) return -1; v += nd ? 1 : 0; } else v += (nd ? 1 : 0) + (RG.ansvarlig && cv.m[i] == 0 ? 2 : 0);
      }
      return v;
    }
    function best(p, w, d, lens, nz) {
      const v = av(p, d, w); if (!v) return null; const cv = cov(w, d); let r = null;
      for (const L of lens) for (let s = v[0]; s + L <= v[1]; s += 15) {
        const q = sc(p, cv, s, s + L), x = q + (nz ? Math.random() * nz : 0);
        if (!r || x > r.v) r = { s, e: s + L, v: x, q };
      }
      return r;
    }
    function run(w, d, k) {
      const cv = cov(w, d), a = cv.a, n = cv.c.length,
        fn = i => k ? need(a + i * 15, d) - cv.c[i] > 0 && (k != 2 || a + i * 15 < SKIFT) : RG.ansvarlig && cv.m[i] == 0;
      for (let i = 0; i < n; i++) if (fn(i)) { let j = i; while (j < n && fn(j)) j++; return [a + i * 15, a + j * 15]; }
    }
    // Daekker huller i dagens bemanding med ekstra personer (k: se run()).
    function daekHuller(w, d, k) {
      let g;
      while (g = run(w, d, k)) {
        const [a, b] = O(d), cv = cov(w, d); let bw = null;
        for (let s = a; s <= g[0]; s += 15) for (const e of [Math.max(g[1], s + MIN_VAGT), b]) {
          if (e > b || e < g[1] || e - s < MIN_VAGT) continue; let pen = 0;
          for (let t = s; t < e; t += 15) { const c = cv.c[(t - a) / 15]; pen += c >= maks(t, d) ? 1000 : (need(t, d) - c <= 0 ? 1 : 0); }
          if (!bw || pen <= bw.pen) bw = { s, e, pen };
        }
        if (!bw) bw = { s: g[0], e: g[1], pen: 0 };
        M.S.push({ w, d, p: 'uk', s: bw.s, e: bw.e });
      }
    }
    // Kan p tage vagten s-e dag d i uge w (ogsaa efter aftaler paa datoen)?
    const kanTage = (p, w, d, s, e) => { const v = av(p, d, w); return !!v && s >= v[0] && e <= v[1]; };
    // laast: vagter der er laast fast paa en bestemt dato ({ w, d, p, s, e, laast: true }) --
    // de laegges foerst og flyttes aldrig.
    function genWeek(w, n, laast) {
      M.S = M.S.filter(x => x.w != w);
      const S = M.S;
      const add = (d, p, s, e) => S.push({ w, d, p, s, e });
      const has = (d, p) => S.some(x => x.w == w && x.d == d && x.p == p);
      const put = (p, d, l, min) => { if (d > 4) return; const r = best(p, w, d, l, n); if (r && r.q >= min) add(d, p, r.s, r.e); };
      const uk = (d, k) => daekHuller(w, d, k);
      (laast || []).forEach(x => { if (x.w == w) S.push(Object.assign({}, x)); });
      const harLaast = (d, p) => S.some(x => x.laast && x.w == w && x.d == d && x.p == p);
      // Faste vagter. `rotation` = kun de uger hvor uge % (antal weekend-hold) er lig vaerdien.
      // Har personen fri den dag (aftale paa datoen), tager en ekstra person vagten -- har hun/han
      // en laast vagt samme dag, er det den der gaelder.
      const fastVagt = (x, p) => { if (!harLaast(x.d, x.p)) add(x.d, p == 'uk' || kanTage(p, w, x.d, x.s, x.e) ? p : 'uk', x.s, x.e); };
      (C.faste || []).forEach(x => { if (x.rotation == null || holdAf(w) == x.rotation) fastVagt(x, x.p); });
      (ROT[holdAf(w)] || []).forEach(x => fastVagt(x, afloest(w, x) ? 'uk' : x.p));
      for (let d = 0; d < 5; d++) uk(d, 2);
      for (let d = 0; d < 7; d++) { (C.hulFyldere || []).forEach(p => { if (run(w, d, 0) && !has(d, p)) put(p, d, LEN, 1); }); uk(d, 0); }
      (C.ekstraDage || []).forEach(x => {
        x.dage.map(d => ({ d, r: best(x.p, w, d, x.laengder, n) })).filter(y => y.r && y.r.q >= 0).sort((a, b) => b.r.q - a.r.q).slice(0, x.antal).forEach(y => add(y.d, x.p, y.r.s, y.r.e));
      });
      const o = n ? Math.random() * 5 | 0 : 0, q = C.fyldere || [];
      for (let d = 0; d < 7; d++) { q.map((_, i) => q[(i + w + d + o) % q.length]).forEach(p => { if (!has(d, p)) put(p, d, LEN, 4); }); uk(d, 1); }
    }
    const hrs = (p, w) => M.S.filter(x => x.p == p && x.w == w).reduce((a, x) => a + (x.e - x.s) / 60, 0);
    function gen() {
      const all = [], laast = M.S.filter(x => x.laast).map(x => Object.assign({}, x));
      for (let w = 0; w < NW; w++) {
        let bs = null, bv = 1e9;
        for (let t = 0; t < 70 && (bv >= 1e6 || t < 25) && bv > 0; t++) {
          M.S = all.slice(); genWeek(w, t ? 12 : 0, laast);
          const u = M.S.filter(x => x.w == w && x.p == 'uk'); let ov = 0;
          for (let d = 0; d < 7; d++) { const k = krav(d); cov(w, d).c.forEach((c, i) => { if (c > k.mx[i]) ov++; }); }
          const v = ov * 1e7 + u.reduce((a, x) => a + x.e - x.s, 0) * 10 + u.length + (C.maalTimer || []).reduce((a, x) => a + Math.max(0, x.timer * 60 - hrs(x.p, w) * 60) / 10, 0);
          if (v < bv) { bv = v; bs = M.S.filter(x => x.w == w); }
        }
        bs.forEach(x => all.push(x));
      }
      M.S = all;
    }
    // Regeltjekket. gennemgaa() finder alle brud og kalder emit(w, d, soft, tekst) for hvert,
    // hvor tekst er en FUNKTION -- saa den hurtige optaelling i vurder() (som planlaeggeren
    // kalder tusindvis af gange) slipper for at bygge beskederne. check() og vurder() bruger
    // altsaa praecis de samme regler og kan ikke komme ud af trit med hinanden.
    // Personer med kunFaste i opsaetningen (fx en daglig leder med faste ugedage) maa kun have
    // deres faste vagter fra faste/weekend-rotationen -- alt andet er et regelbrud.
    const KUN_FASTE = new Set(C.personer.filter(p => p.kunFaste).map(p => p.id));
    const FASTE_VAGTER = new Set();
    WK.forEach(w => {
      (C.faste || []).forEach(x => { if (KUN_FASTE.has(x.p) && (x.rotation == null || holdAf(w) == x.rotation)) FASTE_VAGTER.add([w, x.d, x.p, x.s, x.e].join()); });
      (ROT[holdAf(w)] || []).forEach(x => { if (KUN_FASTE.has(x.p)) FASTE_VAGTER.add([w, x.d, x.p, x.s, x.e].join()); });
    });
    function gennemgaa(emit) {
      const S = M.S;
      ext();
      const nx = Math.max(0, ...M.EX.filter(Boolean));
      if (M.EKSTRA != null && nx > M.EKSTRA) emit(-1, -1, 0, () => `Planen bruger ${nx} ekstra ${nx == 1 ? 'person' : 'personer'}, men der er kun valgt ${M.EKSTRA}`);
      // Vagterne fordelt pr. dag og timer pr. person/uge, beregnet én gang i stedet for pr. regel.
      const dag = Array.from({ length: NW * 7 }, () => []), tim = {};
      S.forEach((x, i) => {
        dag[x.w * 7 + x.d].push({ ...x, i });
        const t = tim[x.p] || (tim[x.p] = Array(NW).fill(0)); t[x.w] += (x.e - x.s) / 60;
      });
      const h = (p, w) => tim[p] ? tim[p][w] : 0;
      for (let w = 0; w < NW; w++) {
        for (let d = 0; d < 7; d++) {
          const sh = dag[w * 7 + d];
          sh.forEach(x => { if (x.e - x.s < MIN_VAGT) emit(w, d, 0, () => `${nmi(x.i)} ${f(x.s)}–${f(x.e)}: vagten er under ${timer(MIN_VAGT)} timer`); });
          sh.forEach(x => {
            if (x.p == 'uk') return; const v = av(x.p, d, w);
            if (!v || x.s < v[0] || x.e > v[1]) {
              const u = undtagelse(x.p, w, d);
              emit(w, d, 0, () => u === null ? `${P[x.p][0]} har fri denne dag`
                : u ? `${P[x.p][0]} kan kun ${f(u[0])}–${f(u[1])} denne dag` : `${P[x.p][0]} kan ikke arbejde ${f(x.s)}–${f(x.e)}`);
            }
            if (KUN_FASTE.has(x.p) && !x.laast && !FASTE_VAGTER.has([w, d, x.p, x.s, x.e].join())) emit(w, d, 0, () => `${P[x.p][0]} har kun sine faste vagter (se Regler)`);
            if (sh.some(y => y.i != x.i && y.p == x.p && y.s < x.e && x.s < y.e)) emit(w, d, 0, () => `${P[x.p][0]} har overlappende vagter`);
          });
          const [a, b] = O(d), n = (b - a) / 15, c = Array(n).fill(0), m = Array(n).fill(0);
          sh.forEach(x => { for (let t = Math.max(x.s, a); t < Math.min(x.e, b); t += 15) { const i = (t - a) / 15; c[i]++; if (P[x.p][1] != 'U') m[i]++; } });
          const rn = (fn, ms) => { for (let i = 0; i < n;) { if (fn(i)) { let j = i, mx = 0; while (j < n && fn(j)) { mx = Math.max(mx, need(a + j * 15, d) - c[j]); j++; } const i0 = i, j0 = j, mx0 = mx; emit(w, d, 0, () => ms(f(a + i0 * 15), f(a + j0 * 15), mx0)); i = j; } else i++; } };
          const kv = krav(d);
          rn(i => need(a + i * 15, d) - c[i] > 0, (x, y, k) => `Mangler ${k} pers. ${x}–${y}`);
          rn(i => kv.mx[i] == 1 && c[i] > 1, (x, y) => `For mange: kun 1 person ${x}–${y}`);
          rn(i => c[i] > RG.maksAltid, (x, y) => `For mange: max ${RG.maksAltid} ad gangen ${x}–${y}`);
          rn(i => kv.mx[i] > 1 && kv.mx[i] < RG.maksAltid && c[i] > kv.mx[i], (x, y) => `For mange: højst ${kv.mx[(pm(x) - a) / 15]} pers. ${x}–${y}`);
          rn(i => RG.ansvarlig && m[i] == 0, (x, y) => `Ingen ansvarlig (ikke ungarbejder) ${x}–${y}`);
        }
        (C.ugeTimer || []).forEach(x => {
          const p = x.p, hh = h(p, w), ds = [...new Set(S.filter(y => y.w == w && y.p == p).map(y => y.d))].sort().join();
          if (hh != x.timer) emit(w, -1, 0, () => `${P[p][0]}: ${hh} t (skal være ${x.timer})`);
          if (x.dagMoenstre && !x.dagMoenstre.includes(ds)) emit(w, -1, 0, () => `${P[p][0]}: ${x.dagMoenstreTekst || 'arbejder på de forkerte dage'}`);
        });
      }
      (C.minSnit || []).forEach(({ p, timer: m }) => {
        let mn = 1e9;
        // Snit over hver 4-ugers periode (rundt om, hvis rullende; en periode paa under 4 uger
        // bruger snittet over hele perioden).
        const vinduer = RULLENDE ? WK.map(s => [0, 1, 2, 3].map(k => (s + k) % NW))
          : NW >= 4 ? WK.slice(0, NW - 3).map(s => [0, 1, 2, 3].map(k => s + k)) : [WK];
        vinduer.forEach(v => { mn = Math.min(mn, v.reduce((a, w) => a + h(p, w), 0) / v.length); });
        if (mn < m) emit(-1, -1, 0, () => `${P[p][0]}: snit ${mn.toFixed(1)} t/uge over 4 uger (min ${m})`);
      });
      const wd = (w, d, p) => dag[w * 7 + d].some(x => x.p == p);
      Object.keys(P).filter(p => p != 'uk').forEach(p => {
        const a = WK.map(w => wd(w, 5, p) || wd(w, 6, p));
        WK.forEach(w => {
          if (!a[w]) return;
          let taet = false;
          for (let k = 1; k < RG.weekendHver; k++) if (RULLENDE ? a[(w + k) % NW] : a[w + k]) taet = true;
          if (taet) emit(w, -1, 0, () => `${P[p][0]} arbejder weekender for tæt (max hver ${RG.weekendHver}. weekend)`);
          if (wd(w, 5, p) && wd(w, 6, p)) emit(w, -1, 1, () => `${P[p][0]} arbejder både lørdag og søndag (helst kun én dag)`);
        });
      });
    }
    function check() {
      const I = [];
      gennemgaa((w, d, soft, t) => I.push(soft ? { w, d, soft: 1, t: t() } : { w, d, t: t() }));
      return I;
    }
    // Kun hvor regelbruddene er (uden at bygge beskederne)
    function gennemgaaHard() {
      const I = [];
      gennemgaa((w, d, soft) => { if (!soft) I.push({ w, d }); });
      return I;
    }
    // ---------- Den kloge planlaegger (foreslaa) ----------
    // gen() ovenfor er den oprindelige vagtplans generator og giver et godt udgangspunkt, men
    // den laegger vagterne ud i én fast raekkefoelge. foreslaa() koerer den for baade
    // "2 pers. fra 15:00" og "fra 15:15", og forbedrer saa hver plan ved at proeve tusindvis af
    // bytninger af HVEM der tager de vagter, der ikke ligger fast i opsaetningen. Hver plan faar
    // strafpoint (vurder), og den med faerrest vinder. Regelbrud er udelukket (1.000.000 point
    // stykket); derefter taeller:
    const STRAF = {
      oenske: 200,    // pr. weekend hvor nogen arbejder baade loerdag og soendag -- vejer tungere
                      // end alt nedenunder: et opfyldt oenske slaar altid jaevnere timer
      ekstraTime: 3,  // pr. time en ekstra person skal daekke
      maerkelig: 25,  // pr. vagt-start/-slut der ikke er en hel/halv time, aabning, 15:15 eller lukketid
      sving: 0.5,     // pr. time en fleksibel medarbejders uge afviger fra hendes/hans eget snit
      spredning: 1,   // pr. (time)^2 en fleksibel medarbejders snit afviger fra jobtypens snit
      maal: 1,        // pr. time under maalTimer i en uge
      fra1515: 8,     // det alternative starttidspunkt ("eller fra", fx 15:15) bruges kun, hvis det normale koster mere
      flyt: 12,       // reparer(): pr. vagt der flyttes fra én medarbejder til en anden -- saa en lille
                      // rettelse ikke bytter rundt paa resten af ugen for at jaevne timerne en smule
      flytAndenUge: 100, // reparer(): pr. aendret vagt i en uge der ikke var beroert -- i praksis kun
                      // for at rette et regelbrud der gaelder hele planen (fx et minimum-snit)
    };
    // Fleksible = dem planlaeggeren selv fordeler (ikke faste vagter/weekend-rotation).
    const FLEX = [...new Set([...(C.hulFyldere || []), ...(C.fyldere || []), ...(C.ekstraDage || []).map(x => x.p)])].filter(p => P[p]);
    // Paene tider: hele/halve timer, aabnings-/lukketider og bemandingens skiftetider
    const PAENE = new Set([].concat(...RG.aabning.filter(Boolean)).concat(...RG.bemanding.hverdag.concat(RG.bemanding.weekend || []).map(b => [b.fra, b.ellerFra])));
    const paen = t => t % 30 == 0 || PAENE.has(t);
    function vurder() {
      let hard = 0, soft = 0;
      gennemgaa((w, d, s) => { if (s) soft++; else hard++; });
      const S = M.S, nx = Math.max(0, ...M.EX.filter(Boolean));
      const ukT = S.reduce((a, x) => a + (x.p == 'uk' ? (x.e - x.s) / 60 : 0), 0);
      let maerk = 0; S.forEach(x => { if (!paen(x.s)) maerk++; if (!paen(x.e)) maerk++; });
      const tim = {}; FLEX.forEach(p => { tim[p] = Array(NW).fill(0); });
      S.forEach(x => { if (tim[x.p]) tim[x.p][x.w] += (x.e - x.s) / 60; });
      let sving = 0, spredning = 0, maal = 0; const snit = {};
      FLEX.forEach(p => { const a = tim[p].reduce((x, y) => x + y) / NW; snit[p] = a; tim[p].forEach(h => { sving += Math.abs(h - a); }); });
      [...new Set(FLEX.map(p => P[p][1]))].forEach(ty => { // hver jobtype for sig
        const g = FLEX.filter(p => P[p][1] == ty); if (g.length < 2) return;
        const ga = g.reduce((x, p) => x + snit[p], 0) / g.length;
        g.forEach(p => { spredning += (snit[p] - ga) ** 2; });
      });
      (C.maalTimer || []).forEach(x => { if (tim[x.p]) tim[x.p].forEach(h => { maal += Math.max(0, x.timer - h); }); });
      // "For mange ekstra personer" er ét regelbrud i listen, men planlaeggeren skal kunne se
      // forskel paa 1 og 3 for mange -- ellers kan den frit bruge endnu flere, naar graensen
      // foerst er overskredet.
      const forMange = M.EKSTRA != null ? Math.max(0, nx - M.EKSTRA - 1) : 0;
      const point = (hard + forMange) * 1e6 + soft * STRAF.oenske + ukT * STRAF.ekstraTime + maerk * STRAF.maerkelig
        + sving * STRAF.sving + spredning * STRAF.spredning + maal * STRAF.maal + (FLEKS && M.T2 == FLEKS.ellerFra ? STRAF.fra1515 : 0);
      return { point, hard, soft, ukT, nx, maerk, sving, spredning, maal };
    }
    // Vagter der ligger fast i opsaetningen (faste vagter + weekend-rotationen) byttes ikke
    // rundt mellem personalet. Rotationens "dobbelt-weekender" (samme person loerdag OG
    // soendag) kan dog skifte mellem personen og en ekstra person -- det er saadan
    // planlaeggeren selv finder ud af, hvilke weekenddage de ekstra bedst tager.
    function fasteNoegler() {
      const k = new Set();
      WK.forEach(w => {
        (C.faste || []).forEach(x => { if (x.rotation == null || holdAf(w) == x.rotation) k.add([w, x.d, x.p, x.s, x.e].join()); });
        (ROT[holdAf(w)] || []).forEach(x => { k.add([w, x.d, x.p, x.s, x.e].join()); k.add([w, x.d, 'uk', x.s, x.e].join()); });
      });
      return k;
    }
    function dobbeltVagter() {
      const ud = [];
      WK.forEach(w => {
        const hold = ROT[holdAf(w)] || [];
        hold.filter(x => (x.d == 5 || x.d == 6) && hold.some(y => y != x && y.p == x.p && (y.d == 5 || y.d == 6) && y.d != x.d)).forEach(x => {
          const v = M.S.find(y => !y.laast && y.w == w && y.d == x.d && y.s == x.s && y.e == x.e && (y.p == x.p || y.p == 'uk') && !ud.some(u => u.x == y));
          if (v) ud.push({ x: v, p: x.p });
        });
      });
      return ud;
    }
    const kan = (p, x) => kanTage(p, x.w, x.d, x.s, x.e) && !M.S.some(y => y != x && y.w == x.w && y.d == x.d && y.p == p);
    // opt.uger (Set): kun vagter i de uger maa roeres. opt.straf(): ekstra strafpoint oven i
    // vurder() (reparer() bruger det til at holde fast i hvem der havde vagterne).
    // opt.ikkeTil (Set): personer der ikke maa faa flere vagter (fx én der lige har faaet fri --
    // ellers kunne hun faa en anden vagt samme weekend i stedet). opt.fraDag: dage foer den
    // (w * 7 + d) roeres ikke -- de er gaaet.
    function forbedr(runder, opt) {
      opt = opt || {};
      const faste = fasteNoegler(), ikkeTil = opt.ikkeTil || new Set();
      const iUger = x => (!opt.uger || opt.uger.has(x.w)) && (opt.fraDag == null || x.w * 7 + x.d >= opt.fraDag);
      const fri = M.S.filter(x => !x.laast && iUger(x) && !faste.has([x.w, x.d, x.p, x.s, x.e].join()));
      const dob = M.EKSTRA > 0 ? dobbeltVagter().filter(v => iUger(v.x) && !(v.x.p == 'uk' && ikkeTil.has(v.p))) : [];
      const alle = fri.concat(dob.map(v => v.x));
      // KUN de fleksible: de andres regler (fx en daglig leder med faste ugedage) ligger i
      // deres faste vagter og ikke i regeltjekket, saa de maa aldrig faa ekstra vagter herfra.
      const kandidater = FLEX.filter(p => !ikkeTil.has(p));
      if (!alle.length) return;
      const point = () => vurder().point + (opt.straf ? opt.straf() : 0);
      let nu = point(), bedst = nu, bedstP = alle.map(x => x.p);
      for (let i = 0, T = 30; i < runder; i++, T *= 0.998) {
        let fortryd;
        if (dob.length && (!fri.length || Math.random() < 0.25)) {
          // Lad en ekstra person overtage (eller give tilbage) en dag af en dobbelt-weekend
          const v = dob[Math.random() * dob.length | 0], gl = v.x.p;
          v.x.p = gl == 'uk' ? v.p : 'uk'; fortryd = () => { v.x.p = gl; };
        } else if (!fri.length) continue;
        else if (Math.random() < 0.6) {
          const x = fri[Math.random() * fri.length | 0];
          // Giv vagten til en anden, der kan tage den (ogsaa: erstat en ekstra person)
          const q = kandidater.filter(p => p != x.p && kan(p, x));
          if (!q.length) continue;
          const gl = x.p; x.p = q[Math.random() * q.length | 0]; fortryd = () => { x.p = gl; };
        } else {
          // Byt to vagter samme uge, saa ugetimerne bliver ved med at passe
          const x = fri[Math.random() * fri.length | 0], y = fri[Math.random() * fri.length | 0];
          if (y == x || y.w != x.w || y.d == x.d || y.p == x.p || x.p == 'uk' || y.p == 'uk') continue;
          const px = x.p, py = y.p; x.p = py; y.p = px;
          if (!kan(py, x) || !kan(px, y)) { x.p = px; y.p = py; continue; }
          fortryd = () => { x.p = px; y.p = py; };
        }
        const ny = point();
        if (ny <= nu || Math.random() < Math.exp((nu - ny) / T)) {
          nu = ny;
          if (ny < bedst) { bedst = ny; bedstP = alle.map(z => z.p); }
        } else fortryd();
      }
      alle.forEach((x, i) => { x.p = bedstP[i]; });
    }
    // Samler ekstra-vagter paa samme dag til én (fx 10-13 + 14:15-17:15 -> 10-17:15), naar det
    // goer planen bedre -- to korte ekstra-vagter samme dag kraever ellers to ekstra personer.
    // Opstaar isaer naar en medarbejder er fjernet, og der er et hul hvor hun/han stod.
    function saml(uger, fraDag) {
      for (let bedre = true; bedre;) {
        bedre = false;
        const nu = vurder().point, grupper = {};
        M.S.forEach(x => { if (x.p == 'uk' && (!uger || uger.has(x.w)) && !(x.w * 7 + x.d < fraDag)) (grupper[x.w * 7 + x.d] = grupper[x.w * 7 + x.d] || []).push(x); });
        for (const g of Object.values(grupper)) {
          g.sort((a, b) => a.s - b.s);
          for (let i = 0; i + 1 < g.length && !bedre; i++) {
            const a = g[i], b = g[i + 1], gl = [a.s, a.e], j = M.S.indexOf(b);
            a.s = Math.min(a.s, b.s); a.e = Math.max(a.e, b.e); M.S.splice(j, 1);
            if (vurder().point < nu) bedre = true;
            else { M.S.splice(j, 0, b); a.s = gl[0]; a.e = gl[1]; }
          }
          if (bedre) break;
        }
      }
    }
    function foreslaa(runder) {
      let vinder = null;
      for (const t2 of M.T2VALG) {
        const r = runder == null ? 2500 : runder;
        M.T2 = t2; gen(); saml(); forbedr(r); saml(); forbedr(Math.round(r / 4));
        const v = vurder();
        if (!vinder || v.point < vinder.v.point) vinder = { t2, S: M.S.map(x => ({ ...x })), v };
      }
      M.T2 = vinder.t2; M.S = vinder.S;
      return vinder.v;
    }

    // ---------- Lokal reparation ----------
    // Naar planen er rettet et enkelt sted (en medarbejder har faaet fri, en vagt er laast fast),
    // rettes kun ugerne i `uger`, og saa lidt som muligt -- resten er som foer, saa man ikke skal
    // melde en helt ny plan ud. foreslaa() laver derimod det hele om.
    //   1. Vagter personen ikke kan tage (fri / kun et tidsrum) afkortes, eller gives til en
    //      ekstra person.
    //   2. For mange paa arbejde: ikke-faste vagter fjernes eller afkortes (og de huller det giver,
    //      daekkes), saa laenge planen bliver bedre.
    //   3. Resterende huller daekkes af ekstra personer.
    //   4. forbedr() giver ekstra-vagterne til personalet, hvor det kan lade sig goere -- med
    //      strafpoint (STRAF.flyt) for at flytte andres vagter, saa den ikke bytter rundt uden grund.
    // opt.runder: forbedr()'s runder. opt.ikkeTil: personer der ikke maa faa nye vagter (se
    // forbedr). opt.fraDag (w * 7 + d): dage der er gaaet -- dér rettes kun vagter personen ikke
    // kan tage (fx en sygedag der skrives ind bagefter), der flyttes ikke rundt.
    function reparer(uger, opt) {
      opt = opt || {};
      const U = new Set(uger.filter(w => w >= 0 && w < NW)), fraDag = opt.fraDag == null ? -1 : opt.fraDag;
      if (!U.size) return;
      const faste = fasteNoegler(), fast = x => x.laast || faste.has([x.w, x.d, x.p, x.s, x.e].join());
      M.S.forEach(x => {
        if (!U.has(x.w) || x.p == 'uk' || x.laast) return;
        // En dag der er gaaet, rettes kun hvis der er en aftale paa datoen (fx en sygedag)
        if (x.w * 7 + x.d < fraDag && undtagelse(x.p, x.w, x.d) === undefined) return;
        const v = av(x.p, x.d, x.w);
        if (v && x.s >= v[0] && x.e <= v[1]) return;
        const s = v ? Math.max(x.s, v[0]) : 0, e = v ? Math.min(x.e, v[1]) : 0;
        if (v && e - s >= MIN_VAGT) { x.s = s; x.e = e; } else x.p = 'uk';
      });
      const dage = [];
      U.forEach(w => { for (let d = 0; d < 7; d++) if (!lukket(d) && w * 7 + d >= fraDag) dage.push([w, d]); });
      const forMange = (w, d) => { const k = krav(d); return cov(w, d).c.some((n, i) => n > k.mx[i]); };
      // Huller foerst: en ekstra person der skal til (fx fordi der ellers ingen ansvarlig er),
      // kan give for mange paa arbejde -- og det rettes nedenfor.
      const fyld = () => dage.forEach(([w, d]) => { daekHuller(w, d, 1); daekHuller(w, d, 0); });
      fyld();
      let nu = vurder().point;
      for (let runde = 0; runde < 40; runde++) {
        let bedst = null;
        dage.filter(([w, d]) => forMange(w, d)).forEach(([w, d]) => {
          const [a, b] = O(d), S0 = M.S;
          S0.forEach((x, i) => {
            if (x.w != w || x.d != d || fast(x)) return;
            // Tider vagten kan afkortes til: aabning/lukning, dagens andre vagter og bemandingens skift
            const tider = new Set([a, b]);
            S0.forEach(y => { if (y != x && y.w == w && y.d == d) { tider.add(y.s); tider.add(y.e); } });
            tidslinje(d).forEach(bl => { tider.add(bl.fra); if (bl.ellerFra != null) tider.add(bl.ellerFra); });
            const varianter = [null]; // null = fjern vagten
            tider.forEach(t => {
              if (t > x.s && x.e - t >= MIN_VAGT) varianter.push([t, x.e]);
              if (t < x.e && t - x.s >= MIN_VAGT) varianter.push([x.s, t]);
            });
            varianter.forEach(v => {
              M.S = S0.map(y => Object.assign({}, y));
              if (v) { M.S[i].s = v[0]; M.S[i].e = v[1]; } else M.S.splice(i, 1);
              daekHuller(w, d, 1); daekHuller(w, d, 0);
              const p = vurder().point;
              if (p < nu - 1e-6 && (!bedst || p < bedst.p)) bedst = { p, S: M.S };
              M.S = S0;
            });
          });
        });
        if (!bedst) break;
        M.S = bedst.S; nu = bedst.p;
      }
      fyld();
      // Strafpoint for at flytte vagter: i de beroerte uger kun personalets (en ekstra-vagt maa
      // gerne gives til personalet), i andre uger enhver aendring -- og meget mere.
      const foer = new Map(M.S.map(x => [x, x.p]));
      const straf = () => {
        let n = 0;
        foer.forEach((p, x) => { if (x.p != p) n += U.has(x.w) ? (p != 'uk' ? STRAF.flyt : 0) : STRAF.flytAndenUge; });
        return n;
      };
      const runder = opt.runder == null ? 1500 : opt.runder, fOpt = { uger: U, straf, ikkeTil: new Set(opt.ikkeTil || []), fraDag };
      forbedr(runder, fOpt);
      // Brud der gaelder hele planen (fx et minimum-snit over 4 uger) kan kraeve, at en anden uge
      // ogsaa rettes -- saa maa forbedr() ogsaa roere de andre kommende uger.
      if (runder && gennemgaaHard().some(i => i.w < 0)) forbedr(runder, Object.assign({}, fOpt, { uger: null }));
      saml(U, fraDag);
    }

    // Aftaler paa bestemte datoer (plan.undtagelser: [{ p, dato: 'YYYY-MM-DD', tid: null | [fra, til] }])
    // -> M.UNDTAG, ud fra planens startdato (en mandag). Datoer uden for planen ignoreres.
    const dagNr = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
    function saetUndtagelser(liste, start) {
      M.UNDTAG = new Map();
      const s0 = dagNr(start);
      (liste || []).forEach(u => {
        const n = dagNr(u.dato) - s0;
        if (!(n >= 0 && n < NW * 7) || !P[u.p]) return;
        M.UNDTAG.set(u.p + '|' + Math.floor(n / 7) + '|' + n % 7, u.tid ? [u.tid[0], u.tid[1]] : null);
      });
    }

    // Timekrav pr. person til timetabellen: minimum-snit og/eller fast ugentligt antal.
    const minSnit = p => { const x = (C.minSnit || []).find(y => y.p == p); return x ? x.timer : null; };
    const ugeTimer = p => { const x = (C.ugeTimer || []).find(y => y.p == p); return x ? x.timer : null; };

    Object.assign(M, { need, ext, nmi, av, cov, best, gen, genWeek, hrs, check, minSnit, ugeTimer, vurder, foreslaa, reparer, kan, kanTage, fasteNoegler, saetUndtagelser, undtagelse, LEN, FLEX });
    return M;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { lavMotor, STANDARD_REGLER };
  else { root.lavVagtplanMotor = lavMotor; root.VagtplanStandardRegler = STANDARD_REGLER; }
})(this);
