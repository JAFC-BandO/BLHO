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

-- ---------- Oversigt til siden ----------
-- Summerer perioden og den tilsvarende periode lige foer (til sammenligning) pr. konto, plus
-- dagsserier pr. platform (grafen) og opslagenes fordeling paa ugedag/klokkeslaet (dansk tid).
-- Koerer som brugeren selv, saa RLS afgoer adgangen.
create or replace function public.some_oversigt(p_fra date, p_til date)
returns jsonb language sql stable set search_path = public as $$
  with gr as (select p_fra - (p_til - p_fra + 1) as f_fra, p_fra - 1 as f_til),
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
  o_nu as (
    select konto_id, count(*) antal, sum(likes) likes, sum(kommentarer) kom, sum(delinger) del
    from some_opslag where oprettet_at >= p_fra and oprettet_at < p_til + 1 group by 1),
  o_foer as (
    select konto_id, count(*) antal, sum(likes) likes, sum(kommentarer) kom, sum(delinger) del
    from some_opslag, gr where oprettet_at >= gr.f_fra and oprettet_at < gr.f_til + 1 group by 1),
  serie as (
    select d.dato, k.platform, sum(d.visninger) vis, sum(d.raekkevidde) raek, sum(d.interaktioner) inter, sum(d.nye_foelgere) nye
    from some_dag d join some_konti k on k.id = d.konto_id and k.aktiv, gr
    where d.dato between gr.f_fra and p_til group by d.dato, k.platform)
  select jsonb_build_object(
    'konti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'platform', k.platform, 'navn', k.navn, 'brugernavn', k.brugernavn, 'billede_url', k.billede_url,
        'nu', jsonb_build_object('foelgere', f_nu.foelgere, 'nye_foelgere', nu.nye, 'visninger', nu.vis, 'raekkevidde', nu.raek,
          'interaktioner', nu.inter, 'opslag', o_nu.antal, 'likes', o_nu.likes, 'kommentarer', o_nu.kom, 'delinger', o_nu.del),
        'foer', jsonb_build_object('foelgere', f_foer.foelgere, 'nye_foelgere', foer.nye, 'visninger', foer.vis, 'raekkevidde', foer.raek,
          'interaktioner', foer.inter, 'opslag', o_foer.antal, 'likes', o_foer.likes, 'kommentarer', o_foer.kom, 'delinger', o_foer.del)
      ) order by f_nu.foelgere desc nulls last, k.navn)
      from some_konti k
      left join nu on nu.konto_id = k.id left join foer on foer.konto_id = k.id
      left join f_nu on f_nu.konto_id = k.id left join f_foer on f_foer.konto_id = k.id
      left join o_nu on o_nu.konto_id = k.id left join o_foer on o_foer.konto_id = k.id
      where k.aktiv), '[]'::jsonb),
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
        from some_opslag o join some_konti k on k.id = o.konto_id and k.aktiv
        where o.oprettet_at >= p_fra and o.oprettet_at < p_til + 1 group by 1, 2, 3) t), '[]'::jsonb),
    'foerste_dato', (select min(dato) from some_dag),
    'sidste_sync', (select jsonb_build_object('startet_at', startet_at, 'afsluttet_at', afsluttet_at, 'ok', ok, 'konti', konti, 'fejl', fejl)
      from some_sync_log order by id desc limit 1)
  );
$$;
revoke execute on function public.some_oversigt(date, date) from public, anon;
grant execute on function public.some_oversigt(date, date) to authenticated;

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
    left join public.some_adgang a on a.bruger_id = b.id), '[]'::jsonb);
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
  from vault.decrypted_secrets where name in ('meta_system_token', 'some_cron_noegle');
$$;
revoke execute on function public.some_noegler() from public, anon, authenticated;
grant execute on function public.some_noegler() to service_role;

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
