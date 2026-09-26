// Vagtplan-assistenten: oversaetter lederens besked til handlinger paa vagtplanen.
// AI'en forstaar kun sproget -- selve planlaegningen (afloesere, regler, huller) sker i
// browseren med BL/vagtplan/motor.js, saa planen altid overholder reglerne.
//
// Adgang: kun brugere i vagtplan_adgang (tjekkes med brugerens eget login via RPC'en
// har_vagtplan_adgang, saa RLS afgoer det -- ikke denne fil).
//
// AI: Google Gemini, gratis kvote. Noeglen ligger som secret i Supabase:
//   Dashboard -> Edge Functions -> Secrets -> GEMINI_API_KEY  (hentes paa aistudio.google.com)
// Valgfrit: GEMINI_MODELLER = kommasepareret liste der proeves i raekkefoelge (naar kvoten paa
// den foerste er brugt op, proeves den naeste).
//
// Data: i EOES bruger Google ikke indhold fra den gratis kvote til at forbedre sine produkter
// (Gemini API Additional Terms). Klienten sender navne, tider og regler -- ikke loen og e-mail.
//
// Ingen persondata i denne fil (repoet er offentligt) -- eksemplerne bruger opdigtede navne.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const svar = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MODELLER = (Deno.env.get('GEMINI_MODELLER') ?? 'gemini-flash-latest,gemini-flash-lite-latest')
  .split(',').map((s) => s.trim()).filter(Boolean);

const SYSTEM = `Du er vagtplan-assistent i Børneloppens vagtplan-værktøj. Lederen skriver på dansk, hvad der skal ske med vagtplanen, og du oversætter det til handlinger. Programmet udfører handlingerne med sin egen planlægger, som overholder butikkens regler, dækker huller og finder afløsere. Du skal altså IKKE selv regne bemanding ud eller vælge afløsere.

Svar ALTID med JSON: {"svar": "...", "handlinger": [...]}
- "svar": kort, venlig dansk tekst (1–3 sætninger): hvad du gør, svaret på et spørgsmål, eller et opklarende spørgsmål. Skriv ikke vagterne op – programmet viser selv ændringerne. Ingen markdown.
- "handlinger": ændringerne (tom liste, hvis du kun svarer eller spørger).

Handlinger. "navn" og "til_navn" skal være præcis et navn fra medarbejderlisten. Datoer skrives ÅÅÅÅ-MM-DD. Klokkeslæt skrives TT:MM i hele kvarter.
- {"type":"fri","navn":…,"datoer":[…]} – personen har fri hele dagen (ferie, sygdom, fridag). Personens vagter de dage fjernes, og planlæggeren finder afløsere.
- {"type":"fri_antal","navn":…,"antal":N,"datoer":[…]} – personen skal have N fridage i en periode, men lederen har ikke sagt hvilke. "datoer" = alle datoer i perioden. Planlæggeren vælger de dage, der er nemmest at dække.
- {"type":"kun_tid","navn":…,"datoer":[…],"fra":…,"til":…} – personen kan kun arbejde fra–til de dage (fx "kan først kl. 12", "skal gå kl. 14" – så udelades det felt, der ikke er sagt noget om).
- {"type":"vagt","navn":…,"datoer":[…],"fra":…,"til":…} – personen SKAL arbejde de dage. Udelad "fra" og "til", hvis lederen ikke har nævnt et tidspunkt – så vælger planlæggeren tiden. Vagten låses fast.
- {"type":"overdrag","navn":…,"til_navn":…,"datoer":[…]} – navns vagt de dage gives til til_navn. At bytte vagter er to overdrag.
- {"type":"fjern_aftale","navn":…,"datoer":[…]} – fjern en tidligere aftale (fri, tidsbegrænsning eller låst vagt) for personen de dage.
- {"type":"tilgaengelighed","navn":…,"ugedage":[…],"kan":true|false,"fra":…,"til":…} – FAST ændring af, hvornår personen kan arbejde hver uge (0=mandag … 6=søndag). Kun når lederen siger, at det gælder fremover ("kan ikke arbejde mandage mere", "kan nu også om lørdagen").
- {"type":"timer","navn":…,"timeart":"min"|"praecis"|"oenske"|"ingen","timer":N} – FAST ændring af personens timer: min = mindst N timer om ugen i snit over 4 uger, praecis = præcis N timer hver uge, oenske = gerne mindst N timer om ugen, ingen = intet krav.
- {"type":"ny_plan"} – lav hele planen forfra. Kun når lederen udtrykkeligt beder om en helt ny plan.

Sådan gør du:
- Regn datoer ud fra "I dag" i konteksten. Uger starter mandag. "I morgen" = dagen efter i dag. "På torsdag" (uden dato) = den første torsdag fra og med i dag. "Næste uge" = mandag–søndag i ugen efter denne uge. "De næste 2 uger" = i dag og de følgende 13 dage.
- Tjek ugedagen for hver dato i vagtlisten i konteksten, så du ikke tager fejl af datoerne.
- Kun datoer i planen kan ændres. Ligger noget uden for planen, så sig det i "svar".
- Er det uklart, hvem eller hvilke dage det gælder, så spørg i "svar" og lav ingen handlinger. Gæt aldrig et navn, der ikke står på listen – men skriver lederen et navn lidt anderledes (fx Freja/Freya), så brug navnet fra listen.
- Fri, kun_tid og vagt gælder kun de nævnte datoer. Brug kun "tilgaengelighed" og "timer" ved faste ændringer.
- Spørgsmål om planen (hvem arbejder hvornår, timer, problemer) besvares ud fra konteksten uden handlinger. Brug tallene under "Timer pr. uge" i stedet for at regne selv.
- "Ekstra person" er en pladsholder for en ekstra medarbejder eller vikar, der skal findes.
- Beder lederen om noget, du ikke kan (fx at ændre butikkens åbningstider eller regler), så forklar kort i "svar", at det gøres under "Regler".

Eksempel (opdigtede navne; i dag er fredag 2026-03-06):
Lederen: "Anna skal have fri 2 dage og skal arbejde tirsdag og torsdag de næste 2 uger, og Bo er syg i morgen"
{"svar":"Anna låses på tirsdage og torsdage de næste to uger og får 2 fridage, som planlæggeren vælger. Bo har fri i morgen, og hans vagt dækkes.","handlinger":[{"type":"vagt","navn":"Anna","datoer":["2026-03-10","2026-03-12","2026-03-17","2026-03-19"]},{"type":"fri_antal","navn":"Anna","antal":2,"datoer":["2026-03-06","2026-03-07","2026-03-08","2026-03-09","2026-03-10","2026-03-11","2026-03-12","2026-03-13","2026-03-14","2026-03-15","2026-03-16","2026-03-17","2026-03-18","2026-03-19"]},{"type":"fri","navn":"Bo","datoer":["2026-03-07"]}]}`;

const STR = { type: 'string' };
const SKEMA = {
  type: 'object',
  properties: {
    svar: STR,
    handlinger: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['fri', 'fri_antal', 'kun_tid', 'vagt', 'overdrag', 'fjern_aftale', 'tilgaengelighed', 'timer', 'ny_plan'] },
          navn: STR,
          til_navn: STR,
          datoer: { type: 'array', items: STR },
          antal: { type: 'integer' },
          fra: STR,
          til: STR,
          ugedage: { type: 'array', items: { type: 'integer' } },
          kan: { type: 'boolean' },
          timeart: { type: 'string', enum: ['ingen', 'min', 'praecis', 'oenske'] },
          timer: { type: 'number' },
        },
        required: ['type'],
      },
    },
  },
  required: ['svar', 'handlinger'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return svar({ fejl: 'Kun POST.' }, 405);

  // ---------- Adgang ----------
  const auth = req.headers.get('Authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const adg = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/har_vagtplan_adgang', {
    method: 'POST',
    headers: { apikey, Authorization: auth, 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  if (!adg || !adg.ok || (await adg.json().catch(() => false)) !== true) {
    return svar({ fejl: 'Du har ikke adgang til vagtplanen.' }, 403);
  }

  const noegle = Deno.env.get('GEMINI_API_KEY');
  if (!noegle) return svar({ fejl: 'AI-assistenten er ikke sat op endnu (GEMINI_API_KEY mangler i Supabase).', kode: 'ingen_noegle' });

  // ---------- Besked ----------
  let body: { beskeder?: { rolle?: string; tekst?: string }[]; kontekst?: string };
  try { body = await req.json(); } catch { return svar({ fejl: 'Ugyldig forespørgsel.' }, 400); }
  const kontekst = String(body.kontekst ?? '').slice(0, 80000);
  let beskeder = (Array.isArray(body.beskeder) ? body.beskeder : []).slice(-16)
    .map((b) => ({ role: b.rolle === 'assistent' ? 'model' : 'user', parts: [{ text: String(b.tekst ?? '').slice(0, 4000) }] }))
    .filter((b) => b.parts[0].text.trim());
  while (beskeder.length && beskeder[0].role !== 'user') beskeder = beskeder.slice(1);
  if (!beskeder.length || beskeder[beskeder.length - 1].role !== 'user') return svar({ fejl: 'Der er ingen besked.' }, 400);

  const kald = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM + '\n\n=== KONTEKST ===\n' + kontekst }] },
    contents: beskeder,
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseJsonSchema: SKEMA },
  });

  // ---------- Gemini ----------
  // Er kvoten paa én model brugt op (429), eller findes den ikke laengere (404), proeves den naeste.
  let sidst = 0, besked = '';
  for (const model of MODELLER) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': noegle },
      body: kald,
    }).catch(() => null);
    if (!res) { sidst = 503; continue; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      sidst = res.status; besked = data?.error?.message ?? '';
      if (res.status === 429 || res.status === 404 || res.status >= 500) continue;
      console.error('Gemini-fejl', model, res.status, besked);
      return svar({ fejl: 'AI-tjenesten afviste beskeden (' + res.status + ').', detalje: besked.slice(0, 300) });
    }
    const dele = data?.candidates?.[0]?.content?.parts ?? [];
    const tekst = dele.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('').trim();
    let ud: { svar?: unknown; handlinger?: unknown };
    try {
      ud = JSON.parse(tekst.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      ud = { svar: tekst || 'Jeg forstod ikke helt beskeden – prøv at skrive den på en anden måde.', handlinger: [] };
    }
    return svar({
      svar: String(ud.svar ?? ''),
      handlinger: Array.isArray(ud.handlinger) ? ud.handlinger.slice(0, 40) : [],
      model,
    });
  }
  console.error('Ingen model svarede', sidst, besked);
  return svar(sidst === 429
    ? { fejl: 'Den gratis AI-kvote er brugt op lige nu. Prøv igen om et minut.', kode: 'kvote' }
    : { fejl: 'AI-tjenesten svarer ikke lige nu. Prøv igen om lidt.', kode: 'nede' });
});
