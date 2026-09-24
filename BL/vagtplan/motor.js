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
      P, R, D, O, f, NW, WK, S: [], EX: [], T2: 900, EKSTRA: null,
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
    const afloest = (r, x) => M.EKSTRA > 0 && DOBBELT.slice(0, M.EKSTRA).some(y => y.r == r && y.x == x);

    function ext() {
      const S = M.S, EX = []; const ex = [];
      S.map((x, i) => i).filter(i => S[i].p == 'uk').sort((a, b) => S[a].w - S[b].w || S[a].d - S[b].d || S[a].s - S[b].s).forEach(i => {
        const x = S[i];
        for (let n = 0; ; n++) {
          const e = ex[n] || (ex[n] = { D: new Set(), K: [] });
          if (e.D.has(x.w + '-' + x.d)) continue;
          if (x.d > 4 && e.K.some(k => { const q = Math.abs(k - x.w); return Math.min(q, NW - q) < 3; })) continue;
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
    function check() {
      const I = [], S = M.S;
      ext();
      const nx = Math.max(0, ...M.EX.filter(Boolean));
      if (M.EKSTRA != null && nx > M.EKSTRA) I.push({ w: -1, d: -1, t: `Planen bruger ${nx} ekstra ${nx == 1 ? 'person' : 'personer'}, men der er kun valgt ${M.EKSTRA}` });
      for (let w = 0; w < NW; w++) {
        for (let d = 0; d < 7; d++) {
          const sh = S.map((x, i) => ({ ...x, i })).filter(x => x.w == w && x.d == d);
          sh.forEach(x => { if (x.e - x.s < 180) I.push({ w, d, t: `${nmi(x.i)} ${f(x.s)}–${f(x.e)}: vagten er under 3 timer` }); });
          sh.forEach(x => {
            if (x.p == 'uk') return; const v = av(x.p, d);
            if (!v || x.s < v[0] || x.e > v[1]) I.push({ w, d, t: `${P[x.p][0]} kan ikke arbejde ${f(x.s)}–${f(x.e)}` });
            if (sh.some(y => y.i != x.i && y.p == x.p && y.s < x.e && x.s < y.e)) I.push({ w, d, t: `${P[x.p][0]} har overlappende vagter` });
          });
          const cv = cov(w, d), n = cv.c.length;
          const rn = (fn, ms) => { for (let i = 0; i < n;) { if (fn(i)) { let j = i, mx = 0; while (j < n && fn(j)) { mx = Math.max(mx, need(cv.a + j * 15) - cv.c[j]); j++; } I.push({ w, d, t: ms(f(cv.a + i * 15), f(cv.a + j * 15), mx) }); i = j; } else i++; } };
          rn(i => need(cv.a + i * 15) - cv.c[i] > 0, (a, b, m) => `Mangler ${m} pers. ${a}–${b}`);
          rn(i => cv.a + i * 15 < 600 && cv.c[i] > 1, (a, b) => `For mange: kun 1 person ${a}–${b}`);
          rn(i => cv.c[i] > 2, (a, b) => `For mange: max 2 ad gangen ${a}–${b}`);
          rn(i => cv.m[i] == 0, (a, b) => `Ingen ansvarlig (ikke ungarbejder) ${a}–${b}`);
        }
        (C.ugeTimer || []).forEach(x => {
          const p = x.p, h = hrs(p, w), ds = [...new Set(S.filter(y => y.w == w && y.p == p).map(y => y.d))].sort().join();
          if (h != x.timer) I.push({ w, d: -1, t: `${P[p][0]}: ${h} t (skal være ${x.timer})` });
          if (x.dagMoenstre && !x.dagMoenstre.includes(ds)) I.push({ w, d: -1, t: `${P[p][0]}: ${x.dagMoenstreTekst || 'arbejder på de forkerte dage'}` });
        });
      }
      (C.minSnit || []).forEach(({ p, timer: m }) => {
        let mn = 1e9;
        for (let s = 0; s < NW; s++) { let a = 0; for (let k = 0; k < 4; k++) a += hrs(p, (s + k) % NW); mn = Math.min(mn, a / 4); }
        if (mn < m) I.push({ w: -1, d: -1, t: `${P[p][0]}: snit ${mn.toFixed(1)} t/uge over 4 uger (min ${m})` });
      });
      const wk = p => WK.map(w => [5, 6].some(d => S.some(x => x.w == w && x.d == d && x.p == p)));
      Object.keys(P).filter(p => p != 'uk').forEach(p => {
        const a = wk(p);
        WK.forEach(w => {
          if (!a[w]) return;
          if (a[(w + 1) % NW] || a[(w + 2) % NW]) I.push({ w, d: -1, t: `${P[p][0]} arbejder weekender for tæt (max hver 3. weekend)` });
          if (S.some(x => x.w == w && x.d == 5 && x.p == p) && S.some(x => x.w == w && x.d == 6 && x.p == p)) I.push({ w, d: -1, soft: 1, t: `${P[p][0]} arbejder både lørdag og søndag (helst kun én dag)` });
        });
      });
      return I;
    }
    // Timekrav pr. person til timetabellen: minimum-snit og/eller fast ugentligt antal.
    const minSnit = p => { const x = (C.minSnit || []).find(y => y.p == p); return x ? x.timer : null; };
    const ugeTimer = p => { const x = (C.ugeTimer || []).find(y => y.p == p); return x ? x.timer : null; };

    Object.assign(M, { need, ext, nmi, av, cov, best, gen, genWeek, hrs, check, minSnit, ugeTimer });
    return M;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { lavMotor };
  else root.lavVagtplanMotor = lavMotor;
})(this);
