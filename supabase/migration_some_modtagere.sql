-- Rapportmodtagere med eget login (29/10-2026) -- koer i Supabase SQL Editor ("Postgres role" = postgres).
-- Kan koeres igen uden skade.

-- Johanna og JC maa skrive og sende rapporter (kan_styre; superadmin-flaget alene giver det ikke)
insert into public.some_adgang (bruger_id, kan_styre)
select id, true from auth.users where lower(email) in ('johanna@boerneloppen.dk', 'jc@boerneloppen.dk')
on conflict (bruger_id) do update set kan_styre = true;

-- Til some-mail: hvilke af modtagerne har endnu ikke valgt egen adgangskode (skal_saette_password).
-- Kun dem faar startkoden skrevet i mailen -- har man skiftet den, staar den ikke i mailen mere.
create or replace function public.some_mail_ny_login(p_modtagere text[])
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(lower(u.email)), '{}')
  from auth.users u join public.brugere b on b.id = u.id
  where lower(u.email) = any (select lower(x) from unnest(p_modtagere) x) and b.skal_saette_password;
$$;
revoke execute on function public.some_mail_ny_login(text[]) from public, anon, authenticated;
grant execute on function public.some_mail_ny_login(text[]) to service_role;
