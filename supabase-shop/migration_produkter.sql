-- Shoppens produkter (Supabase-projekt swmugtukacirgopjstdx, ikke Børneloppens).
-- Rettes i Supabase-dashboardet (Table Editor -> produkter); siden kan kun læse aktive rækker.

create table public.produkter (
  id text primary key,                              -- kort navn, fx 'antilop-benholder'
  navn text not null,
  beskrivelse text not null default '',
  pris_oere integer not null check (pris_oere > 0), -- 14900 = 149,00 kr
  billede text,                                     -- sti i shop/, fx 'billeder/benholder.webp'
  aktiv boolean not null default true,
  sortering integer not null default 0
);

alter table public.produkter enable row level security;

-- Siden må kun læse aktive produkter; ingen må skrive udefra
create policy "alle kan se aktive produkter" on public.produkter
  for select to anon, authenticated using (aktiv);

revoke all on public.produkter from anon, authenticated;
grant select on public.produkter to anon, authenticated;

insert into public.produkter (id, navn, beskrivelse, pris_oere, billede, sortering) values
  ('antilop-benholder', 'Benholder med håndtag', 'Samler de fire ben fra Antilop-højstolen, når de er taget af, så de kan bæres i én hånd eller stilles væk. Ca. 13 × 9 × 7 cm.', 14900, 'billeder/benholder.webp', 1),
  ('antilop-clips', 'Benclips', 'Holder de fire ben fra Antilop-højstolen samlet, når de er taget af. Lille og uden håndtag. Ca. 5,6 cm i diameter.', 4900, 'billeder/clips.webp', 2);
