-- Stripe-nøglerne ligger krypteret i Supabase Vault (ejeren indsætter dem selv i SQL-editoren), fordi
-- Edge Functions-secrets ikke kan sættes herfra. Kun service_role (checkout og stripe-webhook) kan læse dem,
-- og kun de to navne.
create function public.stripe_noegle(p_navn text) returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = p_navn and p_navn in ('stripe_secret_key', 'stripe_webhook_secret')
  order by created_at desc limit 1
$$;
revoke execute on function public.stripe_noegle(text) from public, anon, authenticated;
grant execute on function public.stripe_noegle(text) to service_role;

-- Ejeren kører selv (med sine egne nøgler, i SQL-editoren):
--   select vault.create_secret('sk_test_...', 'stripe_secret_key');
--   select vault.create_secret('whsec_...', 'stripe_webhook_secret');
-- Navnet er unikt i Vault. Ny nøgle senere (fx sk_live_): find id'et med
--   select id, name from vault.secrets;
-- og opdatér: select vault.update_secret('<id>', 'sk_live_...');
