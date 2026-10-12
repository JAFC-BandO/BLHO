# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Butiksejer** (primær). Ejer/leder af én Børneloppen-butik. Redigerer butikkens skærmindhold i `BL/butik-redigering`, lægger vagtplan og læser SoMe-rapporten. Ikke teknisk, arbejder på telefon eller butiks-pc mellem kunder.
- **Butiksansatte.** Får SoMe-rapportens link i mailen og læser den; bruger vagtplanen. Redigerer sjældent.
- **Superadmin** (Jacob). Bygger og driver systemet: fælles skabelon, enheder/fjernsupport, aktivitetslog, feedback. Redigerer også skærmindhold på vegne af butikker og tjekker rapporten.
- **Kunder i butikken** ser kun resultatet: skærmindholdet på boksene (`BL/skaerm.html`). De er publikum, ikke brugere af UI'et.

## Product Purpose

BLHO er Børneloppen-kædens eget værktøjssæt til butiksdrift: digital skiltning på skærme i butikkerne, vagtplan for butikkens medarbejdere og en SoMe-performance-rapport (erstatter Hootsuite). Det findes for at spare kæden for licenser og for at give ikke-tekniske butiksfolk noget, de ikke kan ødelægge. Succes = en butik kan selv holde skærm, vagtplan og SoMe-overblik kørende uden support, og en ny butik kan tilføjes uden ny kode.

## Positioning

- **Nul licens, egen drift.** Statisk HTML på GitHub Pages (jfclabs.dk) + Supabase. Ingen Fully Kiosk, Hootsuite, Planday eller lign. Formålet er at spare penge.
- **Ét system til alle butikker.** Samme kode til alle 16 butikker; ny butik = nye rækker i databasen, aldrig ny deploy. Adskillelse sker via login + RLS.
- **Enkelhed for ikke-tekniske ansatte.** Almindelig admin kan kun vælge billede, video eller diasshow i to faste vinduer; rammen (logo, ur, vejr, nyheder) er låst og fælles.

Fremtidigt arbejde må ikke give køb på nogen af de tre.

## Operating Context

- **Flader:** `BL/skaerm.html` (skærmboks, kører 24/7 i Chrome-fuldskærm), `BL/butik-redigering/` (admin + superadmin, drag-and-drop canvas med "Live nu på skærmen"), `BL/vagtplan/` (vagtplan med AI-assistent), `BL/some/` (SoMe-rapport, også sendt som mail med personlige links der virker en måned).
- **Hardware:** billige Android-signage-bokse (MINIX X35-i Plus, Android 11, Chrome ≥ 80, ingen Play Services) og Windows x86-bokse (Flytech/BOXTEC). Bokse melder ind via check-in og fjernstyres over Tailscale/SSH. Se `ANDROID-KIOSK-SETUP.md` og `WINDOWS-KIOSK-SETUP.md`.
- **Backend:** Supabase (Auth, RLS, Realtime, Edge Functions: some-sync, some-mail, some-udkast, vagtplan-ai, invite-user). Log-kvote 1 GB/md, derfor serverstyret check-in-interval og ingen hyppig polling. Se `SUPABASE.md`.
- **Deploy:** push til `main` → GitHub Pages. Cache brydes med `?v=` på iframes/scripts.
- **Roller:** `admin` (butik), `skaerm` (enhed), superadmin-flag. Se `REDIGERINGS-UI-GUIDE.md`.

## Capabilities and Constraints

- Multi-tenant via `butik_id`; sikkerhed håndhæves udelukkende af RLS, aldrig af UI.
- Admin må kun bruge billede/video/diasshow i faste pladser; alt andet er `superadmin-only`.
- Skærm-klienten logger ind med URL-credentials og må ikke kræve interaktion.
- Må køre på Chrome 80 på svag ARM-hardware: ingen tunge biblioteker, ingen build-step (ren HTML/CSS/JS, system-font-stack i dag).
- Al tekst er dansk. Ingen i18n.
- Terminologi: butik, skærm, side (kladde), live (rød prik), diasshow, fast plads, fælles skabelon, enheder, vagtplan, SoMe-rapport.
- Åbent: om SoMe-rapportens mail-udgave og web-udgave skal følge designguiden fuldt ud eller kun i logo/farver (ikke besluttet).

## Brand Commitments

- **boerneloppen.dk er den gældende palet**: Night #143546 (header, footer, tekst), Blue #33a3dc (CTA), Green #71cc4c (links), Pink #e91e63 (sekundær), Light blue #d6edf8, Poppins. Designguiden nedenfor er ældre (pink som primær) og bruges kun, hvor sitet ikke svarer.
- **Børneloppens designguide** er referencen for logo-regler, tone of voice og font. Kilde: `media/boerneloppen-designguide.pdf` (kopi af den udleverede PDF, gitignored; udviklet af &PARTNER). Nøglepunkter, som fremtidigt arbejde skal slå op dér og ikke udvide frit:
  - Design key words: farverigt univers, legende elementer, roligt men livligt, glad og positiv.
  - Tone of voice: uformel, humoristisk, selvironisk, ansvarlig.
  - Font: Poppins (Regular, Semibold, Extrabold). Overskrift Extrabold, under-overskrift/brødtekst Regular. Tekst i grafiske elementer centreres.
  - Palette (web): Blue #69ade0, Pink #ed0677, White #ffffff, Black #000000; sekundær Green #50d01e, Forest #277339, Night #143546; lyse flader Light pink #f5dee6, Light blue #d7ebf5, Light green #e7fcdf. Tekst er udelukkende pink og sort på hvid baggrund (eller hvid tekst på farvet).
  - Logo: positivt logo som hovedregel, negativt (hvidt) på farvede baggrunde; respektafstand omkring "loppen"; kun de anviste farvekombinationer.
  - Lopperne (maskotter) i vektor med egne farver; fotostil: lyse omgivelser, ro, overskuelighed, ægte smil.
  - Digital: CTA-knapper er altid runde; korte budskaber.
- **Logo-filer:** `BL/logo-boerneloppen.svg`, `BL/logo-boerneloppen-mail.png`, `media/ny-bl_logo_rgb_payoff_white_new-poppins-vector.svg` (negativt logo med payoff).
- Eksisterende flader bruger i dag system-font-stack og egne farver; det er gæld i forhold til guiden, ikke et valg.

## Evidence on Hand

- Live data fra 16 butikker i Supabase (skærmindhold, vagtplaner, SoMe-tal synkroniseret fra Meta).
- Rå Hootsuite-udtræk og kampagnegrafik i `media/` (gitignored).
- Ingen testimonials, cases eller tal om besparelse foreligger; opfind dem ikke.

## Product Principles

1. **Butiksejeren skal kunne det selv.** Hvis en funktion kræver forklaring eller support, er den forkert.
2. **Svært at ødelægge.** Rammen er låst; kun det, en butik må ændre, kan ændres.
3. **Ét system, ingen undtagelser pr. butik.** Forskelle ligger i data, aldrig i kode.
4. **Kør på det billigste.** Gammel Chrome, svag ARM, 1 GB log-kvote og nul licens sætter loftet.
5. **Følg designguiden, ikke egen smag.** Børneloppen ejer identiteten; BLHO udtrykker den.

## Accessibility & Inclusion

- Skærme læses af kunder på afstand i butik: stor, kontrastrig tekst.
- Admin-flader bruges ofte på telefon i butikken med én hånd; alt skal kunne betjenes med fingeren, og tabeller skal kunne rulles sidelæns.
