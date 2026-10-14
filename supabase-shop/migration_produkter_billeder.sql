-- Flere billeder pr. produkt (første er hovedbilledet). Erstatter kolonnen billede.
alter table public.produkter add column billeder text[] not null default '{}';

update public.produkter set
  billeder = '{billeder/benholder-1.webp,billeder/benholder-2.webp,billeder/benholder-3.webp}',
  beskrivelse = 'Samler stolens fire ben, når højstolen er skilt ad, så de kan bæres i én hånd eller stilles væk. Ca. 13 × 9 × 7 cm.'
where id = 'antilop-benholder';

update public.produkter set
  billeder = '{billeder/clips-1.webp,billeder/clips-2.webp,billeder/clips-3.webp}',
  beskrivelse = 'Holder stolens fire ben samlet, når højstolen er skilt ad. Lille og uden håndtag. Ca. 5,6 × 5,6 × 1,5 cm.'
where id = 'antilop-clips';

-- Køres, når siden med billeder er live
alter table public.produkter drop column billede;
