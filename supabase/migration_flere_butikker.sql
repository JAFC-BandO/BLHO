-- Kør i Supabase SQL Editor (tjek "Postgres role" ved Run-knappen staar paa "postgres").

-- Lader en ALMINDELIG admin (ikke superadmin) have adgang til flere butikker. Modellen er
-- "aktiv butik": brugere.butik_id er stadig den ene butik brugeren arbejder i lige nu, og
-- ALLE eksisterende policies/RPC'er (content, media, sabloner, enheder, storage, admin_log,
-- feedback ...) bliver ved med at tjekke praecis den. bruger_butikker siger blot hvilke
-- butikker brugeren MAA skifte brugere.butik_id over til, via skift_butik() herunder.
--
-- Konsekvens: én aktiv butik ad gangen pr. bruger -- valget gaelder paa tvaers af faner og
-- enheder, og man lander i den senest valgte butik ved naeste login.
--
-- Brugere uden raekker her er uaendrede (kun deres egen brugere.butik_id). Har en bruger
-- raekker, skal ALLE deres butikker staa her -- ogsaa "hjemme"-butikken -- ellers kan de
-- ikke skifte tilbage til den, naar brugere.butik_id foerst er flyttet.

create table if not exists bruger_butikker (
  bruger_id uuid not null references auth.users(id) on delete cascade, -- brugere.id har ingen unik noegle
  butik_id uuid not null references butikker(id) on delete cascade,
  primary key (bruger_id, butik_id)
);

-- Ingen policies = ingen direkte adgang fra klienten. Laeses/bruges kun via de to
-- SECURITY DEFINER-funktioner nedenfor; tildeling sker i SQL Editor.
alter table bruger_butikker enable row level security;
revoke all on bruger_butikker from anon, authenticated;

-- Butikkerne den indloggede bruger kan vaelge imellem (inkl. den aktuelle). En almindelig
-- admin kan ikke selv laese andre butikkers raekke i butikker (RLS), derfor security definer.
create or replace function mine_butikker()
returns table (id uuid, navn text)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.navn
  from butikker b
  where b.id in (
    select butik_id from bruger_butikker where bruger_id = auth.uid()
    union
    select butik_id from brugere where id = auth.uid()
  )
  order by b.navn;
$$;

-- Skifter den indloggede brugers aktive butik. Afviser alt der ikke staar i bruger_butikker
-- for brugeren -- klienten har ingen UPDATE-policy paa brugere, saa det er den eneste vej.
create or replace function skift_butik(p_butik_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from bruger_butikker where bruger_id = auth.uid() and butik_id = p_butik_id
  ) then
    raise exception 'Ingen adgang til den butik';
  end if;
  update brugere set butik_id = p_butik_id where id = auth.uid();
end;
$$;

revoke execute on function mine_butikker() from public, anon;
revoke execute on function skift_butik(uuid) from public, anon;
grant execute on function mine_butikker() to authenticated;
grant execute on function skift_butik(uuid) to authenticated;

-- mp@boerneloppen.dk: Horsens (hjemme) + Herning.
insert into bruger_butikker (bruger_id, butik_id)
select u.id, b.id
from auth.users u
cross join butikker b
where u.email = 'mp@boerneloppen.dk'
  and b.navn in ('Butik Horsens', 'Butik Herning')
on conflict do nothing;

-- Tildel en ny bruger flere butikker (husk ogsaa hjemme-butikken):
--   insert into bruger_butikker (bruger_id, butik_id)
--   select u.id, b.id from auth.users u cross join butikker b
--   where u.email = '...' and b.navn in ('Butik ...', 'Butik ...')
--   on conflict do nothing;
