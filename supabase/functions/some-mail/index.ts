// SoMe-rapporten paa mail: sender butikken en kort hilsen med en knap til butikkens side, hvor den
// gemte rapport og alle tallene staar (rapportens tekst staar paa siden, ikke i mailen). Startes
// med "Send rapporten paa mail" i skrivefeltet paa SoMe-siden (BL/some/).
//
// Hver modtager faar sin egen mail med et personligt link (en raekke i some_mail_log): linket
// aabner butikkens side (efter login med butikkens konto, saa det ogsaa staar i Aktivitetsloggen),
// holder op med at virke en maaned efter afsendelsen, og siden taeller, naar det aabnes -- saa den
// SoMe-ansvarlige kan se, hvem der har aabnet rapporten.
//
// Adgang: den, der maa skrive rapporter (RPC'en kan_styre_some, tjekket med brugerens eget login,
// saa databasen afgoer det) -- eller cron-noeglen i headeren x-some-cron, som i some-sync.
//
// Mailen sendes med Resend (resend.com, gratis op til 3.000 mails om maaneden). API-noeglen ligger
// i Vault som 'resend_api_key' og hentes sammen med rapportens periode af RPC'en some_mail_data,
// som kun service_role maa kalde. Afsenderen er en adresse paa sidens eget domaene; indtil domaenet
// er godkendt hos Resend, sendes der fra Resends testadresse, som kun kan skrive til kontoens egen
// mail. Adressen, butikkerne kan skrive til med spoergsmaal ('some_mail_kontakt' i Vault), staar i
// mailen og er svar-adresse -- den ligger ikke i denne fil, fordi repoet er offentligt.
//
// Ingen hemmeligheder eller persondata i denne fil (repoet er offentligt).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const svar = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SIDE = 'https://jfclabs.dk/BL/some/';
// Logoet som PNG (BL/logo-boerneloppen-mail.png, lavet af logo-boerneloppen.svg): mailprogrammer viser
// ikke SVG. Resend henter det og laegger det ind i selve mailen (cid:logo) -- et billede, der skal
// hentes udefra, skjuler Outlook, indtil modtageren trykker "Hent billeder".
const LOGO = 'https://jfclabs.dk/BL/logo-boerneloppen-mail.png';
const FRA = 'Børneloppen SoMe <boerneloppen-some@jfclabs.dk>';
const TESTFRA = 'Børneloppen SoMe <onboarding@resend.dev>';
// Startkoden til nyoprettede logins (supabase/opret-some-modtagere.mjs). Den staar kun i mailen, saa laenge
// modtageren ikke har valgt sin egen adgangskode (skal_saette_password) -- se some_mail_ny_login
const STARTKODE = '12345678';
const PAUSE_MS = 600;   // mellem mails: Resend tager hoejst 2 kald i sekundet
type Link = { kode: string; modtager: string };   // en raekke i some_mail_log: modtagerens personlige link

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Supabase med service_role (uden om RLS)
const db = (sti: string, init: RequestInit) => fetch(SB + '/rest/v1/' + sti, {
  ...init,
  headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
}).catch(() => null);
const dag = (d: string) => new Date(d + 'T12:00:00Z');
// "september 2026" for en hel kalendermaaned, ellers "12. september – 9. oktober 2026"
function periodeNavn(fra: string, til: string): string {
  const sidste = new Date(Date.UTC(+til.slice(0, 4), +til.slice(5, 7), 0)).getUTCDate();
  if (fra.slice(0, 7) === til.slice(0, 7) && fra.endsWith('-01') && +til.slice(8) === sidste) {
    return dag(fra).toLocaleDateString('da-DK', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const dato = (d: string, aar: boolean) => dag(d).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', ...(aar ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return dato(fra, fra.slice(0, 4) !== til.slice(0, 4)) + ' – ' + dato(til, true);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return svar({ fejl: 'Kun POST.' }, 405);
  const body = await req.json().catch(() => ({}));

  const r0 = await db('rpc/some_mail_data', { method: 'POST', body: JSON.stringify({ p_butik: body?.butik ?? null }) });
  const d = r0 && r0.ok ? await r0.json().catch(() => null) : null;
  if (!d) return svar({ fejl: 'Kunne ikke læse rapporten.' }, 500);

  // ---------- Adgang: cron-noeglen, eller en bruger der maa skrive rapporter ----------
  const cron = req.headers.get('x-some-cron');
  if (!(cron && d.cron && cron === d.cron)) {
    const adg = await fetch(SB + '/rest/v1/rpc/kan_styre_some', {
      method: 'POST',
      headers: {
        apikey: req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        Authorization: req.headers.get('Authorization') ?? '', 'Content-Type': 'application/json',
      },
      body: '{}',
    }).catch(() => null);
    if (!adg || !adg.ok || (await adg.json().catch(() => false)) !== true) {
      return svar({ fejl: 'Du har ikke adgang til at sende rapporter.' }, 403);
    }
  }

  const til = [...new Set(String(body?.til ?? '').split(/[\s,;]+/).filter(Boolean))];
  if (!til.length || til.length > 10 || til.some((a) => !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(a))) {
    return svar({ fejl: 'Skriv 1–10 gyldige mailadresser, adskilt med komma.' });
  }
  if (!d.noegle) return svar({ fejl: 'Mail er ikke sat op endnu (Resend-nøglen mangler i Supabase).', kode: 'ingen_noegle' });
  if (!d.rapport) return svar({ fejl: 'Butikken har ingen gemt rapport.' });

  const butik = String(d.butik ?? 'butikken').replace(/^Butik\s+/, 'Børneloppen ');
  const periode = periodeNavn(d.rapport.fra, d.rapport.til);
  const kontakt = typeof d.kontakt === 'string' ? d.kontakt.trim() : '';
  // Et brev paa Boerneloppens brevpapir: logoet paa den blaa flade som paa login-siden, og under
  // det et almindeligt brev med én knap -- ingen overskrifter, maerkater eller anden skabelon-pynt.
  // Tabeller og faste farver, fordi Outlook hverken kender CSS-variabler eller luft og baggrund paa
  // et almindeligt link (mso-padding-alt giver knappen sin luft dér). Vises billeder ikke, staar
  // logoets alt-tekst i hvidt paa den blaa flade. Logoet har fast stoerrelse og blaa baggrund, saa
  // det ikke staar som en hvid boks, mens Outlook henter det frem. Dag og maaned holdes sammen
  // (&nbsp;), saa en smal telefon ikke deler "9." og "oktober" over to linjer.
  const skrift = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif`;
  // Lys og moerk variant (DESIGN.md): mailprogrammer i moerk tilstand faar sidens egne moerke
  // farver i stedet for at vende de lyse om selv. Lyst: logoet paa Night som sitets header.
  // Moerkt: logoet og knappen paa brand-blaa (#33a3dc), kort #1e2029 paa side #15161b. Klasserne
  // styrer kun den moerke variant; de faste farver inline er den lyse. [data-ogsc] er Outlook.com.
  const html = (url: string, ny: boolean, mail: string) => `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
 .side,body{background:#15161b!important}
 .hoved,.hoved img{background:#33a3dc!important}
 .kort{background:#1e2029!important;border-color:#3a3d4a!important;color:#e8e8ee!important}
 .kort a.lnk{color:#7fc7ea!important}
 .knap{background:#33a3dc!important}
}
[data-ogsc] .side{background:#15161b!important}[data-ogsc] .hoved,[data-ogsc] .hoved img{background:#33a3dc!important}[data-ogsc] .kort{background:#1e2029!important;border-color:#3a3d4a!important;color:#e8e8ee!important}[data-ogsc] .kort a.lnk{color:#7fc7ea!important}[data-ogsc] .knap{background:#33a3dc!important}
</style></head><body class="side" style="margin:0;background:#f3f8fc"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Jeres SoMe-rapport for ${esc(periode)} er klar.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f8fc" class="side" style="background:#f3f8fc"><tr><td align="center" class="side" style="padding:32px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;text-align:left">
<tr><td align="center" bgcolor="#143546" class="hoved" style="background:#143546;border-radius:12px 12px 0 0;padding:28px 20px"><img src="cid:logo" width="180" height="108" alt="Børneloppen" style="display:block;width:180px;height:108px;border:0;background:#143546;font-family:${skrift};font-size:22px;font-weight:bold;color:#ffffff"></td></tr>
<tr><td bgcolor="#ffffff" class="kort" style="background:#ffffff;border:1px solid #d9e4ec;border-top:0;border-radius:0 0 12px 12px;padding:32px 34px 34px;font-family:${skrift};font-size:16px;line-height:1.6;color:#143546">
<p style="margin:0 0 16px">Kære ${esc(butik)}</p>
<p style="margin:0 0 16px">Nedenfor finder I SoMe-rapporten for ${esc(butik)} for perioden <b>${esc(periode).replace(/(\d\.) /g, '$1&nbsp;')}</b>.</p>
<p style="margin:0 0 ${ny ? 16 : 26}px">Følg linket og log ind for at læse mere om, hvad I har gjort godt, og hvad I eventuelt kan forbedre.</p>
${ny ? `<p style="margin:0 0 26px">Log ind med din Børneloppen-mail <b>${esc(mail)}</b> og adgangskoden <b>${STARTKODE}</b>. Du bliver bedt om at vælge en ny adgangskode, første gang du logger ind.</p>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#33a3dc" class="knap" style="background:#33a3dc;border-radius:999px;mso-padding-alt:13px 26px"><a href="${esc(url)}" style="display:inline-block;padding:13px 26px;font-family:${skrift};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">Log ind og læs rapporten</a></td></tr></table>
${kontakt ? `<p style="margin:26px 0 0">Har I spørgsmål til rapporten, er I velkomne til at skrive til <a href="mailto:${esc(kontakt)}" class="lnk" style="color:#143546">${esc(kontakt)}</a>.</p>` : ''}
<p style="margin:${kontakt ? 16 : 26}px 0 0">Med venlig hilsen<br>Børneloppen-teamet</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
  const text = (url: string, ny: boolean, mail: string) => `Kære ${butik}\n\nNedenfor finder I SoMe-rapporten for ${butik} for perioden ${periode}. Følg linket og log ind for at læse mere om, hvad I har gjort godt, og hvad I eventuelt kan forbedre.\n\n${url}\n\n`
    + (ny ? `Log ind med din Børneloppen-mail ${mail} og adgangskoden ${STARTKODE}. Du bliver bedt om at vælge en ny adgangskode, første gang du logger ind.\n\n` : '')
    + (kontakt ? `Har I spørgsmål til rapporten, er I velkomne til at skrive til ${kontakt}.\n\n` : '') + 'Med venlig hilsen\nBørneloppen-teamet';
  const send = (from: string, modtager: string, url: string, ny: boolean) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + d.noegle, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [modtager], ...(kontakt ? { reply_to: kontakt } : {}), subject: `SoMe-rapport for ${butik}, ${periode}`,
      html: html(url, ny, modtager), text: text(url, ny, modtager),
      attachments: [{ path: LOGO, filename: 'boerneloppen.png', content_type: 'image/png', content_id: 'logo' }],
    }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);

  // De personlige links oprettes foer afsendelsen, saa linket virker, naar mailen lander
  const ind = await db('some_mail_log', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify(til.map((modtager) => ({ butik_id: body.butik, modtager, fra: d.rapport.fra, til: d.rapport.til }))),
  });
  const links: Link[] | null = ind && ind.ok ? await ind.json().catch(() => null) : null;
  if (!links || links.length !== til.length) return svar({ fejl: 'Mailen kunne ikke gøres klar. Prøv igen om lidt.' }, 500);

  // Hvem har endnu ikke valgt egen adgangskode (de faar startkoden i mailen)
  const nyRes = await fetch(SB + '/rest/v1/rpc/some_mail_ny_login', {
    method: 'POST', headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_modtagere: til }),
  }).catch(() => null);
  const nye = new Set<string>(nyRes && nyRes.ok ? ((await nyRes.json().catch(() => [])) as string[]) : []);

  let fra = FRA, besked = '';
  const sendt: string[] = [], fejlet: Link[] = [];
  for (const l of links) {
    if (l !== links[0]) await pause(PAUSE_MS);
    const url = SIDE + '?k=' + l.kode;
    const ny = nye.has(l.modtager.toLowerCase());
    let res = await send(fra, l.modtager, url, ny);
    // Domaenet er ikke godkendt hos Resend endnu: saa kan der kun sendes fra deres testadresse
    if (res && res.status === 403 && fra === FRA) { fra = TESTFRA; await pause(PAUSE_MS); res = await send(fra, l.modtager, url, ny); }
    if (res && res.ok) { sendt.push(l.modtager); continue; }
    fejlet.push(l);
    besked = (res ? (await res.json().catch(() => null))?.message : '') || besked;
  }
  if (fejlet.length) {
    console.error('Resend-fejl', besked);
    // En mail, der ikke kom af sted, skal ikke staa som sendt (og aldrig aabnet)
    await db('some_mail_log?kode=in.(' + fejlet.map((l) => l.kode).join(',') + ')', { method: 'DELETE' });
  }
  if (!sendt.length) return svar({ fejl: 'Mailen blev ikke sendt' + (besked ? ': ' + String(besked).slice(0, 300) : '. Prøv igen om lidt.') });
  return svar({ ok: true, til: sendt, fejlet: fejlet.map((l) => l.modtager), test: fra === TESTFRA });
});
