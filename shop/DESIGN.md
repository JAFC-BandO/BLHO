---
name: JFC Labs shop
description: Lille, moderne webshop for 3D-printet højstolstilbehør, lavet i Danmark.
colors:
  side: "#ffffff"
  flade: "#f2f4f1"
  blaek: "#17201f"
  grafit: "#55605d"
  linje: "#e3e7e3"
  kant: "#7f8d87"
  accent: "#2e7d6b"
  accent-moerk: "#23624f"
  slukket: "#b4bfba"
  markering: "#cde4da"
  fejl: "#a3271f"
typography:
  display:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5.5vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  lead:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "clamp(1.0625rem, 1.6vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  chip: "4px"
  lille: "8px"
  stor: "12px"
  pille: "999px"
spacing:
  kant-x: "clamp(1rem, 4vw, 2rem)"
  bredde: "72rem"
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1.25rem"
  lg: "2rem"
  sektion: "clamp(3rem, 8vw, 5.5rem)"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.side}"
    rounded: "{rounded.pille}"
    padding: "0.75rem 1.5rem"
    height: "3rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-moerk}"
  button-primary-disabled:
    backgroundColor: "{colors.slukket}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.blaek}"
    rounded: "{rounded.pille}"
    padding: "0.75rem 1.5rem"
    height: "3rem"
  button-secondary-hover:
    backgroundColor: "{colors.blaek}"
    textColor: "{colors.side}"
  stepper:
    backgroundColor: "{colors.side}"
    textColor: "{colors.blaek}"
    rounded: "{rounded.pille}"
    height: "2.75rem"
  cart-badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.side}"
    rounded: "{rounded.pille}"
    height: "1.25rem"
  announcement:
    backgroundColor: "{colors.blaek}"
    textColor: "{colors.side}"
    typography: "{typography.label}"
    padding: "0.5rem"
  product-frame:
    backgroundColor: "{colors.flade}"
    rounded: "{rounded.stor}"
  thumbnail:
    backgroundColor: "{colors.flade}"
    rounded: "{rounded.lille}"
    size: "4.5rem"
  input:
    backgroundColor: "{colors.side}"
    textColor: "{colors.blaek}"
    rounded: "{rounded.lille}"
    padding: "0.625rem 0.75rem"
  summary-panel:
    backgroundColor: "{colors.flade}"
    rounded: "{rounded.stor}"
    padding: "1.5rem"
  payment-chip:
    backgroundColor: "{colors.side}"
    textColor: "{colors.blaek}"
    rounded: "{rounded.chip}"
    padding: "0.125rem 0.5rem"
---

Gælder kun jfclabs.dk/shop. DESIGN.md i repo-roden hører til Børneloppen og gælder ikke her.

# Design System: JFC Labs shop

## Overview

**Creative North Star: "Det lille, ordentlige værksted"**

Shoppen spiller den moderne Shopify-kanon lige ud: hvid side, produkterne på lyse grågrønne flader, én grøn handlingsfarve, pilleformede knapper og tynde linjer. Det er et bevidst valg af standarden, så en forælder genkender en rigtig butik med det samme og stoler på den. Personligheden ligger i ordene (Jacob, Danmark, 3D-print) og i de rene renders af produktet, ikke i pynt.

Tætheden er rolig: store sektioner med god luft, én kolonne indhold på tekstsider, to kolonner på forside, produktside og kurv, der falder til én kolonne på tablet og telefon. Der er ét lyst tema og ingen mørk tilstand, fordi produktbillederne er renderet direkte på billedfladens farve og skal smelte sammen med den.

Billederne er 3D-gengivelser (three.js) af JFC Labs' egne STL-filer, renderet på billedfladen (#f2f4f1) med en blød kontaktskygge, så produkt og flade er ét. Hvert billede har en `.json`-fil ved siden af med oprindelsen, og handelsbetingelserne oplyser, at billederne er 3D-gengivelser.

**Key Characteristics:**
- Hvid side, grågrønne billedflader og paneler, sort-grøn tekst.
- Én handlingsfarve (grøn) til knapper, kurvantal, fokus og tillidsikoner.
- Schibsted Grotesk i alle størrelser, selvhostet; tunge (800), stramme overskrifter.
- Piller til alt, man trykker på; 12 px hjørner på billeder og paneler, 8 px på miniaturer og felter.
- Flad: dybde kommer fra flader og 1 px linjer, ikke skygger.

## Colors

En næsten neutral, let grønlig palet med ét grønt handlingstræk.

### Primary
- **Værkstedsgrøn** (accent): primærknapper, kurvens antal-badge, fokusring, ikonerne i tillidslinjen og fordelelisten. Hvid tekst ovenpå.
- **Dyb værkstedsgrøn** (accent-moerk): hover på primærknappen.

### Neutral
- **Papirhvid** (side): sidebaggrund, header, felter, antalsvælger, betalingsmærker.
- **Grågrøn flade** (flade): baggrund bag alle produktbilleder (samme farve som renderbaggrunden), rolige sektioner, footer, kurvoversigt, tak-boks, faktabokse, trin-cirkler, hover på antalsknapper.
- **Sort-grøn blæk** (blaek): al brødtekst og overskrifter, annoncelinjen, sekundærknappens kant og hover-fyld, valgt farveprøve og valgt miniature.
- **Grafit** (grafit): sekundær tekst: underrubrikker, beskrivelser, brødkrumme, datoer, "inkl. moms", footer-tekst.
- **Hårlinje** (linje): 1 px skillelinjer: under header, om tillidslinjen, mellem accordion-rækker og kurvlinjer, i oversigtens total.
- **Kontrastkant** (kant): kant på alt, der skal kunne ses som en kontrol: felter, antalsvælger, farveprøver, betalingsmærker. Mindst 3:1 mod hvidt.
- **Slukket** (slukket): deaktiveret knap og deaktiveret minus/plus.
- **Markering** (markering): tekstmarkering.

### Feedback
- **Fejlrød** (fejl): fejltekst (fx login og betaling). Kun tekst, aldrig flader.

### Named Rules
**The One Green Rule.** Grøn betyder "her handler du" (eller bekræfter tillid i et ikon). Den bruges aldrig til overskrifter, baggrundsflader eller dekoration.

**The Same Surface Rule.** Alt, der bærer et produktbillede, har flade-farven bag sig, fordi renderne er lavet på præcis den farve. Skift aldrig billedfladens farve uden at rendere billederne om.

**The Kontrolkant Rule.** Linjefarven er til skel; kantfarven er til kontroller. En kontrol med kun hårlinje-kant består ikke 3:1.

## Typography

**Display Font:** Schibsted Grotesk (med system-ui, sans-serif)
**Body Font:** Schibsted Grotesk (samme fil, variabel vægt 400-900)

**Character:** Én grotesk i alle størrelser. Overskrifterne er tunge og tæt spærrede, brødteksten er åben (1.6), så siden føles moderne og sikker uden at råbe.

Skriften ligger selv på `/shop/fonts/` og preloades; Google Fonts bruges ikke, så besøgendes IP ikke sendes videre.

### Hierarchy
- **Display** (800, clamp 2.5-4.25rem, 1.02, -0.04em): kun forsidens hovedoverskrift.
- **Headline** (800, clamp 1.75-2.5rem, 1.1, -0.03em): sektionsoverskrifter. Varianter i samme familie: tekstsidernes h1 (clamp 2.25-3.25rem, -0.035em), produktnavn (clamp 1.875-2.5rem), kurvens h1 (clamp 2-2.75rem).
- **Title** (600-700, 1.0625-1.375rem): produktkortets navn (1.125rem/600), trin (1.125rem/700), accordion-spørgsmål (1.0625rem/600), tekstsidernes h2 (1.375rem/700), pris på produktsiden (1.375rem/600).
- **Body** (400, 1rem, 1.6): al løbende tekst. Tekstsider maks. 44rem, accordion-svar maks. 40rem.
- **Lead** (400, clamp 1.0625-1.25rem, grafit): forsidens indledning og tekstsidernes indledning (1.1875rem).
- **Label** (400-600, 0.875-0.9375rem): annoncelinje, brødkrumme, tillidspunkter (500), footer, "fjern", små noter. Badge og betalingsmærker 0.75rem i 700/600.

### Named Rules
**The No Eyebrow Rule.** Overskrifter står alene. Ingen små overlinjer, kategorier i versaler eller spærrede etiketter over dem; ingen tekst sat med versaler som stil (varemærker staves som ejeren skriver dem).

**The Tabular Count Rule.** Tal, der ændrer sig på stedet (antal i vælgeren), bruger tabular-nums, så knapperne ikke hopper.

## Layout

- **Container:** maks. 72rem, centreret, sidemargin clamp(1rem, 4vw, 2rem).
- **Sektionsrytme:** clamp(3rem, 8vw, 5.5rem) lodret; rolige sektioner skifter til flade-baggrund, ellers skilles de med en hårlinje.
- **Forside:** hero i to kolonner (5fr tekst / 7fr billede), tillidslinje i fire kolonner lige under, produktgitter i to kolonner, "sådan virker det" og "om" i to lige kolonner.
- **Produktside:** galleri 7fr / købspanel 5fr; købspanelet er klæbende (top 6rem) på desktop. "Du kan også bruge" i et auto-fill-gitter (min. 18rem).
- **Kurv:** linjer + oversigt på 22rem, oversigten klæbende på desktop.
- **Tekstsider:** én kolonne, maks. 44rem.
- **Header:** klæbende, min. 4.25rem høj; ankre lander 5.5rem under toppen.
- **Breakpoints:** ved 56rem bliver alle to-kolonne-layouts til én kolonne (billede under tekst i hero), klæbende paneler bliver statiske, tillidslinjen og footeren går til to kolonner. Ved 40rem bliver produktgitter, tillidslinje og footer til én kolonne, menuens afstand strammes, og kurvlinjer stables (billede 5rem, antal og pris under navnet).
- **Mellemrum:** gentagne trin er 0.5 / 0.75 / 1.25 / 2rem; gitre bruger 1-2rem mellemrum.

## Elevation & Depth

Systemet er fladt. Dybde vises med flade-farven mod hvidt og med 1 px linjer. De eneste skygger er indvendige 1 px ringe (farveprøver, valgt miniature) og ringen om den valgte farveprøve; de er kanter, ikke løft. Produktrenderne har deres egen bløde kontaktskygge i billedet.

### Shadow Vocabulary
- **Prøvekant** (`box-shadow: inset 0 0 0 1px var(--kant)`): omkreds på farveprøver, så hvid kan ses på hvidt.
- **Valgt prøve** (`box-shadow: inset 0 0 0 1px var(--kant), 0 0 0 2px var(--side), 0 0 0 4px var(--blaek)`): valgt farve, en blæk-ring med hvid luft.

### Named Rules
**The Flat Floor Rule.** Ingen kort, paneler eller knapper har slagskygge. Vil noget skille sig ud, får det flade-farve eller en hårlinje.

## Shapes

Tre radier og pillen. Alt, man trykker på (knapper, antalsvælger, kurvknap, badge), er pilleformet; farveprøver og trin-tal er cirkler. Billeder og paneler har 12 px, miniaturer, kurvbilleder, felter og "spring til indhold" har 8 px. Betalingsmærkerne er de eneste med 4 px, så de læses som små neutrale mærkater og ikke som knapper. Billeder klippes altid af deres ramme (overflow hidden, object-fit cover) og er kvadratiske i kort og galleri.

## Components

### Header og annoncelinje
- **Annoncelinje:** tynd sort stribe (blæk, hvid tekst, 0.875rem, centreret) med én faktuel linje om afsendelse.
- **Header:** klæbende, hvid, hårlinje i bunden. Ordmærket "JFC Labs" (800, 1.25rem) til venstre, menu (500, understreget ved hover og aktuel side) midt-højre, kurvknap til højre.
- **Kurvknap:** 2.75rem cirkulært trykfelt med et tegnet kurv-ikon (24 px, 1.75 streg); grønt pille-badge med antallet i øverste hjørne, skjult når kurven er tom.

### Buttons
- **Shape:** pille (999px), min. 3rem høj, padding 0.75rem 1.5rem, 600.
- **Primær:** grøn med hvid tekst; hover dyb grøn; deaktiveret slukket grå.
- **Sekundær:** gennemsigtig med 1 px blæk-kant; hover fyldes med blæk og tekst bliver hvid.
- **Fuld bredde** og "fyld rækken" (ved siden af antalsvælgeren) er varianter af samme knap.
- **Fokus:** global 3 px grøn ring med 2 px afstand på alt fokuserbart.
- **Tekstknap "Fjern":** grafit, understreget, 0.875rem, uden flade.

### Antalsvælger
Pille med 1 px kontrastkant på hvidt; minus og plus er tegnede streger (14 px, 2 px) i 2.75rem cirkulære felter, hover flade-farve (kun på enheder med hover), deaktiveret i slukket grå. Tallet i midten er 600 og tabular.

### Farveprøver
Runde prøver (2rem synlig cirkel i et 2.75rem trykfelt) i produktets egen farve fra databasen, altid med 1 px kontrastkant. Valgt: blæk-ring med hvid luft. Tastaturfokus: grøn ring 5 px uden for prøven. Radioknapperne er visuelt skjulte; navnet læses op. På produktkortet vises de samme farver som små prikker (0.875rem).

### Produktkort
Hele kortet er ét link. Kvadratisk ramme på flade med 12 px hjørner; første farves billede 1 vises, og billede 2 toner ind (0.35s ease-out) ved hover på enheder med hover. Under: navn (title), kort beskrivelse i grafit, og en bundrække med pris (600) til venstre og farveprikker til højre. Navnet understreges ved hover.

### Tillidslinje
Fire korte faktapunkter mellem to hårlinjer lige under hero, hvert med et tegnet grønt ikon (20 px, 1.75 streg) og 500-tekst. Samme mønster (fordeleliste) går igen i købspanelet.

### Accordion (spørgsmål og svar)
Native `details` mellem hårlinjer, maks. 48rem. Spørgsmålet er 600/1.0625rem med et tegnet plus til højre, der drejer 45 grader til et kryds, når det åbnes (0.25s). Svaret i grafit, maks. 40rem.

### Galleri
Kvadratisk hovedbillede på flade med 12 px hjørner; under det en række 4.5rem miniaturer med 8 px hjørner. Valgt miniature får en 2 px blæk-kant (kant + indvendig ring), styret af `aria-pressed`.

### Kurvlinjer og oversigt
- **Linje:** 6rem billede (8 px, flade) / navn som link + stykpris i grafit / antalsvælger med "Fjern" under / linjepris højrestillet (600). Hårlinjer mellem linjer. På telefon stables antal og pris under navnet.
- **Oversigt:** flade-panel, 12 px, padding 1.5rem; definitionsliste med subtotal og fragt, total adskilt af hårlinje i 700/1.125rem; primærknap i fuld bredde. Klæbende på desktop.
- **Login-felt:** 8 px hjørner, 1 px kontrastkant, hvid, grøn markør; label over feltet i 600.
- **Tom kurv og tak-boks:** tom kurv er tekst + knap; tak efter køb er et flade-panel med 12 px hjørner.

### Betalingsmærker
Visa, Mastercard, MobilePay og Apple Pay som små neutrale navnemærker: hvid, 1 px kontrastkant, 4 px hjørner, 0.75rem/600 blæk-tekst. Ingen logoer og ingen mærkefarver.

### Footer
Flade-baggrund, fire kolonner (ordmærke + én sætning / Shop / Information / Kontakt), kolonneoverskrifter 0.9375rem/700. Bundlinjen over en hårlinje: betalingsmærker med "Betalingen håndteres sikkert af Stripe", varemærke-ansvarsfraskrivelsen for IKEA/ANTILOP og copyright, i grafit 0.875rem.

### Tekstsider
Én kolonne på 44rem, indledning i lead-størrelse, h2 med 2.75rem luft over, faktabokse på flade med 12 px hjørner, indholdsfortegnelse i to spalter (én på telefon).

## Do's and Don'ts

### Do:
- **Do** læg hvert produktbillede på flade-farven (#f2f4f1) og rendér nye billeder på præcis den baggrund med blød kontaktskygge.
- **Do** gem oprindelsen ved siden af hvert billede (`<navn>.webp.json`) og hold oplysningen om 3D-gengivelser i handelsbetingelserne, så længe billederne er renders.
- **Do** brug pillen til alt, man trykker på, og kontrastkanten på alt, der skal kunne ses som en kontrol.
- **Do** tegn ikoner som inline-SVG i én stregtykkelse (1.75 ved 20-24 px, 2 ved 14-16 px) med `currentColor`.
- **Do** vis betalingsmåder som neutrale navnemærker.
- **Do** gate hover-effekter, der skjuler eller viser indhold, bag `(hover: hover)`, og slå overgange fra ved `prefers-reduced-motion`.

### Don't:
- **Don't** tilføj et mørkt tema; renderne er bagt ind i den lyse flade.
- **Don't** brug den grønne farve til flader, overskrifter eller pynt.
- **Don't** sæt slagskygger på kort, paneler eller knapper.
- **Don't** efterlign betalings- eller varemærkers logoer eller farver.
- **Don't** sæt overlinjer, versal-etiketter eller emoji/tegn-ikoner over eller i overskrifter.
- **Don't** hent skrifter fra Google Fonts eller andre tredjeparter.
