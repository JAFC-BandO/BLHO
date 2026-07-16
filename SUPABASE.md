# Supabase-opsætning — Børneloppen butik-skærme

Dette dokument beskriver hvordan backend'en (Supabase) er sat op, så du (eller en AI) hurtigt kan sætte sig ind i det uden at skulle klikke rundt i dashboardet.

## Projekt

- Project URL: `https://irijatnmgvutrqngwpaa.supabase.co`
- Publishable/anon key: `sb_publishable_taPyJFcINrPL5JiB-ay4CQ_iscnTyy3` (må gerne ligge i frontend-kode, er ikke hemmelig — sikkerheden ligger i RLS + Auth, ikke i at skjule denne nøgle)
- Secret/service_role key: findes i Supabase Dashboard → Settings → API Keys. **Må ALDRIG** ligge i kode, git eller frontend. Bruges ikke af noget i dette projekt i dag.

## Formål / arkitektur

To slags klienter taler med samme Supabase-projekt:
1. **Admin-brugere** (butikkernes ansatte) — logger ind på `butik-redigering.html` for at redigere deres eget skilt/skærm-indhold.
2. **Skærm-klienter** (Raspberry Pi'er) — logger ind med en dedikeret, ikke-menneskelig konto pr. butik på `skaerm.html` for at hente og vise indhold, uden nogen UI-login.

Begge typer er almindelige Supabase Auth-brugere (`auth.users`), adskilt via en `rolle`-kolonne i `brugere`-tabellen. Sikkerheden håndhæves udelukkende af **Row Level Security (RLS)** i databasen — ikke af hvad frontend-koden "tillader" i UI'et, og ikke af at gemme nøgler væk (de kan ikke gemmes væk, koden kører jo i brugerens/Pi'ens browser).

## Tabeller

### `butikker`
| Kolonne | Type | Beskrivelse |
|---|---|---|
| id | uuid | PK |
| navn | text | Fx "Butik Horsens" |
| slug | text | Fx "horsens" — bruges kun til menneskelig genkendelse, ikke til adgangskontrol |
| created_at | timestamptz | |

Kendt række: **Butik Horsens** = `675b2292-00c6-4da8-b76d-c24e23a2b63c`, slug `horsens`.

### `brugere`
Kobler en `auth.users`-konto til en butik og en rolle.

| Kolonne | Type | Beskrivelse |
|---|---|---|
| id | uuid | PK, **samme værdi som `auth.users.id`** |
| butik_id | uuid | FK til `butikker.id` |
| rolle | text | `'admin'` (menneske, kan redigere) eller `'skaerm'` (Pi, kun læse) — default `'admin'` |

### `content`
Selve indholdet der vises på skærmen. Én butik kan i praksis have flere rækker over tid; koden henter altid den seneste (`order by opdateret_at desc limit 1`).

| Kolonne | Type | Beskrivelse |
|---|---|---|
| id | uuid | PK |
| butik_id | uuid | FK til `butikker.id` |
| titel | text | Legacy simpelt felt (bruges hvis `layout` er tom) |
| tekst | text | Legacy simpelt felt |
| billede_url | text | Legacy enkelt-billede felt |
| layout | jsonb | **Ny**: fritlagt canvas-layout, se format nedenfor |
| opdateret_at | timestamptz | |

**`layout`-format** (array af positionerede elementer, procent-baserede koordinater så det skalerer til enhver skærmstørrelse):
```json
{
  "elements": [
    { "id": "el-1", "type": "titel",  "text": "Stort udsalg", "x": 5, "y": 5,  "w": 60, "h": 20 },
    { "id": "el-2", "type": "tekst",  "text": "Alt til halv pris i juli", "x": 5, "y": 28, "w": 50, "h": 15 },
    { "id": "el-3", "type": "billede","url": "https://.../media/xxx.jpg", "x": 60, "y": 5, "w": 35, "h": 50 },
    { "id": "el-4", "type": "video", "url": "https://.../media/yyy.mp4", "x": 5,  "y": 50, "w": 90, "h": 45 }
  ]
}
```
`x`/`y`/`w`/`h` er procent af skærmens bredde/højde (0-100).

### `media`
Bibliotek over uploadede billeder/videoer pr. butik, delt mellem alle admin-brugere i samme butik.

| Kolonne | Type | Beskrivelse |
|---|---|---|
| id | uuid | PK |
| butik_id | uuid | FK til `butikker.id` |
| type | text | `'billede'` eller `'video'` |
| url | text | Public URL i Storage-bucket'en `media` |
| filnavn | text | Originalt filnavn (til visning i UI) |
| oprettet_at | timestamptz | |

## Storage

- Bucket: **`media`** (public read)
- Filstruktur: `{butik_id}/{tilfældigt-id}-{filnavn}` — mappen pr. butik bruges af RLS-policies til at afgøre hvem der må uploade hvor.

## RLS-policies (opsummeret)

| Tabel/bucket | Handling | Hvem |
|---|---|---|
| `content` | SELECT | Enhver logget ind bruger (admin eller skærm) koblet til samme `butik_id` |
| `content` | INSERT/UPDATE | Kun `rolle = 'admin'` koblet til samme `butik_id` |
| `media` | SELECT/INSERT/DELETE | Kun `rolle = 'admin'` koblet til samme `butik_id` |
| `storage.objects` (bucket `media`) | SELECT | Alle (public — billeder/videoer er ikke følsomme) |
| `storage.objects` (bucket `media`) | INSERT/DELETE | Kun authenticated bruger, og kun i mappen der matcher deres eget `butik_id` |
| `butikker` | SELECT | Ikke længere anonym — kun logget ind brugere (indirekte via `brugere`-opslag) |

**Vigtigt at huske:** RLS-policies for samme kommando (fx flere INSERT-policies på samme tabel) kombineres med **OR**. Hvis du tilføjer en ny, strammere policy, skal du huske at **slette** evt. gamle, mere åbne policies for samme kommando — ellers vinder den mest åbne.

## Sådan tilføjer du en ny butik

1. Indsæt en række i `butikker` (navn + slug)
2. Opret en admin-login-konto i **Authentication → Users** (email+password, Auto Confirm) til butikkens ansatte, og indsæt en række i `brugere` med `rolle = 'admin'` og den nye butiks `butik_id`
3. Opret en skærm-login-konto på samme måde, indsæt i `brugere` med `rolle = 'skaerm'`
4. Konfigurér butikkens Pi til at åbne `skaerm.html?email=...&password=...` i kiosk-mode med den nye skærm-kontos credentials

Ingen kodeændringer nødvendige — alt styres via data.

## Kendte konti (opret selv, ikke listet her af sikkerhedshensyn)

- Admin, Butik Horsens: `jc@boerneloppen.dk`
- Skærm, Butik Horsens: `skaerm-horsens@intern.blho`

Passwords står ikke i dette dokument — findes/skiftes i Supabase Dashboard → Authentication → Users.
