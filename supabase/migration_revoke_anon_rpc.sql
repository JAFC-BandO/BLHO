-- Kør i Supabase SQL Editor (tjek "Postgres role" ved Run-knappen staar paa "postgres").
--
-- Baggrund: Postgres giver som standard EXECUTE til PUBLIC paa nye funktioner, og Supabase
-- laegger oveni en eksplicit grant til rollen `anon`. Vores egne `grant execute ... to
-- authenticated` fjerner ingen af delene -- de LAEGGES OVENPAA. Resultatet var at samtlige
-- RPC-funktioner kunne kaldes uden at vaere logget ind, via /rest/v1/rpc/<navn> med den
-- offentlige noegle (som ligger aabent i HTML'en, og skal goere det).
--
-- Verificeret 24. august 2026: et anonymt kald til hent_feedback naaede helt ind i
-- funktionen og blev foerst stoppet af dens EGEN superadmin-kontrol ("Kun superadmin kan se
-- feedback"). Funktionen KOERTE altsaa -- det var kun det interne vaern der reddede den.
--
-- De fleste funktioner har saadan et vaern og er derfor uskadelige for anon:
--   hent_aktivitetslog / hent_feedback / slet_feedback  -> intern superadmin-kontrol
--   mark_password_set / enhed_checkin /
--   enhed_custom_kommando_svar                          -> auth.uid() er NULL -> rammer 0 raekker
--
-- MEN disse to er rene INSERTs uden nogen kontrol overhovedet -- de laeser auth.uid(), men
-- kraever ikke at den findes. En vilkaarlig person paa internettet kunne indsaette raekker i
-- admin_log og feedback i det uendelige (ingen laeseadgang, men en aaben skrive-kanal og en
-- oplagt spam-/lagervaekst-vej).

revoke execute on function public.log_admin_handling(text, text) from public, anon;
revoke execute on function public.indsend_feedback(text, text, text, text, text) from public, anon;

-- SIKKERT for almindelige brugere: begge funktioner har i forvejen deres EGEN eksplicitte
-- grant til `authenticated` (bekraeftet i pg_proc.proacl foer aendringen:
-- "authenticated=X/postgres"), saa indloggede admins mister ingenting. Kun PUBLIC og anon
-- fjernes. service_role er ligeledes uroert.

-- ---------- Verifikation (koer efter) ----------
-- Forventet: `anon=` er VAEK, `authenticated=X/postgres` staar der stadig.
--
-- select p.proname, array_to_string(p.proacl, E'\n') as rettigheder
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('log_admin_handling','indsend_feedback');

-- ---------- Rul tilbage (hvis noget mod forventning braekker) ----------
-- grant execute on function public.log_admin_handling(text, text) to public, anon;
-- grant execute on function public.indsend_feedback(text, text, text, text, text) to public, anon;
