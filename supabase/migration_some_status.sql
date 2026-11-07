-- Ugentlig status paa rapportmailen (6/11-2026) -- koer i Supabase SQL Editor ("Postgres role" = postgres).
-- Kan koeres igen uden skade.
--
-- Hver mandag kl. 07 UTC kalder cron-jobbet edge-funktionen some-mail-status, som mailer dem, der maa
-- skrive rapporter (kan_styre i some_adgang), en oversigt over hvem der har aabnet de rapportmails, der
-- er sendt de sidste 4 uger. Er der ingen, sendes intet; sendes nye rapporter, begynder det forfra.
-- Tallene er dem, some_mail_log allerede samler -- der gemmes ikke noget nyt om modtagerne.

-- Alt funktionen skal bruge: Resend-noegle, cron-noegle, hvem der skal have mailen og de seneste
-- sendte rapportmails. 29 dage, saa en rapport, der blev sendt en mandag, faar sin 4. status paa dag 28.
create or replace function public.some_status_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'noegle', (select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key'),
    'cron', (select decrypted_secret from vault.decrypted_secrets where name = 'some_cron_noegle'),
    'til', coalesce((select jsonb_agg(lower(u.email) order by u.email)
      from public.some_adgang a join auth.users u on u.id = a.bruger_id where a.kan_styre), '[]'::jsonb),
    'raekker', coalesce((select jsonb_agg(jsonb_build_object('butik', b.navn, 'modtager', l.modtager, 'fra', l.fra, 'til', l.til,
        'sendt_at', l.sendt_at, 'aabnet_foerst', l.aabnet_foerst, 'aabnet_sidst', l.aabnet_sidst, 'aabninger', l.aabninger)
        order by b.navn, l.sendt_at, l.modtager)
      from public.some_mail_log l join public.butikker b on b.id = l.butik_id
      where l.sendt_at > now() - interval '29 days'), '[]'::jsonb));
$$;
revoke execute on function public.some_status_data() from public, anon, authenticated;
grant execute on function public.some_status_data() to service_role;

select cron.unschedule('some-status-ugentlig') where exists (select 1 from cron.job where jobname = 'some-status-ugentlig');
select cron.schedule('some-status-ugentlig', '0 7 * * 1', $cron$
  select net.http_post(
    url := 'https://irijatnmgvutrqngwpaa.supabase.co/functions/v1/some-mail-status',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-some-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'some_cron_noegle')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$cron$);
