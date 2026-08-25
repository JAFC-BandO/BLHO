-- Kør i Supabase SQL Editor (tjek "Postgres role" ved Run-knappen staar paa "postgres").
--
-- "Del med alle butikker" paa et medie: superadmin markerer en fil i medie-biblioteket, og
-- den dukker op i ALLE butikkers bibliotek. Modsat den faelles skabelon, hvor superadmin
-- bestemmer baade indhold OG placering, giver dette kun butikkerne adgang til materialet --
-- de vaelger selv om og hvor de bruger det.
--
-- Samme moenster som `sabloner.delt`, der har fungeret siden migration_superadmin.sql.

alter table media add column if not exists delt boolean not null default false;

-- SELECT: TILFOEJES ved siden af den eksisterende select_own_butik_media_admin_only i
-- stedet for at erstatte den. Policies for samme kommando OR'es sammen i Postgres, saa
-- resultatet bliver "egen butiks medier ELLER delte medier" -- og vi roerer ikke en policy
-- der allerede virker. (Den omvendte faelde -- at glemme at SLETTE en gammel, mere aaben
-- policy naar man strammer op -- er der ingen risiko for her, da vi udvider.)
drop policy if exists "select_delte_medier" on media;
create policy "select_delte_medier" on media
for select
using (
  delt = true
  and exists (
    select 1 from brugere
    where brugere.id = auth.uid()
    and brugere.rolle = 'admin'
  )
);

-- UPDATE: `media` havde hidtil SLET INGEN update-policy, saa ingen kunne aendre en raekke --
-- heller ikke superadmin via API'et. Denne findes udelukkende for at kunne saette/fjerne
-- delt-flaget. Kun superadmin: en enkelt butik maa ikke kunne skubbe sit eget medie ud i
-- alle 16 butikkers biblioteker.
drop policy if exists "update_media_superadmin_only" on media;
create policy "update_media_superadmin_only" on media
for update
using (
  exists (select 1 from brugere where brugere.id = auth.uid() and brugere.er_superadmin = true)
)
with check (
  exists (select 1 from brugere where brugere.id = auth.uid() and brugere.er_superadmin = true)
);

-- DELETE: de oevrige 15 butikker kunne allerede ikke slette et delt medie -- det ligger jo
-- ikke i deres butik. MEN den butik filen tilfaeldigvis ligger i (den superadmin delte den
-- fra, fx Horsens) kunne. Og da sletning OGSAA fjerner selve filen fra Storage, ville
-- Horsens' admin dermed kunne rive et delt medie vaek under foedderne paa alle 15 andre --
-- inklusive fra sider hvor de allerede har placeret det.
--
-- Derfor strammes policyen: et medie med delt = true kan kun slettes af en superadmin.
-- Dette ERSTATTER den eksisterende policy (man kan ikke traekke rettigheder fra med en
-- ekstra policy -- de OR'es sammen, se advarslen i SUPABASE.md). For medier der IKKE er
-- delt, er opfoerslen praecis som foer.
drop policy if exists "delete_own_butik_media_admin_only" on media;
create policy "delete_own_butik_media_admin_only" on media
for delete
using (
  exists (
    select 1 from brugere
    where brugere.id = auth.uid()
    and brugere.butik_id = media.butik_id
    and brugere.rolle = 'admin'
  )
  and (
    delt = false
    or exists (select 1 from brugere where brugere.id = auth.uid() and brugere.er_superadmin = true)
  )
);
-- superadmin_full_access_media_delete fra migration_superadmin_full_access.sql er uaendret
-- og OR'er ind ved siden af -- en superadmin kan fortsat slette alt.

-- ---------- Verifikation (koer efter) ----------
-- select policyname, cmd, qual, with_check
-- from pg_policies where schemaname='public' and tablename='media' order by cmd, policyname;
--
-- Forventet paa media: 2 SELECT (egen butik + delte), 2 INSERT (egen butik + superadmin),
-- 2 DELETE (egen butik + superadmin), 1 UPDATE (kun superadmin).

-- ---------- Rul tilbage ----------
-- drop policy if exists "select_delte_medier" on media;
-- drop policy if exists "update_media_superadmin_only" on media;
-- alter table media drop column delt;
