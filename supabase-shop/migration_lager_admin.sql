-- Lager pr. produkt og farve, superadmin, tags til Google og ordrer (lagertræk fra Stripe-webhooken)

-- Søgeord pr. produkt (vises i produktets strukturerede data til Google)
alter table public.produkter add column tags text[] not null default '{}';

-- Lager: antal pr. produkt og farve (farve = farver[].navn, fx 'Sort')
create table public.lager (
  produkt_id text not null references public.produkter(id) on update cascade on delete cascade,
  farve text not null,
  antal integer not null default 0 check (antal >= 0),
  primary key (produkt_id, farve)
);
alter table public.lager enable row level security;
grant select on public.lager to anon, authenticated;
create policy "alle kan se lager" on public.lager for select to anon, authenticated using (true);

-- Superadmin: bruger-id'er fra auth.users (ikke mails, så ingen kan oprette kontoen før ejeren og blive admin).
-- Tabellen læses kun af er_admin().
create table public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;

create function public.er_admin() returns boolean language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;
revoke execute on function public.er_admin() from public;
grant execute on function public.er_admin() to authenticated;

-- Admin ser alle produkter (også inaktive) og retter tekster, pris, tags og lager. Id og billeder kan ikke rettes.
create policy "admin ser alle produkter" on public.produkter for select to authenticated using ((select public.er_admin()));
create policy "admin retter produkter" on public.produkter for update to authenticated
  using ((select public.er_admin())) with check ((select public.er_admin()));
grant update (navn, kort, beskrivelse, pris_oere, maal, materiale, aktiv, tags) on public.produkter to authenticated;
create policy "admin retter lager" on public.lager for update to authenticated
  using ((select public.er_admin())) with check ((select public.er_admin()));
grant update (antal) on public.lager to authenticated;

-- Betalte ordrer fra Stripe-webhooken; samme betaling trækker kun fra lageret én gang
create table public.ordrer (
  session_id text primary key,
  varer jsonb not null,
  oprettet timestamptz not null default now()
);
alter table public.ordrer enable row level security;
grant select on public.ordrer to authenticated;
create policy "admin ser ordrer" on public.ordrer for select to authenticated using ((select public.er_admin()));

-- Kaldes kun af webhooken (service_role): gemmer ordren og trækker varerne fra lageret, hvis den er ny
create function public.registrer_ordre(p_session text, p_varer jsonb) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ordrer (session_id, varer) values (p_session, p_varer) on conflict do nothing;
  if not found then return false; end if;
  update public.lager l set antal = greatest(l.antal - v.antal, 0)
  from (select id, farve, sum(antal)::int as antal from jsonb_to_recordset(p_varer) as x(id text, farve text, antal int) group by id, farve) v
  where l.produkt_id = v.id and l.farve = v.farve;
  return true;
end $$;
revoke execute on function public.registrer_ordre(text, jsonb) from public, anon, authenticated;
grant execute on function public.registrer_ordre(text, jsonb) to service_role;

-- Start: 20 af hver farve
insert into public.lager (produkt_id, farve, antal)
select p.id, f->>'navn', 20 from public.produkter p, jsonb_array_elements(p.farver) f
on conflict do nothing;

update public.produkter set tags = array['benholder', 'benholder med håndtag', 'højstol', 'højstolsben', 'stoleben', 'passer til IKEA Antilop', 'opbevaring af højstol', 'højstol på farten', '3D-printet', 'dansk design']
where id = 'benholder';
update public.produkter set tags = array['benclips', 'clips til stoleben', 'højstol', 'højstolsben', 'stoleben', 'passer til IKEA Antilop', 'opbevaring af højstol', '3D-printet', 'dansk design']
where id = 'benclips';

-- jfclabsshop@gmail.com bliver superadmin, når kontoen oprettes som bekræftet (Supabase-dashboardet med Auto Confirm).
-- En almindelig tilmelding er ikke bekræftet ved oprettelsen (mailbekræftelse er slået til), så den bliver aldrig admin.
create function public.giv_admin() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.admins (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke execute on function public.giv_admin() from public, anon, authenticated;

create trigger giv_admin after insert on auth.users
  for each row when (lower(new.email) = 'jfclabsshop@gmail.com' and new.email_confirmed_at is not null)
  execute function public.giv_admin();
