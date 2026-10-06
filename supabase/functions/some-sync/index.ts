// SoMe-indsamling: henter tal for alle Børneloppens Facebook-sider og Instagram-konti direkte
// fra Meta og gemmer dem i Supabase (some_konti, some_dag, some_opslag). Siden BL/some/ laeser
// kun fra databasen -- den taler aldrig selv med Meta.
//
// Koeres én gang i doegnet af cron-jobbet 'daglig-some-sync' (se supabase/migration_some.sql)
// og kan startes fra siden med "Opdater nu" af brugere i some_adgang.
//
// Noegler: ligger krypteret i Supabase Vault og hentes med RPC'en some_noegler, som kun
// service_role maa kalde. 'meta_system_token' er systembrugerens token fra Meta Business
// Manager -- kontiene findes automatisk ud fra de sider, systembrugeren har faaet tildelt.
//
// Body (valgfri): { "dage": N } -- hvor mange dage tilbage der hentes (standard 3, foerste
// gang 90). Meta retter tallene lidt de foerste doegn, derfor hentes de seneste dage igen.
//
// Ingen hemmeligheder eller persondata i denne fil (repoet er offentligt).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const svar = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const GRAPH = 'https://graph.facebook.com/' + (Deno.env.get('META_API_VERSION') ?? 'v24.0');
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

type Raekke = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Json = any;

// ---------- Supabase (service_role, uden om RLS) ----------
async function db(sti: string, init: RequestInit = {}): Promise<Json> {
  const r = await fetch(SB + '/rest/v1/' + sti, {
    ...init,
    headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error('Database ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
// Raekkerne grupperes efter hvilke felter de har, saa en raekke der kun kender fx foelgere
// ikke nulstiller de andre tal for samme dag.
async function upsert(tabel: string, noegle: string, raekker: Raekke[], retur = false): Promise<Json[]> {
  const grupper = new Map<string, Raekke[]>();
  for (const r of raekker) {
    const k = Object.keys(r).sort().join(',');
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k)!.push(r);
  }
  const ud: Json[] = [];
  for (const g of grupper.values()) {
    for (let i = 0; i < g.length; i += 500) {
      const res = await db(tabel + '?on_conflict=' + noegle, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=' + (retur ? 'representation' : 'minimal') },
        body: JSON.stringify(g.slice(i, i + 500)),
      });
      if (retur && res) ud.push(...res);
    }
  }
  return ud;
}

// ---------- Meta Graph API ----------
async function graf(sti: string, params: Record<string, string | number>, token: string): Promise<Json> {
  const u = new URL(sti.startsWith('http') ? sti : GRAPH + '/' + sti);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  if (!u.searchParams.has('access_token')) u.searchParams.set('access_token', token);
  const r = await fetch(u);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d?.error?.message ?? 'Meta svarede ' + r.status);
  return d;
}
async function grafAlle(sti: string, params: Record<string, string | number>, token: string, maksSider = 6): Promise<Json[]> {
  const ud: Json[] = [];
  let d = await graf(sti, params, token);
  for (let i = 0; ; i++) {
    ud.push(...(d.data ?? []));
    if (!d.paging?.next || i + 1 >= maksSider) break;
    d = await graf(d.paging.next, {}, token);
  }
  return ud;
}

const DAG = 86400;
const iso = (d: Date) => d.toISOString().slice(0, 10);
// Meta stempler en dags tal med tidspunktet hvor dagen SLUTTER (midnat amerikansk tid, dvs.
// om morgenen UTC dagen efter) -- 12 timer tilbage giver den dato, tallet gaelder for.
const datoFor = (endTime: string) => iso(new Date(new Date(endTime).getTime() - 12 * 3600e3));
const iDag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());

// Daglige tal samles pr. (konto, dato) og skrives til sidst
class Dage {
  m = new Map<string, Raekke>();
  saet(kontoId: string, dato: string, felt: string, vaerdi: unknown) {
    const n = Number(vaerdi);
    if (!Number.isFinite(n)) return;
    const k = kontoId + '|' + dato;
    if (!this.m.has(k)) this.m.set(k, { konto_id: kontoId, dato });
    this.m.get(k)![felt] = Math.round(n);
  }
  alle() { return [...this.m.values()]; }
}

// Facebook-sidens daglige tal. Meta omdoeber jaevnligt sine maal (fx "impressions" -> "views"),
// saa hvert tal har en liste af navne, der proeves i raekkefoelge.
const SIDE_MAAL: [string, string[]][] = [
  ['visninger', ['page_media_view', 'page_impressions']],
  ['raekkevidde', ['page_total_media_view_unique', 'page_impressions_unique']],
  ['interaktioner', ['page_post_engagements']],
  ['nye_foelgere', ['page_daily_follows_unique', 'page_fan_adds']],
  ['foelgere', ['page_follows', 'page_fans']],
];

async function hentSide(side: Json, kontoId: string, dage: number, ud: Dage, opslag: Raekke[], fejl: string[]) {
  const tok = side.access_token;
  const nu = Math.floor(Date.now() / 1000);
  const fra = nu - Math.min(dage, 90) * DAG;
  for (const [felt, navne] of SIDE_MAAL) {
    let sidst = '';
    let fundet = false;
    for (const maal of navne) {
      try {
        const d = await graf(side.id + '/insights', { metric: maal, period: 'day', since: fra, until: nu }, tok);
        for (const v of d.data?.[0]?.values ?? []) ud.saet(kontoId, datoFor(v.end_time), felt, v.value);
        fundet = true;
        break;
      } catch (e) { sidst = (e as Error).message; }
    }
    if (!fundet) fejl.push(`${side.name} (Facebook) ${felt}: ${sidst}`);
  }
  if (side.followers_count != null) ud.saet(kontoId, iDag(), 'foelgere', side.followers_count);

  const felter = 'id,created_time,message,permalink_url,full_picture,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';
  const p = { since: nu - Math.max(dage, 30) * DAG, limit: 50 };
  let liste: Json[];
  try {
    liste = await grafAlle(side.id + '/published_posts', { ...p, fields: felter + ',insights.metric(post_media_view){name,values}' }, tok);
  } catch {
    try { liste = await grafAlle(side.id + '/published_posts', { ...p, fields: felter }, tok); }
    catch (e) { fejl.push(`${side.name} (Facebook) opslag: ${(e as Error).message}`); return; }
  }
  for (const o of liste) {
    const r: Raekke = {
      konto_id: kontoId, ekstern_id: o.id, oprettet_at: o.created_time, type: o.status_type ?? null,
      tekst: (o.message ?? '').slice(0, 2000), permalink: o.permalink_url ?? null, billede_url: o.full_picture ?? null,
      likes: o.reactions?.summary?.total_count ?? 0, kommentarer: o.comments?.summary?.total_count ?? 0,
      delinger: o.shares?.count ?? 0, opdateret_at: new Date().toISOString(),
    };
    const vis = o.insights?.data?.find((x: Json) => x.name === 'post_media_view')?.values?.[0]?.value;
    if (Number.isFinite(Number(vis))) r.visninger = Number(vis);
    opslag.push(r);
  }
}

async function hentInstagram(ig: Json, navn: string, tok: string, kontoId: string, dage: number, ud: Dage, opslag: Raekke[], fejl: string[]) {
  const midnat = Math.floor(Date.now() / 1000 / DAG) * DAG;
  // Tidsserier (hoejst 30 dage ad gangen). follower_count findes kun for konti med 100+ foelgere.
  for (const [maal, felt] of [['reach', 'raekkevidde'], ['follower_count', 'nye_foelgere']]) {
    try {
      const d = await graf(ig.id + '/insights', { metric: maal, period: 'day', since: midnat - Math.min(dage, 29) * DAG, until: midnat }, tok);
      for (const v of d.data?.[0]?.values ?? []) ud.saet(kontoId, datoFor(v.end_time), felt, v.value);
    } catch (e) { fejl.push(`${navn} (Instagram) ${felt}: ${(e as Error).message}`); }
  }
  // Visninger og interaktioner findes kun som en sum for et tidsrum -- derfor ét kald pr. dag.
  for (let i = 1; i <= Math.min(dage, 7); i++) {
    const start = midnat - i * DAG;
    try {
      const d = await graf(ig.id + '/insights', { metric: 'views,total_interactions', metric_type: 'total_value', period: 'day', since: start, until: start + DAG }, tok);
      for (const m of d.data ?? []) {
        ud.saet(kontoId, iso(new Date(start * 1000)), m.name === 'views' ? 'visninger' : 'interaktioner', m.total_value?.value);
      }
    } catch (e) { fejl.push(`${navn} (Instagram) visninger: ${(e as Error).message}`); break; }
  }
  if (ig.followers_count != null) ud.saet(kontoId, iDag(), 'foelgere', ig.followers_count);

  const felter = 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count';
  const p = { since: midnat - Math.max(dage, 30) * DAG, limit: 50 };
  let liste: Json[];
  try {
    liste = await grafAlle(ig.id + '/media', { ...p, fields: felter + ',insights.metric(views,reach,shares){name,values}' }, tok);
  } catch {
    try { liste = await grafAlle(ig.id + '/media', { ...p, fields: felter }, tok); }
    catch (e) { fejl.push(`${navn} (Instagram) opslag: ${(e as Error).message}`); return; }
  }
  for (const o of liste) {
    const r: Raekke = {
      konto_id: kontoId, ekstern_id: o.id, oprettet_at: o.timestamp, type: o.media_product_type ?? o.media_type ?? null,
      tekst: (o.caption ?? '').slice(0, 2000), permalink: o.permalink ?? null,
      billede_url: o.thumbnail_url ?? (o.media_type === 'VIDEO' ? null : o.media_url ?? null),
      likes: o.like_count ?? 0, kommentarer: o.comments_count ?? 0, opdateret_at: new Date().toISOString(),
    };
    for (const m of o.insights?.data ?? []) {
      const v = Number(m.values?.[0]?.value);
      if (!Number.isFinite(v)) continue;
      if (m.name === 'views') r.visninger = v;
      if (m.name === 'reach') r.raekkevidde = v;
      if (m.name === 'shares') r.delinger = v;
    }
    opslag.push(r);
  }
}

// Koerer opgaverne et par stykker ad gangen, saa Meta ikke faar 30 samtidige kald
async function iHold<T>(ting: T[], samtidig: number, f: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: samtidig }, async () => {
    while (i < ting.length) await f(ting[i++]);
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return svar({ fejl: 'Kun POST.' }, 405);
  if (!SR) return svar({ fejl: 'Funktionen mangler service_role-noeglen.' }, 500);

  const noegler = await db('rpc/some_noegler', { method: 'POST', body: '{}' }).catch(() => null);
  if (!noegler) return svar({ fejl: 'Kunne ikke laese noeglerne fra Vault.' }, 500);

  // ---------- Adgang: cron-noeglen, eller en bruger i some_adgang ----------
  const cron = req.headers.get('x-some-cron');
  if (!(cron && noegler.some_cron_noegle && cron === noegler.some_cron_noegle)) {
    const adg = await fetch(SB + '/rest/v1/rpc/har_some_adgang', {
      method: 'POST',
      headers: {
        apikey: req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        Authorization: req.headers.get('Authorization') ?? '', 'Content-Type': 'application/json',
      },
      body: '{}',
    }).catch(() => null);
    if (!adg || !adg.ok || (await adg.json().catch(() => false)) !== true) {
      return svar({ fejl: 'Du har ikke adgang til SoMe-tallene.' }, 403);
    }
  }

  const token = noegler.meta_system_token;
  if (!token) return svar({ fejl: 'Meta-adgangen er ikke sat op endnu (meta_system_token mangler i Supabase Vault).', kode: 'ingen_noegle' });

  const body = await req.json().catch(() => ({}));
  const foerste = ((await db('some_dag?select=dato&limit=1')) ?? []).length === 0;
  const dage = Math.max(1, Math.min(90, Number(body?.dage) || (foerste ? 90 : 3)));

  const [log] = await db('some_sync_log', { method: 'POST', headers: { Prefer: 'return=representation' }, body: '{}' });
  const fejl: string[] = [];
  let antal = 0;
  try {
    // ---------- Find kontiene ----------
    const sider = await grafAlle('me/accounts', {
      fields: 'id,name,username,access_token,followers_count,picture{url},instagram_business_account{id,username,name,followers_count,profile_picture_url}',
      limit: 100,
    }, token, 10);
    const konti: Raekke[] = [];
    for (const s of sider) {
      konti.push({ platform: 'facebook', ekstern_id: s.id, navn: s.name, brugernavn: s.username ?? null, billede_url: s.picture?.data?.url ?? null });
      const ig = s.instagram_business_account;
      if (ig) konti.push({ platform: 'instagram', ekstern_id: ig.id, navn: ig.name || ig.username || s.name, brugernavn: ig.username ?? null, billede_url: ig.profile_picture_url ?? null });
    }
    const gemt = await upsert('some_konti', 'platform,ekstern_id', konti, true);
    const id = new Map<string, Json>(gemt.map((k) => [k.platform + ':' + k.ekstern_id, k]));
    antal = gemt.length;

    // ---------- Hent tallene ----------
    const ud = new Dage();
    const opslag: Raekke[] = [];
    await iHold(sider, 4, async (s) => {
      const fb = id.get('facebook:' + s.id);
      if (fb?.aktiv) await hentSide(s, fb.id, dage, ud, opslag, fejl);
      const ig = s.instagram_business_account;
      const igK = ig && id.get('instagram:' + ig.id);
      if (igK?.aktiv) await hentInstagram(ig, igK.navn, s.access_token, igK.id, dage, ud, opslag, fejl);
    });
    await upsert('some_dag', 'konto_id,dato', ud.alle());
    await upsert('some_opslag', 'konto_id,ekstern_id', opslag);
  } catch (e) {
    fejl.unshift((e as Error).message);
    await db('some_sync_log?id=eq.' + log.id, { method: 'PATCH', body: JSON.stringify({ afsluttet_at: new Date().toISOString(), ok: false, konti: antal, fejl: fejl.slice(0, 60) }) });
    console.error('SoMe-indsamling fejlede', fejl[0]);
    return svar({ fejl: 'Indsamlingen fejlede: ' + fejl[0] });
  }
  await db('some_sync_log?id=eq.' + log.id, { method: 'PATCH', body: JSON.stringify({ afsluttet_at: new Date().toISOString(), ok: true, konti: antal, fejl: fejl.length ? fejl.slice(0, 60) : null }) });
  return svar({ ok: true, konti: antal, dage, advarsler: fejl.length });
});
