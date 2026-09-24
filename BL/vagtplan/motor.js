// Vagtplan-motoren: selve planlaegningen og regeltjekket, uden DOM og uden persondata.
// Alt om de konkrete medarbejdere (navne, jobtype, hvornaar de kan, faste vagter, weekend-
// rotation, timekrav) kommer fra opsaetningen i Supabase-tabellen `vagtplan` -- intet af det
// maa staa her, fordi repoet er offentligt. Det der staar her er kun butikkens generelle
// regler (aabningstider, bemanding, vagtlaengder), som i forvejen er offentlige.
//
// Tider er minutter efter midnat (525 = 08:45). Dage er 0-6 (mandag-soendag). Uger er 0-5.
(function (root) {
  function lavMotor(C) {
    const R = C.jobtyper;
    // Raekkefoelgen i C.personer bestemmer raekkefoelgen i dropdown, timetabel og advarsler.
    // 'uk' (ekstra person) er motorens eget begreb og tilfoejes altid sidst.
    const P = {}, TID = {};
    C.personer.forEach(p => { P[p.id] = [p.navn, p.type]; TID[p.id] = p.tid || {}; });
    P.uk = ['Ekstra person', 'S']; TID.uk = {};
    const D = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
    const O = d => [525, d > 4 ? 1035 : 1095];
    const f = m => String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const LEN = [180, 195, 210, 225, 240, 255, 270, 300, 330, 360, 390, 420, 435, 480, 510];
    const NW = 6, WK = [...Array(NW).keys()];
    const ROT = C.weekendRotation || [], NR = ROT.length || 3;
    // EKSTRA: hvor mange ekstra personer der maa bruges (dropdown'en). null = ingen graense og
    // ingen weekend-aflastning -- saadan opfoerte den oprindelige vagtplan sig.
    const M = {
      P, R, D, O, f, NW, WK, S: [], EX: [], T2: 900, EKSTRA: null, EKSTRA_ALLE: false,
    };
    const need = t => t < 600 || (t >= 780 && t < M.T2) ? 1 : 2;

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
    // EKSTRA_ALLE: ekstra personer maa arbejde ALLE weekender (baade loerdag og soendag) -- ikke
    // kun én weekenddag hver 3. uge som personalet. Saa kan én ekstra person overtage en dag
    // fra HVER af dem, der ellers skal arbejde hele weekenden: den foerste i en rotationsuge
    // mister soendagen, den naeste loerdagen osv., hoejst EKSTRA pr. dag.
    // Uden EKSTRA_ALLE overtages kun soendagen for de EKSTRA foerste (se DOBBELT ovenfor).
    let aflCache = null, aflNoegle = null;
    function aflosning() {
      const k = M.EKSTRA + '|' + M.EKSTRA_ALLE;
      if (k === aflNoegle) return aflCache;
      const ud = new Set();
      if (M.EKSTRA > 0) {
        if (!M.EKSTRA_ALLE) DOBBELT.slice(0, M.EKSTRA).forEach(y => ud.add(y.r + '|6|' + y.x.p));
        else ROT.forEach((hold, r) => {
          const brugt = { 5: 0, 6: 0 };
          hold.filter(x => x.d == 6 && hold.some(y => y.d == 5 && y.p == x.p)).forEach((x, j) => {
            for (const dag of j % 2 ? [5, 6] : [6, 5]) if (brugt[dag] < M.EKSTRA) { brugt[dag]++; ud.add(r + '|' + dag + '|' + x.p); break; }
          });
        });
      }
      aflNoegle = k; aflCache = ud;
      return ud;
    }
    const afloest = (r, x) => aflosning().has(r + '|' + x.d + '|' + x.p);

    function ext() {
      const S = M.S, EX = []; const ex = [];
      S.map((x, i) => i).filter(i => S[i].p == 'uk').sort((a, b) => S[a].w - S[b].w || S[a].d - S[b].d || S[a].s - S[b].s).forEach(i => {
        const x = S[i];
        for (let n = 0; ; n++) {
          const e = ex[n] || (ex[n] = { D: new Set(), K: [] });
          if (e.D.has(x.w + '-' + x.d)) continue;
          if (x.d > 4 && !M.EKSTRA_ALLE && e.K.some(k => { const q = Math.abs(k - x.w); return Math.min(q, NW - q) < 3; })) continue;
          e.D.add(x.w + '-' + x.d); if (x.d > 4) e.K.push(x.w); EX[i] = n + 1; break;
        }
      });
      M.EX = EX;
    }
    const nmi = i => M.S[i].p == 'uk' ? 'Ekstra person ' + (M.EX[i] || '') : P[M.S[i].p][0];

    // Hvornaar en medarbejder kan arbejde en given dag. tid.hverdag/tid.weekend: udeladt =
    // hele aabningstiden, null = aldrig, [start, slut] hvor null i et felt = aabning/lukning.
    function av(p, d) {
      const [a, b] = O(d), t = TID[p] || {};
      if (t.ikkeDage && t.ikkeDage.includes(d)) return null;
      const v = d > 4 ? t.weekend : t.hverdag;
      if (v === null) return null;
      if (v === undefined) return [a, b];
      return [v[0] == null ? a : v[0], v[1] == null ? b : v[1]];
    }
    function cov(w, d) {
      const [a, b] = O(d), n = (b - a) / 15, c = Array(n).fill(0), m = Array(n).fill(0);
      M.S.filter(x => x.w == w && x.d == d).forEach(x => {
        for (let t = Math.max(x.s, a); t < Math.min(x.e, b); t += 15) { const i = (t - a) / 15; c[i]++; if (P[x.p][1] != 'U') m[i]++; }
      });
      return { a, c, m };
    }
    function sc(p, cv, s, e) {
      let v = 0; const y = P[p][1] == 'U';
      for (let t = s; t < e; t += 15) {
        const i = (t - cv.a) / 15, nd = need(t) - cv.c[i] > 0;
        if (cv.c[i] >= 2 || (t < 600 && cv.c[i] >= 1)) return -1;
        if (y) { if (cv.m[i] == 0) return -1; v += nd ? 1 : 0; } else v += (nd ? 1 : 0) + (cv.m[i] == 0 ? 2 : 0);
      }
      return v;
    }
    function best(p, w, d, lens, nz) {
      const v = av(p, d); if (!v) return null; const cv = cov(w, d); let r = null;
      for (const L of lens) for (let s = v[0]; s + L <= v[1]; s += 15) {
        const q = sc(p, cv, s, s + L), x = q + (nz ? Math.random() * nz : 0);
        if (!r || x > r.v) r = { s, e: s + L, v: x, q };
      }
      return r;
    }
    function run(w, d, k) {
      const cv = cov(w, d), a = cv.a, n = cv.c.length,
        fn = i => k ? need(a + i * 15) - cv.c[i] > 0 && (k != 2 || a + i * 15 < 915) : cv.m[i] == 0;
      for (let i = 0; i < n; i++) if (fn(i)) { let j = i; while (j < n && fn(j)) j++; return [a + i * 15, a + j * 15]; }
    }
    function genWeek(w, n) {
      M.S = M.S.filter(x => x.w != w);
      const S = M.S;
      const add = (d, p, s, e) => S.push({ w, d, p, s, e });
      const has = (d, p) => S.some(x => x.w == w && x.d == d && x.p == p);
      const put = (p, d, l, min) => { if (d > 4) return; const r = best(p, w, d, l, n); if (r && r.q >= min) add(d, p, r.s, r.e); };
      const uk = (d, k) => {
        let g;
        while (g = run(w, d, k)) {
          const [a, b] = O(d), cv = cov(w, d); let bw = null;
          for (let s = a; s <= g[0]; s += 15) for (const e of [Math.max(g[1], s + 180), b]) {
            if (e > b || e < g[1] || e - s < 180) continue; let pen = 0;
            for (let t = s; t < e; t += 15) { const c = cv.c[(t - a) / 15]; pen += (c >= 2 || (t < 600 && c >= 1)) ? 1000 : (need(t) - c <= 0 ? 1 : 0); }
            if (!bw || pen <= bw.pen) bw = { s, e, pen };
          }
          if (!bw) bw = { s: g[0], e: g[1], pen: 0 }; add(d, 'uk', bw.s, bw.e);
        }
      };
      // Faste vagter. `rotation` = kun de uger hvor uge % (antal weekend-hold) er lig vaerdien.
      (C.faste || []).forEach(x => { if (x.rotation == null || w % NR == x.rotation) add(x.d, x.p, x.s, x.e); });
      (ROT[w % NR] || []).forEach(x => add(x.d, afloest(w % NR, x) ? 'uk' : x.p, x.s, x.e));
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
      const all = [];
      for (let w = 0; w < NW; w++) {
        let bs = null, bv = 1e9;
        for (let t = 0; t < 70 && (bv >= 1e6 || t < 25) && bv > 0; t++) {
          M.S = all.slice(); genWeek(w, t ? 12 : 0);
          const u = M.S.filter(x => x.w == w && x.p == 'uk'); let ov = 0;
          for (let d = 0; d < 7; d++) cov(w, d).c.forEach((c, i) => { if (c > 2 || (i < 5 && c > 1)) ov++; });
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
      (C.faste || []).forEach(x => { if (KUN_FASTE.has(x.p) && (x.rotation == null || w % NR == x.rotation)) FASTE_VAGTER.add([w, x.d, x.p, x.s, x.e].join()); });
      (ROT[w % NR] || []).forEach(x => { if (KUN_FASTE.has(x.p)) FASTE_VAGTER.add([w, x.d, x.p, x.s, x.e].join()); });
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
          sh.forEach(x => { if (x.e - x.s < 180) emit(w, d, 0, () => `${nmi(x.i)} ${f(x.s)}–${f(x.e)}: vagten er under 3 timer`); });
          sh.forEach(x => {
            if (x.p == 'uk') return; const v = av(x.p, d);
            if (!v || x.s < v[0] || x.e > v[1]) emit(w, d, 0, () => `${P[x.p][0]} kan ikke arbejde ${f(x.s)}–${f(x.e)}`);
            if (KUN_FASTE.has(x.p) && !FASTE_VAGTER.has([w, d, x.p, x.s, x.e].join())) emit(w, d, 0, () => `${P[x.p][0]} har kun sine faste vagter (se Regler)`);
            if (sh.some(y => y.i != x.i && y.p == x.p && y.s < x.e && x.s < y.e)) emit(w, d, 0, () => `${P[x.p][0]} har overlappende vagter`);
          });
          const [a, b] = O(d), n = (b - a) / 15, c = Array(n).fill(0), m = Array(n).fill(0);
          sh.forEach(x => { for (let t = Math.max(x.s, a); t < Math.min(x.e, b); t += 15) { const i = (t - a) / 15; c[i]++; if (P[x.p][1] != 'U') m[i]++; } });
          const rn = (fn, ms) => { for (let i = 0; i < n;) { if (fn(i)) { let j = i, mx = 0; while (j < n && fn(j)) { mx = Math.max(mx, need(a + j * 15) - c[j]); j++; } const i0 = i, j0 = j, mx0 = mx; emit(w, d, 0, () => ms(f(a + i0 * 15), f(a + j0 * 15), mx0)); i = j; } else i++; } };
          rn(i => need(a + i * 15) - c[i] > 0, (x, y, k) => `Mangler ${k} pers. ${x}–${y}`);
          rn(i => a + i * 15 < 600 && c[i] > 1, (x, y) => `For mange: kun 1 person ${x}–${y}`);
          rn(i => c[i] > 2, (x, y) => `For mange: max 2 ad gangen ${x}–${y}`);
          rn(i => m[i] == 0, (x, y) => `Ingen ansvarlig (ikke ungarbejder) ${x}–${y}`);
        }
        (C.ugeTimer || []).forEach(x => {
          const p = x.p, hh = h(p, w), ds = [...new Set(S.filter(y => y.w == w && y.p == p).map(y => y.d))].sort().join();
          if (hh != x.timer) emit(w, -1, 0, () => `${P[p][0]}: ${hh} t (skal være ${x.timer})`);
          if (x.dagMoenstre && !x.dagMoenstre.includes(ds)) emit(w, -1, 0, () => `${P[p][0]}: ${x.dagMoenstreTekst || 'arbejder på de forkerte dage'}`);
        });
      }
      (C.minSnit || []).forEach(({ p, timer: m }) => {
        let mn = 1e9;
        for (let s = 0; s < NW; s++) { let a = 0; for (let k = 0; k < 4; k++) a += h(p, (s + k) % NW); mn = Math.min(mn, a / 4); }
        if (mn < m) emit(-1, -1, 0, () => `${P[p][0]}: snit ${mn.toFixed(1)} t/uge over 4 uger (min ${m})`);
      });
      const wd = (w, d, p) => dag[w * 7 + d].some(x => x.p == p);
      Object.keys(P).filter(p => p != 'uk').forEach(p => {
        const a = WK.map(w => wd(w, 5, p) || wd(w, 6, p));
        WK.forEach(w => {
          if (!a[w]) return;
          if (a[(w + 1) % NW] || a[(w + 2) % NW]) emit(w, -1, 0, () => `${P[p][0]} arbejder weekender for tæt (max hver 3. weekend)`);
          if (wd(w, 5, p) && wd(w, 6, p)) emit(w, -1, 1, () => `${P[p][0]} arbejder både lørdag og søndag (helst kun én dag)`);
        });
      });
    }
    function check() {
      const I = [];
      gennemgaa((w, d, soft, t) => I.push(soft ? { w, d, soft: 1, t: t() } : { w, d, t: t() }));
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
      oenske: 40,     // pr. weekend hvor nogen arbejder baade loerdag og soendag
      ekstraTime: 3,  // pr. time en ekstra person skal daekke
      maerkelig: 25,  // pr. vagt-start/-slut der ikke er en hel/halv time, aabning, 15:15 eller lukketid
      sving: 0.5,     // pr. time en fleksibel medarbejders uge afviger fra hendes/hans eget snit
      spredning: 1,   // pr. (time)^2 en fleksibel medarbejders snit afviger fra jobtypens snit
      maal: 1,        // pr. time under maalTimer i en uge
      fra1515: 8,     // "2 pers. fra 15:15" bruges kun hvis 15:00 koster mere end det her
    };
    // Fleksible = dem planlaeggeren selv fordeler (ikke faste vagter/weekend-rotation).
    const FLEX = [...new Set([...(C.hulFyldere || []), ...(C.fyldere || []), ...(C.ekstraDage || []).map(x => x.p)])].filter(p => P[p]);
    const paen = t => t % 30 == 0 || t == 525 || t == 915 || t == 1035 || t == 1095;
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
      ['L', 'S', 'U'].forEach(ty => {
        const g = FLEX.filter(p => P[p][1] == ty); if (g.length < 2) return;
        const ga = g.reduce((x, p) => x + snit[p], 0) / g.length;
        g.forEach(p => { spredning += (snit[p] - ga) ** 2; });
      });
      (C.maalTimer || []).forEach(x => { if (tim[x.p]) tim[x.p].forEach(h => { maal += Math.max(0, x.timer - h); }); });
      const point = hard * 1e6 + soft * STRAF.oenske + ukT * STRAF.ekstraTime + maerk * STRAF.maerkelig
        + sving * STRAF.sving + spredning * STRAF.spredning + maal * STRAF.maal + (M.T2 == 915 ? STRAF.fra1515 : 0);
      return { point, hard, soft, ukT, nx, maerk, sving, spredning, maal };
    }
    // Vagter der ligger fast i opsaetningen (faste vagter + weekend-rotationen, inkl. de
    // soendage en ekstra person har overtaget) roeres ikke -- kun de oevrige byttes rundt.
    function fasteNoegler() {
      const k = new Set();
      WK.forEach(w => {
        (C.faste || []).forEach(x => { if (x.rotation == null || w % NR == x.rotation) k.add([w, x.d, x.p, x.s, x.e].join()); });
        (ROT[w % NR] || []).forEach(x => k.add([w, x.d, afloest(w % NR, x) ? 'uk' : x.p, x.s, x.e].join()));
      });
      return k;
    }
    const kan = (p, x) => { const v = av(p, x.d); return v && x.s >= v[0] && x.e <= v[1] && !M.S.some(y => y != x && y.w == x.w && y.d == x.d && y.p == p); };
    function forbedr(runder) {
      const faste = fasteNoegler();
      const fri = M.S.filter(x => !faste.has([x.w, x.d, x.p, x.s, x.e].join()));
      // KUN de fleksible: de andres regler (fx en daglig leder med faste ugedage) ligger i
      // deres faste vagter og ikke i regeltjekket, saa de maa aldrig faa ekstra vagter herfra.
      const kandidater = FLEX;
      if (!fri.length) return;
      let nu = vurder().point, bedst = nu, bedstP = fri.map(x => x.p);
      for (let i = 0, T = 30; i < runder; i++, T *= 0.998) {
        const x = fri[Math.random() * fri.length | 0];
        let fortryd;
        if (Math.random() < 0.6) {
          // Giv vagten til en anden, der kan tage den (ogsaa: erstat en ekstra person)
          const q = kandidater.filter(p => p != x.p && kan(p, x));
          if (!q.length) continue;
          const gl = x.p; x.p = q[Math.random() * q.length | 0]; fortryd = () => { x.p = gl; };
        } else {
          // Byt to vagter samme uge, saa ugetimerne bliver ved med at passe
          const y = fri[Math.random() * fri.length | 0];
          if (y == x || y.w != x.w || y.d == x.d || y.p == x.p || x.p == 'uk' || y.p == 'uk') continue;
          const px = x.p, py = y.p; x.p = py; y.p = px;
          if (!kan(py, x) || !kan(px, y)) { x.p = px; y.p = py; continue; }
          fortryd = () => { x.p = px; y.p = py; };
        }
        const ny = vurder().point;
        if (ny <= nu || Math.random() < Math.exp((nu - ny) / T)) {
          nu = ny;
          if (ny < bedst) { bedst = ny; bedstP = fri.map(z => z.p); }
        } else fortryd();
      }
      fri.forEach((x, i) => { x.p = bedstP[i]; });
    }
    function foreslaa(runder) {
      let vinder = null;
      for (const t2 of [900, 915]) {
        M.T2 = t2; gen(); forbedr(runder == null ? 2500 : runder);
        const v = vurder();
        if (!vinder || v.point < vinder.v.point) vinder = { t2, S: M.S.map(x => ({ ...x })), v };
      }
      M.T2 = vinder.t2; M.S = vinder.S;
      return vinder.v;
    }

    // Timekrav pr. person til timetabellen: minimum-snit og/eller fast ugentligt antal.
    const minSnit = p => { const x = (C.minSnit || []).find(y => y.p == p); return x ? x.timer : null; };
    const ugeTimer = p => { const x = (C.ugeTimer || []).find(y => y.p == p); return x ? x.timer : null; };

    Object.assign(M, { need, ext, nmi, av, cov, best, gen, genWeek, hrs, check, minSnit, ugeTimer, vurder, foreslaa });
    return M;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { lavMotor };
  else root.lavVagtplanMotor = lavMotor;
})(this);
