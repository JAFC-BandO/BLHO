# Design

Afledt af boerneloppen.dk (den aktuelle palet) med designguiden `media/boerneloppen-designguide.pdf` som baggrund. Sitet vinder over guiden, hvor de afviger (guidens pink-primær er den gamle palet).

## Font
System-stack (-apple-system, Segoe UI, Roboto). Poppins blev proevet 12/10-2026 og fravalgt: den er bredere og blev oplevet som traels i daglig brug.

## Farver (lys)
| Rolle | Værdi |
|---|---|
| Primær knap, aktive faner, markering, fokus | #33a3dc (Blue, som CTA-knapper paa boerneloppen.dk) |
| Overskrifter, links, brødtekst | #143546 (Night, sitets tekstfarve) |
| Brand-tonede flader (badges, chips) | #d6edf8, #e9f5fb, #f3f9fd; kant #a8d8f0 |
| Succes | #277339 (Forest) på #e7fcdf (Light green) |
| Sidebaggrund / kort / kant | #f3f8fc / #ffffff / #d9e4ec |
| Sekundær / pink | #e91e63 (kun miljøeffekt-kort og AI-gradient) |
| Dæmpet tekst | #6c6577 |
| Mørk flade med hvid tekst (logo-panel, mailhoved, bannere) | #143546 (Night, som sitets header/footer) |

Tilstande: hover på primære knapper #2a8fc4 (lys) / #4db3e5 (mørk, et trin lysere, fordi lysere læses som aktivt på mørk bund); hover på stille blå flader (#d6edf8 / #1b3344) er #bfe2f4 / #24435a; tastaturfokus 2 px #33a3dc. Faste farver, ingen brightness-filtre eller gennemsigtige lag.

## Farver (mørk)
En mørk udgave af den lyse, ikke Night-tonet: side #15161b, kort #1e2029, flader #2a2c37/#262833/#30323d, kanter #3a3d4a/#4a4d5a, tekst #e8e8ee, dæmpet #9a9cab. Knapper forbliver #33a3dc; brand-tekst lysnes til #7fc7ea. Blå-tonede flader: #1b3344/#182c3b, kant #2a5570. Logo-panelet er Night i begge temaer i appen. I rapportmailens mørke variant står logoet og knappen på brand-blå #33a3dc (kort #1e2029 på side #15161b), så det hvide logo ikke drukner i Night på en mørk mailbaggrund.

## Form
- CTA- og primærknapper er piller (`border-radius: 999px`), også i rapportmailen.
- Negativt (hvidt) logo på Night-flade på login og i mailens hoved, som sitets header. Positivt logo på hvid baggrund ellers.
- Butiksskærmen beholder sort ramme; accent er blå, miljøeffekt-kortet pink.
- Vagtplanens vagt-typer (L/S/U/F) beholder egne funktionsfarver; de er kategorier, ikke brand.

## Kendt afvigelse
Hvid tekst på #33a3dc giver 2,8:1. Det er sitets egen CTA-farve, så den er bevaret; brug den kun til knapper med 600+ vægt, aldrig til løbende tekst. Grøn #71cc4c fra sitet bruges ikke til tekst af samme grund.
