-- SoMe-performance (erstatning for Hootsuite-rapporterne) -- koer i Supabase SQL Editor
-- ("Postgres role" = postgres). Kan koeres igen uden skade (idempotent).
--
-- Tallene hentes én gang i doegnet af edge-funktionen some-sync (supabase/functions/some-sync)
-- direkte fra Meta (Facebook-sider + Instagram) og gemmes her. Siden BL/some/ laeser kun herfra.
--
-- Hemmeligheder ligger KUN i Supabase Vault (aldrig i repoet, som er offentligt):
--   meta_system_token  -- systembrugerens token fra Meta Business Manager. Oprettes saadan:
--                         select vault.create_secret('<token>', 'meta_system_token');
--   some_cron_noegle   -- oprettes automatisk nedenfor; bruges af cron-jobbet til at kalde some-sync.
--
-- Adgang: KUN brugere med en raekke i `some_adgang` (samme moenster som vagtplan_adgang).
-- Tilfoej/fjern adgang med SQL; klienten kan ikke selv aendre listen.

-- ---------- Adgangsliste ----------
create table if not exists public.some_adgang (
  bruger_id uuid primary key references auth.users(id) on delete cascade,
  oprettet_at timestamptz not null default now()
);
alter table public.some_adgang enable row level security;
revoke all on public.some_adgang from anon, authenticated;
grant select on public.some_adgang to authenticated;
drop policy if exists some_adgang_select_egen on public.some_adgang;
create policy some_adgang_select_egen on public.some_adgang
  for select to authenticated using (bruger_id = auth.uid());

create or replace function public.har_some_adgang()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.some_adgang where bruger_id = auth.uid());
$$;
revoke execute on function public.har_some_adgang() from public, anon;
grant execute on function public.har_some_adgang() to authenticated;

-- ---------- Konti ----------
-- Findes automatisk af some-sync (alle sider systembrugeren har adgang til + deres Instagram).
create table if not exists public.some_konti (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook', 'instagram', 'tiktok')),
  ekstern_id text not null,
  navn text not null,
  brugernavn text,
  billede_url text,
  aktiv boolean not null default true,
  oprettet_at timestamptz not null default now(),
  unique (platform, ekstern_id)
);

-- Sikkerhedsnet: den der godkender adgangen hos Meta kan komme til at tage en side med, der
-- ikke er Børneloppens. Nye konti uden "loppe"/"loppa" i navnet oprettes derfor som inaktive,
-- og some-sync henter ingen tal for inaktive konti. Kan slaas til igen med aktiv = true.
create or replace function public.some_konti_kun_egne()
returns trigger language plpgsql set search_path = public as $$
begin
  if not (coalesce(new.navn, '') ~* 'lopp[ea]' or coalesce(new.brugernavn, '') ~* 'lopp[ea]') then
    new.aktiv := false;
  end if;
  return new;
end $$;
revoke execute on function public.some_konti_kun_egne() from public, anon, authenticated;
drop trigger if exists some_konti_kun_egne on public.some_konti;
create trigger some_konti_kun_egne before insert on public.some_konti
  for each row execute function public.some_konti_kun_egne();

-- ---------- Daglige tal pr. konto ----------
-- foelgere er et oejebliksbillede (antal den dag); resten er dagens tal.
create table if not exists public.some_dag (
  konto_id uuid not null references public.some_konti(id) on delete cascade,
  dato date not null,
  foelgere integer,
  nye_foelgere integer,
  visninger bigint,
  raekkevidde bigint,
  interaktioner integer,
  primary key (konto_id, dato)
);
create index if not exists some_dag_dato on public.some_dag (dato);
-- Stories pr. dag fra FOER vi selv begyndte at samle dem ind (historik fra Hootsuite, se
-- some_historik_dag nedenfor). Egne stories ligger som raekker i some_opslag (type STORY).
alter table public.some_dag add column if not exists stories integer;
alter table public.some_dag add column if not exists story_visninger bigint;

-- ---------- Opslag ----------
create table if not exists public.some_opslag (
  konto_id uuid not null references public.some_konti(id) on delete cascade,
  ekstern_id text not null,
  oprettet_at timestamptz not null,
  type text,
  tekst text,
  permalink text,
  billede_url text,
  likes integer,
  kommentarer integer,
  delinger integer,
  visninger bigint,
  raekkevidde bigint,
  opdateret_at timestamptz not null default now(),
  primary key (konto_id, ekstern_id)
);
create index if not exists some_opslag_oprettet on public.some_opslag (oprettet_at);

-- ---------- Foelgere online (kun Instagram) ----------
-- Metas online_followers: hvor mange af kontoens foelgere der var online i hver time, pr. dag
-- (omregnet til dansk dato og klokkeslaet). Meta gemmer kun 30 dage, saa indsamlingen gemmer
-- dem her. Facebook har ikke tallet laengere (fjernet af Meta i september 2024).
create table if not exists public.some_online (
  konto_id uuid not null references public.some_konti(id) on delete cascade,
  dato date not null,
  "time" smallint not null,
  antal integer not null,
  primary key (konto_id, dato, "time")
);

-- ---------- Log over indsamlinger ----------
create table if not exists public.some_sync_log (
  id bigint generated always as identity primary key,
  startet_at timestamptz not null default now(),
  afsluttet_at timestamptz,
  ok boolean,
  konti integer,
  fejl jsonb
);

-- Kun laesning for brugere i some_adgang; some-sync skriver med service_role (uden om RLS).
do $$
declare t text;
begin
  foreach t in array array['some_konti', 'some_dag', 'some_opslag', 'some_online', 'some_sync_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.har_some_adgang())', t || '_select', t);
  end loop;
end $$;

-- ---------- Konti hoerer til en butik ----------
-- Koblingen saettes automatisk ud fra navnet ("Børneloppen Horsens" -> "Butik Horsens") og kan
-- rettes med SQL (update some_konti set butik_id = ...), hvis navnene ikke passer.
alter table public.some_konti add column if not exists butik_id uuid references public.butikker(id) on delete set null;

create or replace function public.some_konti_kun_egne()
returns trigger language plpgsql set search_path = public as $$
begin
  if not (coalesce(new.navn, '') ~* 'lopp[ea]' or coalesce(new.brugernavn, '') ~* 'lopp[ea]') then
    new.aktiv := false;
  end if;
  if new.butik_id is null then
    select b.id into new.butik_id from public.butikker b
    where lower(regexp_replace(new.navn, '^b.rneloppen\s+', '', 'i')) like lower(regexp_replace(b.navn, '^butik\s+', '', 'i')) || '%'
    order by length(b.navn) desc limit 1;
  end if;
  return new;
end $$;
revoke execute on function public.some_konti_kun_egne() from public, anon, authenticated;

update public.some_konti k set butik_id = (
  select b.id from public.butikker b
  where lower(regexp_replace(k.navn, '^b.rneloppen\s+', '', 'i')) like lower(regexp_replace(b.navn, '^butik\s+', '', 'i')) || '%'
  order by length(b.navn) desc limit 1)
where k.butik_id is null;

-- ---------- Historik fra Hootsuite ----------
-- Det, Meta ikke udleverer bagud: Instagrams foelgertal (kun dagens tal), nye foelgere paa
-- Instagram (kun 30 dage) og stories (findes kun i 24 timer). Hentet ud af Hootsuite 7/10-2026,
-- foer abonnementet blev opsagt. Raekkerne er noeglet paa kontoens id hos Meta -- ikke paa
-- some_konti -- saa historikken for en butik, der foerst kobles paa senere, ligger klar og
-- flettes ind af sig selv (triggeren nedenfor). Egne tal vinder altid over historikken.
create table if not exists public.some_historik_dag (
  platform text not null,
  ekstern_id text not null,
  dato date not null,
  foelgere integer,
  nye_foelgere integer,
  stories integer,
  story_visninger bigint,
  kilde text not null default 'hootsuite',
  primary key (platform, ekstern_id, dato)
);
alter table public.some_historik_dag enable row level security;
revoke all on public.some_historik_dag from anon, authenticated;

-- Fletter historikken ind i some_dag (alle konti, eller kun p_konto). Kan koeres igen uden skade.
-- Stories tages kun med for dage FOER kontoens foerste egen story, saa intet taelles to gange.
create or replace function public.some_historik_flet(p_konto uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into some_dag (konto_id, dato, foelgere, nye_foelgere, stories, story_visninger)
  select k.id, h.dato, h.foelgere, h.nye_foelgere,
    case when e.foerste is null or h.dato < e.foerste then h.stories end,
    case when e.foerste is null or h.dato < e.foerste then h.story_visninger end
  from some_historik_dag h
  join some_konti k on k.platform = h.platform and k.ekstern_id = h.ekstern_id
  left join (select konto_id, (min(oprettet_at) at time zone 'UTC')::date as foerste
             from some_opslag where type = 'STORY' group by 1) e on e.konto_id = k.id
  where p_konto is null or k.id = p_konto
  on conflict (konto_id, dato) do update set
    foelgere = coalesce(some_dag.foelgere, excluded.foelgere),
    nye_foelgere = coalesce(some_dag.nye_foelgere, excluded.nye_foelgere),
    stories = excluded.stories,
    story_visninger = excluded.story_visninger;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.some_historik_flet(uuid) from public, anon, authenticated;

create or replace function public.some_konti_historik()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.some_historik_flet(new.id);
  return null;
end $$;
revoke execute on function public.some_konti_historik() from public, anon, authenticated;
drop trigger if exists some_konti_historik on public.some_konti;
create trigger some_konti_historik after insert on public.some_konti
  for each row execute function public.some_konti_historik();

-- Indlaesning af historik (kun den, der styrer SoMe-adgangen). p er en liste af raekker:
-- [platform, ekstern_id, dato, foelgere, nye_foelgere, stories, story_visninger] -- null = uaendret.
-- Efter indlaesning flettes tallene ind med: select public.some_historik_flet();
create or replace function public.some_historik_import(p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.kan_styre_some() then raise exception 'Ingen adgang'; end if;
  insert into some_historik_dag (platform, ekstern_id, dato, foelgere, nye_foelgere, stories, story_visninger)
  select x->>0, x->>1, (x->>2)::date, (x->>3)::int, (x->>4)::int, (x->>5)::int, (x->>6)::bigint
  from jsonb_array_elements(p) x
  where x->>0 in ('facebook', 'instagram') and x->>1 ~ '^[0-9]+$'
  on conflict (platform, ekstern_id, dato) do update set
    foelgere = coalesce(excluded.foelgere, some_historik_dag.foelgere),
    nye_foelgere = coalesce(excluded.nye_foelgere, some_historik_dag.nye_foelgere),
    stories = coalesce(excluded.stories, some_historik_dag.stories),
    story_visninger = coalesce(excluded.story_visninger, some_historik_dag.story_visninger);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.some_historik_import(jsonb) from public, anon;
grant execute on function public.some_historik_import(jsonb) to authenticated;

-- ---------- Butikslinks ----------
-- Et link pr. butik (BL/some/?k=<noegle>), som kan aabnes uden login og kun viser butikkens
-- egne tal + kaedens samlede tal. Noeglen er hemmeligheden; tabellen kan kun naas via RPC'erne.
create table if not exists public.some_links (
  butik_id uuid primary key references public.butikker(id) on delete cascade,
  noegle text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  aktiv boolean not null default true,
  oprettet_at timestamptz not null default now()
);
alter table public.some_links enable row level security;
revoke all on public.some_links from anon, authenticated;

create or replace function public.some_link_butik(p_noegle text)
returns uuid language sql stable security definer set search_path = public as $$
  select butik_id from public.some_links where noegle = p_noegle and aktiv and length(p_noegle) >= 32;
$$;
revoke execute on function public.some_link_butik(text) from public, anon, authenticated;
grant execute on function public.some_link_butik(text) to service_role;

create or replace function public.some_links_liste()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.kan_styre_some() then raise exception 'Ingen adgang'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('butik_id', b.id, 'butik', b.navn, 'noegle', l.noegle, 'aktiv', coalesce(l.aktiv, false),
      'konti', (select count(*) from public.some_konti k where k.butik_id = b.id and k.aktiv)) order by b.navn)
    from public.butikker b left join public.some_links l on l.butik_id = b.id), '[]'::jsonb);
end $$;
revoke execute on function public.some_links_liste() from public, anon;
grant execute on function public.some_links_liste() to authenticated;

-- p_handling: 'opret' (eller taend igen), 'ny' (ny noegle -- det gamle link holder op med at virke), 'sluk'
create or replace function public.some_link_saet(p_butik uuid, p_handling text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.kan_styre_some() then raise exception 'Ingen adgang'; end if;
  if p_handling = 'sluk' then
    update public.some_links set aktiv = false where butik_id = p_butik;
  elsif p_handling = 'ny' then
    insert into public.some_links (butik_id) values (p_butik)
    on conflict (butik_id) do update set noegle = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), aktiv = true;
  else
    insert into public.some_links (butik_id) values (p_butik) on conflict (butik_id) do update set aktiv = true;
  end if;
end $$;
revoke execute on function public.some_link_saet(uuid, text) from public, anon;
grant execute on function public.some_link_saet(uuid, text) to authenticated;

-- ---------- Oversigt ----------
-- Kernen summerer perioden og den tilsvarende periode lige foer pr. konto, plus dagsserier pr.
-- platform (grafen) og opslagenes fordeling paa ugedag/klokkeslaet (dansk tid).
-- p_butik: kun den butiks konti (null = alle). p_saml: laeg kontiene sammen pr. platform, saa
-- de enkelte butikkers tal ikke kan ses (bruges af butikslinkenes "Alle butikker").
-- Stories (type STORY) taelles for sig og er ikke med i opslag/likes/kommentarer. Stories fra
-- foer vi selv samlede dem ind, ligger som dagstal i some_dag (historik) og laegges til.
-- Kernen tjekker IKKE adgang -- den kaldes kun af some_oversigt og some_rapport nedenfor.
-- p_f_fra..p_f_til er perioden, der sammenlignes med -- siden vaelger den: samme periode sidste
-- aar, eller perioden lige foer. Den skal slutte foer p_fra.
create or replace function public.some_oversigt_kerne2(p_fra date, p_til date, p_butik uuid, p_saml boolean, p_f_fra date, p_f_til date)
returns jsonb language sql stable security definer set search_path = public as $$
  with gr as (select p_f_fra as f_fra, p_f_til as f_til),
  kk as (select k.* from some_konti k where k.aktiv and (p_butik is null or k.butik_id = p_butik)),
  nu as (
    select konto_id, sum(nye_foelgere) nye, sum(visninger) vis, sum(raekkevidde) raek, sum(interaktioner) inter,
      sum(stories) st, sum(story_visninger) stv
    from some_dag where dato between p_fra and p_til group by 1),
  -- Forrige periode taeller kun med, naar der er tal for (naesten) alle dagene -- ellers
  -- sammenlignes en hel periode med et par dage (fx Instagrams nye foelgere, som Meta kun
  -- udleverer 30 dage tilbage), og procenten bliver meningsloes.
  foer as (
    select konto_id,
      case when count(nye_foelgere) >= 0.9 * min(gr.f_til - gr.f_fra + 1) then sum(nye_foelgere) end nye,
      case when count(visninger) >= 0.9 * min(gr.f_til - gr.f_fra + 1) then sum(visninger) end vis,
      case when count(raekkevidde) >= 0.9 * min(gr.f_til - gr.f_fra + 1) then sum(raekkevidde) end raek,
      case when count(interaktioner) >= 0.9 * min(gr.f_til - gr.f_fra + 1) then sum(interaktioner) end inter,
      sum(stories) st, sum(story_visninger) stv
    from some_dag, gr where dato between gr.f_fra and gr.f_til group by 1),
  -- + 1: perioden slutter i gaar, men foelgertallet er et oejebliksbillede fra i dag
  f_nu as (
    select distinct on (konto_id) konto_id, foelgere from some_dag
    where dato <= p_til + 1 and foelgere is not null order by konto_id, dato desc),
  f_foer as (
    select distinct on (konto_id) konto_id, foelgere from some_dag, gr
    where dato <= gr.f_til + 1 and foelgere is not null order by konto_id, dato desc),
  -- Opslag taelles som i de gamle rapporter: reels og stories for sig, og begivenheder
  -- (created_event) er ikke opslag. Dagene er danske dage, ikke UTC.
  op as (
    select konto_id, oprettet_at >= (p_fra::timestamp at time zone 'Europe/Copenhagen') as ny,
      count(*) filter (where type is null or type not in ('STORY', 'REELS', 'created_event')) antal,
      sum(visninger) filter (where type is null or type not in ('STORY', 'REELS', 'created_event')) ops_vis,
      count(*) filter (where type = 'REELS') reels, sum(visninger) filter (where type = 'REELS') reel_vis,
      sum(likes) filter (where type is distinct from 'STORY') likes, sum(kommentarer) filter (where type is distinct from 'STORY') kom,
      sum(delinger) filter (where type is distinct from 'STORY') del,
      nullif(count(*) filter (where type = 'STORY'), 0) stories, sum(visninger) filter (where type = 'STORY') story_vis
    from some_opslag, gr
    where (oprettet_at >= (p_fra::timestamp at time zone 'Europe/Copenhagen')
        and oprettet_at < ((p_til + 1)::timestamp at time zone 'Europe/Copenhagen'))
      or (oprettet_at >= (gr.f_fra::timestamp at time zone 'Europe/Copenhagen')
        and oprettet_at < ((gr.f_til + 1)::timestamp at time zone 'Europe/Copenhagen')) group by 1, 2),
  pr as (
    select k.id, k.platform, k.navn, k.brugernavn, k.billede_url, k.butik_id,
      f_nu.foelgere n_foelg, nu.nye n_nye, nu.vis n_vis, nu.raek n_raek, nu.inter n_inter, a.antal n_ops, a.likes n_likes, a.kom n_kom, a.del n_del,
      a.reels n_reels, a.ops_vis n_opv, a.reel_vis n_rev,
      nullif(coalesce(a.stories, 0) + coalesce(nu.st, 0), 0) n_st,
      case when a.story_vis is not null or nu.stv is not null then coalesce(a.story_vis, 0) + coalesce(nu.stv, 0) end n_stv,
      f_foer.foelgere f_foelg, foer.nye f_nye, foer.vis f_vis, foer.raek f_raek, foer.inter f_inter, b.antal f_ops, b.likes f_likes, b.kom f_kom, b.del f_del,
      b.reels f_reels, b.ops_vis f_opv, b.reel_vis f_rev,
      nullif(coalesce(b.stories, 0) + coalesce(foer.st, 0), 0) f_st,
      case when b.story_vis is not null or foer.stv is not null then coalesce(b.story_vis, 0) + coalesce(foer.stv, 0) end f_stv
    from kk k
    left join nu on nu.konto_id = k.id left join foer on foer.konto_id = k.id
    left join f_nu on f_nu.konto_id = k.id left join f_foer on f_foer.konto_id = k.id
    left join op a on a.konto_id = k.id and a.ny left join op b on b.konto_id = k.id and not b.ny),
  ud as (
    select id::text, platform, navn, brugernavn, billede_url, butik_id, n_foelg, n_nye, n_vis, n_raek, n_inter, n_ops, n_likes, n_kom, n_del, n_st, n_stv, n_reels, n_opv, n_rev,
      f_foelg, f_nye, f_vis, f_raek, f_inter, f_ops, f_likes, f_kom, f_del, f_st, f_stv, f_reels, f_opv, f_rev
    from pr where not p_saml
    union all
    select 'alle-' || platform, platform, 'Alle butikker', null, null, null, sum(n_foelg), sum(n_nye), sum(n_vis), sum(n_raek), sum(n_inter), sum(n_ops), sum(n_likes), sum(n_kom), sum(n_del), sum(n_st), sum(n_stv), sum(n_reels), sum(n_opv), sum(n_rev),
      sum(f_foelg), sum(f_nye), sum(f_vis), sum(f_raek), sum(f_inter), sum(f_ops), sum(f_likes), sum(f_kom), sum(f_del), sum(f_st), sum(f_stv), sum(f_reels), sum(f_opv), sum(f_rev)
    from pr where p_saml group by platform),
  serie as (
    select d.dato, k.platform, sum(d.visninger) vis, sum(d.raekkevidde) raek, sum(d.interaktioner) inter, sum(d.nye_foelgere) nye
    from some_dag d join kk k on k.id = d.konto_id, gr
    where d.dato between p_fra and p_til or d.dato between gr.f_fra and gr.f_til group by d.dato, k.platform)
  select jsonb_build_object(
    'konti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'platform', platform, 'navn', navn, 'brugernavn', brugernavn, 'billede_url', billede_url, 'butik_id', butik_id,
        'nu', jsonb_build_object('foelgere', n_foelg, 'nye_foelgere', n_nye, 'visninger', n_vis, 'raekkevidde', n_raek, 'interaktioner', n_inter,
          'opslag', n_ops, 'likes', n_likes, 'kommentarer', n_kom, 'delinger', n_del, 'stories', n_st, 'story_visninger', n_stv,
          'reels', n_reels, 'opslag_visninger', n_opv, 'reel_visninger', n_rev),
        'foer', jsonb_build_object('foelgere', f_foelg, 'nye_foelgere', f_nye, 'visninger', f_vis, 'raekkevidde', f_raek, 'interaktioner', f_inter,
          'opslag', f_ops, 'likes', f_likes, 'kommentarer', f_kom, 'delinger', f_del, 'stories', f_st, 'story_visninger', f_stv,
          'reels', f_reels, 'opslag_visninger', f_opv, 'reel_visninger', f_rev)
      ) order by n_foelg desc nulls last, navn) from ud), '[]'::jsonb),
    'serie', coalesce((
      select jsonb_agg(jsonb_build_object('dato', dato, 'platform', platform, 'visninger', vis, 'raekkevidde', raek,
        'interaktioner', inter, 'nye_foelgere', nye) order by dato) from serie where dato >= p_fra), '[]'::jsonb),
    'serie_foer', coalesce((
      select jsonb_agg(jsonb_build_object('dato', dato, 'platform', platform, 'visninger', vis, 'raekkevidde', raek,
        'interaktioner', inter, 'nye_foelgere', nye) order by dato) from serie where dato < p_fra), '[]'::jsonb),
    -- Bedste tidspunkter: pr. ugedag og tidsblok (blokkens foerste time). Ét opslag der gik godt er
    -- ikke et moenster, og en stor butik faar altid flere visninger end en lille -- derfor maales
    -- hvert opslag mod sin egen kontos median i perioden (1 = et normalt opslag), og feltet faar
    -- medianen af dem (score). Interaktioner er med som hidtil (til dialogen bag feltet).
    'tider', coalesce((
      select jsonb_agg(jsonb_build_object('platform', t.platform, 'ugedag', t.ugedag, 'time', t.time, 'antal', t.antal, 'interaktioner', t.inter, 'score', t.score))
      from (
        with p as (
          select k.platform, o.konto_id, o.visninger, coalesce(o.likes, 0) + coalesce(o.kommentarer, 0) + coalesce(o.delinger, 0) inter,
            extract(isodow from o.oprettet_at at time zone 'Europe/Copenhagen')::int ugedag,
            extract(hour from o.oprettet_at at time zone 'Europe/Copenhagen')::int tm
          from some_opslag o join kk k on k.id = o.konto_id
          where o.oprettet_at >= (p_fra::timestamp at time zone 'Europe/Copenhagen')
            and o.oprettet_at < ((p_til + 1)::timestamp at time zone 'Europe/Copenhagen')
            and (o.type is null or o.type not in ('STORY', 'created_event'))),
        m as (select konto_id, percentile_cont(0.5) within group (order by visninger) med from p where visninger is not null group by 1)
        select p.platform, p.ugedag,
          case when p.tm < 6 then 0 when p.tm < 9 then 6 when p.tm < 12 then 9 when p.tm < 15 then 12 when p.tm < 18 then 15 when p.tm < 21 then 18 else 21 end "time",
          count(*) antal, sum(p.inter) inter,
          round((percentile_cont(0.5) within group (order by p.visninger::numeric / nullif(m.med, 0)))::numeric, 2) score
        from p left join m on m.konto_id = p.konto_id group by 1, 2, 3) t), '[]'::jsonb),
    -- Foelgere online (kun Instagram): snit pr. ugedag og time over de seneste 4 uger med tal
    'online', coalesce((
      select jsonb_agg(jsonb_build_object('platform', 'instagram', 'ugedag', x.ugedag, 'time', x.time, 'antal', x.antal))
      from (
        select extract(isodow from s.dato)::int ugedag, s.time, round(sum(s.antal)::numeric / count(distinct s.dato)) antal
        from some_online s join kk k on k.id = s.konto_id
        where s.dato > (select max(dato) from some_online) - 28 group by 1, 2) x), '[]'::jsonb),
    'foerste_dato', (select min(d.dato) from some_dag d join kk k on k.id = d.konto_id),
    'sidste_sync', (select jsonb_build_object('startet_at', startet_at, 'afsluttet_at', afsluttet_at, 'ok', ok, 'konti', konti)
      from some_sync_log order by id desc limit 1)
  );
$$;
revoke execute on function public.some_oversigt_kerne2(date, date, uuid, boolean, date, date) from public, anon, authenticated;

-- Den oprindelige kerne (bruges af some_overblik/some_rapport, som aeldre udgaver af siden
-- kalder): sammenligner med perioden lige foer -- eller hele maaneden foer, naar perioden er en
-- hel kalendermaaned.
create or replace function public.some_oversigt_kerne(p_fra date, p_til date, p_butik uuid, p_saml boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.some_oversigt_kerne2(p_fra, p_til, p_butik, p_saml,
    case when p_fra = date_trunc('month', p_fra)::date and p_til = (date_trunc('month', p_fra) + interval '1 month - 1 day')::date
      then (date_trunc('month', p_fra) - interval '1 month')::date else p_fra - (p_til - p_fra + 1) end,
    p_fra - 1);
$$;
revoke execute on function public.some_oversigt_kerne(date, date, uuid, boolean) from public, anon, authenticated;

-- SoMe-fanen (brugere i some_adgang): alle konti, eller én butik (p_butik) naar man graver ned.
-- (Hed tidligere some_oversigt(date, date) -- den gamle funktion bruges ikke laengere.)
create or replace function public.some_overblik(p_fra date, p_til date, p_butik uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.har_some_adgang() then
    public.some_oversigt_kerne(p_fra, p_til, p_butik, false) || jsonb_build_object(
      'butikker', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'navn', b.navn) order by b.navn), '[]'::jsonb)
        from butikker b where exists (select 1 from some_konti k where k.butik_id = b.id and k.aktiv)),
      'sync_fejl', (select fejl from some_sync_log order by id desc limit 1))
  end;
$$;
revoke execute on function public.some_overblik(date, date, uuid) from public, anon;
grant execute on function public.some_overblik(date, date, uuid) to authenticated;

-- Butikslinket (uden login): butikkens egne tal ('egen') eller kaedens samlede tal ('faelles')
-- plus de bedste opslag pr. platform (egne, eller paa tvaers af alle butikker i 'faelles')
create or replace function public.some_rapport(p_noegle text, p_fra date, p_til date, p_omfang text default 'egen', p_sort text default 'visninger')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_butik uuid := public.some_link_butik(p_noegle);
  v_faelles boolean := p_omfang = 'faelles';
begin
  if v_butik is null then return null; end if;
  if p_til < p_fra or p_til - p_fra > 400 then raise exception 'Ugyldig periode'; end if;
  -- 'faelles': tallene er lagt sammen pr. platform (ingen enkelt butiks tal), men top-opslagene
  -- vises paa tvaers af butikkerne, saa man kan se, hvad der virker hos de andre.
  return public.some_oversigt_kerne(p_fra, p_til, case when v_faelles then null else v_butik end, v_faelles) || jsonb_build_object(
    'butik', (select navn from butikker where id = v_butik),
    'opslag', coalesce((select jsonb_agg(to_jsonb(t) - 'nr' order by t.nr) from (
      select o.ekstern_id, o.oprettet_at, o.tekst, o.permalink, o.billede_url, o.likes, o.kommentarer, o.delinger, o.visninger,
        jsonb_build_object('navn', k.navn, 'platform', k.platform) some_konti,
        row_number() over (partition by k.platform
          order by case p_sort when 'kommentarer' then o.kommentarer when 'likes' then o.likes else o.visninger end desc nulls last) nr
      from some_opslag o join some_konti k on k.id = o.konto_id and k.aktiv and (v_faelles or k.butik_id = v_butik)
      where o.oprettet_at >= (p_fra::timestamp at time zone 'Europe/Copenhagen')
        and o.oprettet_at < ((p_til + 1)::timestamp at time zone 'Europe/Copenhagen')
        and (o.type is null or o.type not in ('STORY', 'created_event'))) t where t.nr <= 5), '[]'::jsonb));
end $$;
revoke execute on function public.some_rapport(text, date, date, text, text) from public;
grant execute on function public.some_rapport(text, date, date, text, text) to anon, authenticated;

-- ---------- Samme svar, men med valgfri sammenligningsperiode (det siden bruger nu) ----------
create or replace function public.some_overblik2(p_fra date, p_til date, p_butik uuid, p_f_fra date, p_f_til date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.har_some_adgang() then return null; end if;
  if p_til < p_fra or p_f_til < p_f_fra or p_f_til >= p_fra or p_f_til - p_f_fra > 400 then raise exception 'Ugyldig periode'; end if;
  return public.some_oversigt_kerne2(p_fra, p_til, p_butik, false, p_f_fra, p_f_til) || jsonb_build_object(
    'butikker', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'navn', b.navn) order by b.navn), '[]'::jsonb)
      from butikker b where exists (select 1 from some_konti k where k.butik_id = b.id and k.aktiv)),
    'sync_fejl', (select fejl from some_sync_log order by id desc limit 1));
end $$;
revoke execute on function public.some_overblik2(date, date, uuid, date, date) from public, anon;
grant execute on function public.some_overblik2(date, date, uuid, date, date) to authenticated;

create or replace function public.some_rapport2(p_noegle text, p_fra date, p_til date, p_omfang text, p_sort text, p_f_fra date, p_f_til date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_butik uuid := public.some_link_butik(p_noegle);
  v_faelles boolean := p_omfang = 'faelles';
begin
  if v_butik is null then return null; end if;
  if p_til < p_fra or p_til - p_fra > 400 or p_f_til < p_f_fra or p_f_til >= p_fra or p_f_til - p_f_fra > 400 then raise exception 'Ugyldig periode'; end if;
  return public.some_oversigt_kerne2(p_fra, p_til, case when v_faelles then null else v_butik end, v_faelles, p_f_fra, p_f_til) || jsonb_build_object(
    'butik', (select navn from butikker where id = v_butik),
    'opslag', coalesce((select jsonb_agg(to_jsonb(t) - 'nr' order by t.nr) from (
      select o.ekstern_id, o.oprettet_at, o.tekst, o.permalink, o.billede_url, o.likes, o.kommentarer, o.delinger, o.visninger,
        jsonb_build_object('navn', k.navn, 'platform', k.platform) some_konti,
        row_number() over (partition by k.platform
          order by case p_sort when 'kommentarer' then o.kommentarer when 'likes' then o.likes else o.visninger end desc nulls last) nr
      from some_opslag o join some_konti k on k.id = o.konto_id and k.aktiv and (v_faelles or k.butik_id = v_butik)
      where o.oprettet_at >= (p_fra::timestamp at time zone 'Europe/Copenhagen')
        and o.oprettet_at < ((p_til + 1)::timestamp at time zone 'Europe/Copenhagen')
        and (o.type is null or o.type not in ('STORY', 'created_event'))) t where t.nr <= 5), '[]'::jsonb));
end $$;
revoke execute on function public.some_rapport2(text, date, date, text, text, date, date) from public;
grant execute on function public.some_rapport2(text, date, date, text, text, date, date) to anon, authenticated;

-- ---------- Opslagene bag ét felt i "Bedste tidspunkter at poste" ----------
-- p_ugedag 1-7 = mandag-soendag, timerne er dansk tid (samme afgraensning som 'tider' i kernen).
-- Hoejst 60 opslag, flest interaktioner foerst. Kernen tjekker ikke adgang.
create or replace function public.some_tid_kerne(p_fra date, p_til date, p_butik uuid, p_platform text, p_ugedag int, p_time_fra int, p_time_til int)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.interaktioner desc, t.oprettet_at desc), '[]'::jsonb) from (
    select o.ekstern_id, o.oprettet_at, o.type, o.tekst, o.permalink, o.billede_url, o.likes, o.kommentarer, o.delinger, o.visninger,
      coalesce(o.likes, 0) + coalesce(o.kommentarer, 0) + coalesce(o.delinger, 0) as interaktioner,
      jsonb_build_object('navn', k.navn, 'platform', k.platform) some_konti
    from some_opslag o
    join some_konti k on k.id = o.konto_id and k.aktiv and k.platform = p_platform and (p_butik is null or k.butik_id = p_butik)
    where o.oprettet_at >= (p_fra::timestamp at time zone 'Europe/Copenhagen')
      and o.oprettet_at < ((p_til + 1)::timestamp at time zone 'Europe/Copenhagen')
      and (o.type is null or o.type not in ('STORY', 'created_event'))
      and extract(isodow from o.oprettet_at at time zone 'Europe/Copenhagen')::int = p_ugedag
      and extract(hour from o.oprettet_at at time zone 'Europe/Copenhagen')::int >= p_time_fra
      and extract(hour from o.oprettet_at at time zone 'Europe/Copenhagen')::int < p_time_til
    order by coalesce(o.likes, 0) + coalesce(o.kommentarer, 0) + coalesce(o.delinger, 0) desc, o.oprettet_at desc
    limit 60) t;
$$;
revoke execute on function public.some_tid_kerne(date, date, uuid, text, int, int, int) from public, anon, authenticated;

-- SoMe-fanen (brugere i some_adgang)
create or replace function public.some_tid_opslag(p_fra date, p_til date, p_butik uuid, p_platform text, p_ugedag int, p_time_fra int, p_time_til int)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.har_some_adgang() then public.some_tid_kerne(p_fra, p_til, p_butik, p_platform, p_ugedag, p_time_fra, p_time_til) end;
$$;
revoke execute on function public.some_tid_opslag(date, date, uuid, text, int, int, int) from public, anon;
grant execute on function public.some_tid_opslag(date, date, uuid, text, int, int, int) to authenticated;

-- Butikslinket (uden login): egne opslag, eller paa tvaers af butikkerne i 'faelles'
create or replace function public.some_rapport_tid(p_noegle text, p_fra date, p_til date, p_omfang text, p_platform text, p_ugedag int, p_time_fra int, p_time_til int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_butik uuid := public.some_link_butik(p_noegle);
begin
  if v_butik is null then return null; end if;
  if p_til < p_fra or p_til - p_fra > 400 then raise exception 'Ugyldig periode'; end if;
  return public.some_tid_kerne(p_fra, p_til, case when p_omfang = 'faelles' then null else v_butik end, p_platform, p_ugedag, p_time_fra, p_time_til);
end $$;
revoke execute on function public.some_rapport_tid(text, date, date, text, text, int, int, int) from public;
grant execute on function public.some_rapport_tid(text, date, date, text, text, int, int, int) to anon, authenticated;

-- ---------- Styring af adgangen (Admin-menuen i butik-redigering) ----------
-- Kun brugere med kan_styre maa se og aendre, hvem der har SoMe-fanen. Flaget saettes med SQL:
--   update public.some_adgang set kan_styre = true where bruger_id = (select id from auth.users where email = '...');
alter table public.some_adgang add column if not exists kan_styre boolean not null default false;

create or replace function public.kan_styre_some()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.some_adgang where bruger_id = auth.uid() and kan_styre);
$$;
revoke execute on function public.kan_styre_some() from public, anon;
grant execute on function public.kan_styre_some() to authenticated;

create or replace function public.some_adgang_liste()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.kan_styre_some() then raise exception 'Ingen adgang'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('bruger_id', b.id, 'navn', b.navn, 'email', u.email, 'butik', bu.navn,
      'har', a.bruger_id is not null, 'kan_styre', coalesce(a.kan_styre, false)) order by bu.navn nulls last, u.email)
    from public.brugere b
    join auth.users u on u.id = b.id
    left join public.butikker bu on bu.id = b.butik_id
    left join public.some_adgang a on a.bruger_id = b.id
    where b.rolle is distinct from 'skaerm'), '[]'::jsonb); -- skaermenes egne konti skal ikke paa listen
end $$;
revoke execute on function public.some_adgang_liste() from public, anon;
grant execute on function public.some_adgang_liste() to authenticated;

-- Den der styrer adgangen kan ikke fjerne sig selv (eller andre med kan_styre) ved en fejl
create or replace function public.some_adgang_saet(p_bruger uuid, p_har boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.kan_styre_some() then raise exception 'Ingen adgang'; end if;
  if p_har then
    insert into public.some_adgang (bruger_id) values (p_bruger) on conflict do nothing;
  else
    delete from public.some_adgang where bruger_id = p_bruger and not kan_styre;
  end if;
end $$;
revoke execute on function public.some_adgang_saet(uuid, boolean) from public, anon;
grant execute on function public.some_adgang_saet(uuid, boolean) to authenticated;

-- ---------- Noegler til some-sync (kun service_role) ----------
create or replace function public.some_noegler()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name in ('meta_system_token', 'some_cron_noegle', 'meta_side_tokens');
$$;
revoke execute on function public.some_noegler() from public, anon, authenticated;
grant execute on function public.some_noegler() to service_role;

-- some-sync gemmer hver sides egen noegle her (som JSON). Lavet fra et forlaenget token
-- udloeber de ikke, saa indsamlingen kan koere videre, naar bruger-tokenet udloeber.
create or replace function public.some_gem_side_tokens(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'meta_side_tokens';
  if v_id is null then perform vault.create_secret(p::text, 'meta_side_tokens');
  else perform vault.update_secret(v_id, p::text);
  end if;
end $$;
revoke execute on function public.some_gem_side_tokens(jsonb) from public, anon, authenticated;
grant execute on function public.some_gem_side_tokens(jsonb) to service_role;

-- ---------- Daglig indsamling ----------
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'some_cron_noegle') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'some_cron_noegle');
  end if;
end $$;

-- Én gang i timen (kl. xx:05 UTC), og siden starter ikke selv nogen indsamling -- kun knappen
-- "Opdater nu". Dagstallene behoever kun ét kald i doegnet, men stories lever kun 24 timer:
-- med et kald i timen fanges hver story sidste gang, naar den er mindst 23 timer gammel, saa
-- visningstallet er (naesten) det endelige.
select cron.unschedule('daglig-some-sync') where exists (select 1 from cron.job where jobname = 'daglig-some-sync');
select cron.schedule('daglig-some-sync', '5 * * * *', $cron$
  select net.http_post(
    url := 'https://irijatnmgvutrqngwpaa.supabase.co/functions/v1/some-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-some-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'some_cron_noegle')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$cron$);

-- ---------- Seed: adgang ----------
-- Starter med de samme brugere som vagtplanen. Flere tilfoejes saadan:
--   insert into public.some_adgang (bruger_id) select id from auth.users where email = '...';
insert into public.some_adgang (bruger_id)
select bruger_id from public.vagtplan_adgang on conflict do nothing;

-- ---------- Rapporter: tekst fra den SoMe-ansvarlige til butikkerne ----------
-- En rapport er en tekst (med emojis og linjeskift) laast til en periode. Den vises oeverst paa
-- butikkens side og bestemmer, hvilken periode butikslinket aabner paa -- modtageren kan stadig
-- vaelge en anden periode. butik_id null = faelles tekst til alle butikker. Hver butik har hoejst
-- én aktiv rapport (og der er hoejst én faelles): gemmes den med en ny periode, bliver den gamle
-- raekke til en "tidligere rapport" (arkiveret_at), som stadig kan ses paa siden. "Slet" skjuler
-- en rapport helt (slettet_at) -- aktiv eller tidligere -- men raekken bliver liggende, saa en
-- fortrudt sletning kan hentes frem igen med SQL. Kun den, der styrer SoMe-adgangen (kan_styre),
-- kan skrive og slette.
create table if not exists public.some_rapporter (
  id uuid primary key default gen_random_uuid(),
  butik_id uuid references public.butikker(id) on delete cascade,
  fra date not null,
  til date not null,
  titel text,
  tekst text not null,
  oprettet_at timestamptz not null default now(),
  opdateret_at timestamptz not null default now(),
  opdateret_af uuid,
  slettet_at timestamptz,
  check (til >= fra)
);
alter table public.some_rapporter add column if not exists arkiveret_at timestamptz;
-- Foerst var der én rapport pr. butik OG periode (indekset some_rapporter_unik): af flere aktive
-- for samme butik er den senest gemte den aktive, resten bliver til tidligere rapporter.
drop index if exists public.some_rapporter_unik;
drop index if exists public.some_rapporter_aktiv;
update public.some_rapporter r set arkiveret_at = now()
where r.slettet_at is null and r.arkiveret_at is null and exists (
  select 1 from public.some_rapporter n
  where n.slettet_at is null and n.arkiveret_at is null and n.butik_id is not distinct from r.butik_id
    and (n.opdateret_at, n.id) > (r.opdateret_at, r.id));
create unique index if not exists some_rapporter_en_aktiv
  on public.some_rapporter (coalesce(butik_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where slettet_at is null and arkiveret_at is null;
alter table public.some_rapporter enable row level security;
revoke all on public.some_rapporter from anon, authenticated;

-- SoMe-fanen: alle butikkers rapporter + de faelles -- den aktive foerst, saa de tidligere
create or replace function public.some_rapporter_hent()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.har_some_adgang() then coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'butik_id', r.butik_id, 'fra', r.fra, 'til', r.til, 'titel', r.titel,
      'tekst', r.tekst, 'opdateret_at', r.opdateret_at, 'arkiveret_at', r.arkiveret_at)
      order by (r.arkiveret_at is not null), r.til desc, r.fra desc, r.opdateret_at desc)
    from some_rapporter r where r.slettet_at is null), '[]'::jsonb) end;
$$;
revoke execute on function public.some_rapporter_hent() from public, anon;
grant execute on function public.some_rapporter_hent() to authenticated;

-- Butikslinket (uden login): butikkens egne rapporter + de faelles. Ugyldigt link giver null.
create or replace function public.some_rapporter_link(p_noegle text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'butik_id', r.butik_id, 'fra', r.fra, 'til', r.til, 'titel', r.titel,
      'tekst', r.tekst, 'opdateret_at', r.opdateret_at, 'arkiveret_at', r.arkiveret_at)
      order by (r.arkiveret_at is not null), r.til desc, r.fra desc, r.opdateret_at desc)
    from some_rapporter r where r.slettet_at is null and (r.butik_id is null or r.butik_id = l.butik)), '[]'::jsonb)
  from (select public.some_link_butik(p_noegle) as butik) l where l.butik is not null;
$$;
revoke execute on function public.some_rapporter_link(text) from public;
grant execute on function public.some_rapporter_link(text) to anon, authenticated;

-- Gemmer butikkens rapport for perioden. Er perioden den samme som den aktive rapports, rettes
-- teksten; ellers bliver den gamle raekke til en tidligere rapport, og teksten faar en ny raekke.
create or replace function public.some_rapporter_gem(p_butik uuid, p_fra date, p_til date, p_titel text, p_tekst text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_fra date; v_til date;
begin
  if not public.kan_styre_some() then raise exception 'Ingen adgang'; end if;
  if p_fra is null or p_til is null or p_til < p_fra then raise exception 'Ugyldig periode'; end if;
  if coalesce(btrim(p_tekst), '') = '' then raise exception 'Rapporten mangler tekst'; end if;
  if length(p_tekst) > 8000 then raise exception 'Teksten er for lang (hoejst 8000 tegn)'; end if;
  select id, fra, til into v_id, v_fra, v_til from some_rapporter
    where butik_id is not distinct from p_butik and slettet_at is null and arkiveret_at is null for update;
  if v_id is not null and v_fra = p_fra and v_til = p_til then
    update some_rapporter set titel = nullif(btrim(p_titel), ''), tekst = p_tekst, opdateret_at = now(), opdateret_af = auth.uid()
    where id = v_id;
    return v_id;
  end if;
  if v_id is not null then
    update some_rapporter set arkiveret_at = now() where id = v_id;
  end if;
  insert into some_rapporter (butik_id, fra, til, titel, tekst, opdateret_af)
  values (p_butik, p_fra, p_til, nullif(btrim(p_titel), ''), p_tekst, auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.some_rapporter_gem(uuid, date, date, text, text) from public, anon;
grant execute on function public.some_rapporter_gem(uuid, date, date, text, text) to authenticated;

create or replace function public.some_rapporter_slet(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.kan_styre_some() then raise exception 'Ingen adgang'; end if;
  update some_rapporter set slettet_at = now() where id = p_id;
end $$;
revoke execute on function public.some_rapporter_slet(uuid) from public, anon;
grant execute on function public.some_rapporter_slet(uuid) to authenticated;

-- ---------- Alarm: kommer tallene stadig ind, og er noget ved at udloebe? ----------
-- Indsamlingen spoerger Meta om noeglernes tilstand én gang i doegnet og gemmer svaret i loggen:
-- { "bruger": { gyldigt, udloeber, dataadgang }, "side": { ... } } (tider i sekunder; 0 = aldrig).
alter table public.some_sync_log add column if not exists token jsonb;

-- Til den SoMe-ansvarlige (kan_styre): virker indsamlingen, kommer der tal fra begge platforme,
-- og hvad siger Meta om noeglerne? Alle andre faar null. Admin-siden (BL/butik-redigering)
-- formulerer selv beskeden og viser den oeverst.
create or replace function public.some_alarm()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_sidste some_sync_log; v_ok timestamptz; v_tok jsonb; v_dag date;
begin
  if not public.kan_styre_some() then return null; end if;
  select * into v_sidste from some_sync_log where afsluttet_at is not null order by id desc limit 1;
  select max(afsluttet_at) into v_ok from some_sync_log where ok;
  select token into v_tok from some_sync_log where token is not null order by id desc limit 1;
  -- Instagrams tal for i gaar hentes ved foerste indsamling efter midnat (UTC); Facebook er et
  -- doegn laengere om at levere. Foer kl. 03 UTC ses der derfor en dag laengere tilbage.
  v_dag := (now() at time zone 'UTC')::date - case when extract(hour from now() at time zone 'UTC') >= 3 then 1 else 2 end;
  return jsonb_build_object(
    'sidste', jsonb_build_object('ok', v_sidste.ok, 'afsluttet_at', v_sidste.afsluttet_at, 'fejl', v_sidste.fejl),
    'sidste_ok', v_ok,
    'token', v_tok,
    'ig', (select jsonb_build_object('dato', v_dag, 'konti', count(*), 'uden_tal', count(*) filter (where g.visninger is null),
        'navne', jsonb_agg(k.navn order by k.navn) filter (where g.visninger is null))
      from some_konti k left join some_dag g on g.konto_id = k.id and g.dato = v_dag where k.aktiv and k.platform = 'instagram'),
    'fb', (select jsonb_build_object('dato', v_dag - 1, 'konti', count(*), 'uden_tal', count(*) filter (where g.visninger is null),
        'navne', jsonb_agg(k.navn order by k.navn) filter (where g.visninger is null))
      from some_konti k left join some_dag g on g.konto_id = k.id and g.dato = v_dag - 1 where k.aktiv and k.platform = 'facebook'));
end $$;
revoke execute on function public.some_alarm() from public, anon;
grant execute on function public.some_alarm() to authenticated;
