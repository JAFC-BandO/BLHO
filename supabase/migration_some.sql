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
  foreach t in array array['some_konti', 'some_dag', 'some_opslag', 'some_sync_log'] loop
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
-- Stories (type STORY) taelles for sig og er ikke med i opslag/likes/kommentarer.
-- Kernen tjekker IKKE adgang -- den kaldes kun af some_oversigt og some_rapport nedenfor.
create or replace function public.some_oversigt_kerne(p_fra date, p_til date, p_butik uuid, p_saml boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  with gr as (select p_fra - (p_til - p_fra + 1) as f_fra, p_fra - 1 as f_til),
  kk as (select k.* from some_konti k where k.aktiv and (p_butik is null or k.butik_id = p_butik)),
  nu as (
    select konto_id, sum(nye_foelgere) nye, sum(visninger) vis, sum(raekkevidde) raek, sum(interaktioner) inter
    from some_dag where dato between p_fra and p_til group by 1),
  foer as (
    select konto_id, sum(nye_foelgere) nye, sum(visninger) vis, sum(raekkevidde) raek, sum(interaktioner) inter
    from some_dag, gr where dato between gr.f_fra and gr.f_til group by 1),
  -- + 1: perioden slutter i gaar, men foelgertallet er et oejebliksbillede fra i dag
  f_nu as (
    select distinct on (konto_id) konto_id, foelgere from some_dag
    where dato <= p_til + 1 and foelgere is not null order by konto_id, dato desc),
  f_foer as (
    select distinct on (konto_id) konto_id, foelgere from some_dag
    where dato < p_fra and foelgere is not null order by konto_id, dato desc),
  op as (
    select konto_id, oprettet_at >= p_fra as ny,
      count(*) filter (where type is distinct from 'STORY') antal,
      sum(likes) filter (where type is distinct from 'STORY') likes, sum(kommentarer) filter (where type is distinct from 'STORY') kom,
      sum(delinger) filter (where type is distinct from 'STORY') del,
      nullif(count(*) filter (where type = 'STORY'), 0) stories, sum(visninger) filter (where type = 'STORY') story_vis
    from some_opslag, gr where oprettet_at >= gr.f_fra and oprettet_at < p_til + 1 group by 1, 2),
  pr as (
    select k.id, k.platform, k.navn, k.brugernavn, k.billede_url, k.butik_id,
      f_nu.foelgere n_foelg, nu.nye n_nye, nu.vis n_vis, nu.raek n_raek, nu.inter n_inter, a.antal n_ops, a.likes n_likes, a.kom n_kom, a.del n_del, a.stories n_st, a.story_vis n_stv,
      f_foer.foelgere f_foelg, foer.nye f_nye, foer.vis f_vis, foer.raek f_raek, foer.inter f_inter, b.antal f_ops, b.likes f_likes, b.kom f_kom, b.del f_del, b.stories f_st, b.story_vis f_stv
    from kk k
    left join nu on nu.konto_id = k.id left join foer on foer.konto_id = k.id
    left join f_nu on f_nu.konto_id = k.id left join f_foer on f_foer.konto_id = k.id
    left join op a on a.konto_id = k.id and a.ny left join op b on b.konto_id = k.id and not b.ny),
  ud as (
    select id::text, platform, navn, brugernavn, billede_url, butik_id, n_foelg, n_nye, n_vis, n_raek, n_inter, n_ops, n_likes, n_kom, n_del, n_st, n_stv,
      f_foelg, f_nye, f_vis, f_raek, f_inter, f_ops, f_likes, f_kom, f_del, f_st, f_stv
    from pr where not p_saml
    union all
    select 'alle-' || platform, platform, 'Alle butikker', null, null, null, sum(n_foelg), sum(n_nye), sum(n_vis), sum(n_raek), sum(n_inter), sum(n_ops), sum(n_likes), sum(n_kom), sum(n_del), sum(n_st), sum(n_stv),
      sum(f_foelg), sum(f_nye), sum(f_vis), sum(f_raek), sum(f_inter), sum(f_ops), sum(f_likes), sum(f_kom), sum(f_del), sum(f_st), sum(f_stv)
    from pr where p_saml group by platform),
  serie as (
    select d.dato, k.platform, sum(d.visninger) vis, sum(d.raekkevidde) raek, sum(d.interaktioner) inter, sum(d.nye_foelgere) nye
    from some_dag d join kk k on k.id = d.konto_id, gr
    where d.dato between gr.f_fra and p_til group by d.dato, k.platform)
  select jsonb_build_object(
    'konti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'platform', platform, 'navn', navn, 'brugernavn', brugernavn, 'billede_url', billede_url, 'butik_id', butik_id,
        'nu', jsonb_build_object('foelgere', n_foelg, 'nye_foelgere', n_nye, 'visninger', n_vis, 'raekkevidde', n_raek, 'interaktioner', n_inter,
          'opslag', n_ops, 'likes', n_likes, 'kommentarer', n_kom, 'delinger', n_del, 'stories', n_st, 'story_visninger', n_stv),
        'foer', jsonb_build_object('foelgere', f_foelg, 'nye_foelgere', f_nye, 'visninger', f_vis, 'raekkevidde', f_raek, 'interaktioner', f_inter,
          'opslag', f_ops, 'likes', f_likes, 'kommentarer', f_kom, 'delinger', f_del, 'stories', f_st, 'story_visninger', f_stv)
      ) order by n_foelg desc nulls last, navn) from ud), '[]'::jsonb),
    'serie', coalesce((
      select jsonb_agg(jsonb_build_object('dato', dato, 'platform', platform, 'visninger', vis, 'raekkevidde', raek,
        'interaktioner', inter, 'nye_foelgere', nye) order by dato) from serie where dato >= p_fra), '[]'::jsonb),
    'serie_foer', coalesce((
      select jsonb_agg(jsonb_build_object('dato', dato, 'platform', platform, 'visninger', vis, 'raekkevidde', raek,
        'interaktioner', inter, 'nye_foelgere', nye) order by dato) from serie where dato < p_fra), '[]'::jsonb),
    'tider', coalesce((
      select jsonb_agg(jsonb_build_object('platform', t.platform, 'ugedag', t.ugedag, 'time', t.time, 'antal', t.antal, 'interaktioner', t.inter))
      from (
        select k.platform, extract(isodow from o.oprettet_at at time zone 'Europe/Copenhagen')::int ugedag,
          extract(hour from o.oprettet_at at time zone 'Europe/Copenhagen')::int "time",
          count(*) antal, sum(coalesce(o.likes, 0) + coalesce(o.kommentarer, 0) + coalesce(o.delinger, 0)) inter
        from some_opslag o join kk k on k.id = o.konto_id
        where o.oprettet_at >= p_fra and o.oprettet_at < p_til + 1 and o.type is distinct from 'STORY' group by 1, 2, 3) t), '[]'::jsonb),
    'foerste_dato', (select min(d.dato) from some_dag d join kk k on k.id = d.konto_id),
    'sidste_sync', (select jsonb_build_object('startet_at', startet_at, 'afsluttet_at', afsluttet_at, 'ok', ok, 'konti', konti)
      from some_sync_log order by id desc limit 1)
  );
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
create or replace function public.some_rapport(p_noegle text, p_fra date, p_til date, p_omfang text default 'egen', p_sort text default 'likes')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_butik uuid := public.some_link_butik(p_noegle);
begin
  if v_butik is null then return null; end if;
  if p_til < p_fra or p_til - p_fra > 400 then raise exception 'Ugyldig periode'; end if;
  if p_omfang = 'faelles' then
    return public.some_oversigt_kerne(p_fra, p_til, null, true) || jsonb_build_object('butik', (select navn from butikker where id = v_butik), 'opslag', '[]'::jsonb);
  end if;
  return public.some_oversigt_kerne(p_fra, p_til, v_butik, false) || jsonb_build_object(
    'butik', (select navn from butikker where id = v_butik),
    'opslag', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select o.ekstern_id, o.oprettet_at, o.tekst, o.permalink, o.billede_url, o.likes, o.kommentarer, o.delinger, o.visninger,
        jsonb_build_object('navn', k.navn, 'platform', k.platform) some_konti
      from some_opslag o join some_konti k on k.id = o.konto_id and k.aktiv and k.butik_id = v_butik
      where o.oprettet_at >= p_fra and o.oprettet_at < p_til + 1 and o.type is distinct from 'STORY'
      order by case p_sort when 'kommentarer' then o.kommentarer when 'visninger' then o.visninger else o.likes end desc nulls last
      limit 24) t), '[]'::jsonb));
end $$;
revoke execute on function public.some_rapport(text, date, date, text, text) from public;
grant execute on function public.some_rapport(text, date, date, text, text) to anon, authenticated;

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

-- Kl. 04:30 UTC (05:30/06:30 dansk tid): gaarsdagens tal er klar hos Meta. Ét kald i doegnet.
select cron.unschedule('daglig-some-sync') where exists (select 1 from cron.job where jobname = 'daglig-some-sync');
select cron.schedule('daglig-some-sync', '30 4 * * *', $cron$
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
