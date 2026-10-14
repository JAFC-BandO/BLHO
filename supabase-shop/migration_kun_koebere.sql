-- Lukket test: står der mails her, må kun de købe (checkout-funktionen tjekker). Tom tabel = shoppen er åben.
-- Mails lægges ind i Supabase-dashboardet (Table Editor -> kun_koebere), ikke her: repoet er offentligt.
create table public.kun_koebere (mail text primary key check (mail = lower(mail)));
alter table public.kun_koebere enable row level security;
-- Ingen policies og ingen rettigheder: kun service_role (checkout-funktionen) kan læse den
revoke all on public.kun_koebere from anon, authenticated;
