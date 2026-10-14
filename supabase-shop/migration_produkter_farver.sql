-- Farver med egne billeder, kort tekst, mål og materiale. Produkterne omdøbes, så "antilop" ikke står i adresserne.
-- farver: [{"navn": "Sort", "hex": "#2b2e30", "billeder": ["billeder/benholder-sort-1.webp", ...]}, ...]
alter table public.produkter add column farver jsonb not null default '[]';
alter table public.produkter add column kort text not null default '';
alter table public.produkter add column maal text not null default '';
alter table public.produkter add column materiale text not null default '';

update public.produkter set
  id = 'benholder',
  kort = 'Bær alle fire ben i én hånd',
  beskrivelse = 'Når højstolen skal med i bilen eller stilles væk, samler benholderen de fire ben ét sted. Benene trykkes ned i holderens to stjerner, og med håndtaget bærer du dem i én hånd.',
  maal = 'Ca. 13 × 9 × 7 cm',
  materiale = 'PLA og PETG, 3D-printet i Danmark',
  billeder = '{}',
  farver = '[{"navn":"Sort","hex":"#2b2e30","billeder":["billeder/benholder-sort-1.webp","billeder/benholder-sort-2.webp","billeder/benholder-sort-3.webp"]},{"navn":"Hvid","hex":"#eef0ee","billeder":["billeder/benholder-hvid-1.webp","billeder/benholder-hvid-2.webp","billeder/benholder-hvid-3.webp"]},{"navn":"Grå","hex":"#8c9397","billeder":["billeder/benholder-graa-1.webp","billeder/benholder-graa-2.webp","billeder/benholder-graa-3.webp"]}]'
where id = 'antilop-benholder';

update public.produkter set
  id = 'benclips',
  kort = 'Hold benene samlet',
  beskrivelse = 'En lille clips, der holder de fire ben samlet, når højstolen er skilt ad. Den fylder næsten ingenting i tasken eller skabet.',
  maal = 'Ca. 5,6 × 5,6 × 1,5 cm',
  materiale = 'PLA og PETG, 3D-printet i Danmark',
  billeder = '{}',
  farver = '[{"navn":"Sort","hex":"#2b2e30","billeder":["billeder/benclips-sort-1.webp","billeder/benclips-sort-2.webp","billeder/benclips-sort-3.webp"]},{"navn":"Hvid","hex":"#eef0ee","billeder":["billeder/benclips-hvid-1.webp","billeder/benclips-hvid-2.webp","billeder/benclips-hvid-3.webp"]},{"navn":"Grå","hex":"#8c9397","billeder":["billeder/benclips-graa-1.webp","billeder/benclips-graa-2.webp","billeder/benclips-graa-3.webp"]}]'
where id = 'antilop-clips';
