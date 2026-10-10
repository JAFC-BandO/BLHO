// SoMe-rapporten paa mail: sender butikken en kort hilsen med en knap til butikkens side, hvor den
// gemte rapport og alle tallene staar (rapportens tekst staar paa siden, ikke i mailen). Startes
// med "Send rapporten paa mail" i skrivefeltet paa SoMe-siden (BL/some/).
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
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

  const r0 = await fetch(SB + '/rest/v1/rpc/some_mail_data', {
    method: 'POST',
    headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_butik: body?.butik ?? null }),
  }).catch(() => null);
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

  const til = String(body?.til ?? '').split(/[\s,;]+/).filter(Boolean);
  if (!til.length || til.length > 10 || til.some((a) => !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(a))) {
    return svar({ fejl: 'Skriv 1–10 gyldige mailadresser, adskilt med komma.' });
  }
  if (!d.noegle) return svar({ fejl: 'Mail er ikke sat op endnu (Resend-nøglen mangler i Supabase).', kode: 'ingen_noegle' });
  if (!d.rapport) return svar({ fejl: 'Butikken har ingen gemt rapport.' });
  if (!d.link) return svar({ fejl: 'Butikken har intet aktivt link (Admin → SoMe-adgang).' });

  const butik = String(d.butik ?? 'butikken').replace(/^Butik\s+/, 'Børneloppen ');
  const periode = periodeNavn(d.rapport.fra, d.rapport.til);
  const url = SIDE + '?k=' + d.link;
  const kontakt = typeof d.kontakt === 'string' ? d.kontakt.trim() : '';
  // Et brev paa Boerneloppens brevpapir: logoet paa den blaa flade som paa login-siden, og under
  // det et almindeligt brev med én knap -- ingen overskrifter, maerkater eller anden skabelon-pynt.
  // Tabeller og faste farver, fordi Outlook hverken kender CSS-variabler eller luft og baggrund paa
  // et almindeligt link (mso-padding-alt giver knappen sin luft dér). Vises billeder ikke, staar
  // logoets alt-tekst i hvidt paa den blaa flade.
  const skrift = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif`;
  const html = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">Jeres SoMe-rapport for ${esc(periode)} er klar.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f2" style="background:#f4f4f2"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;text-align:left">
<tr><td align="center" bgcolor="#040DB1" style="background:#040DB1;border-radius:12px 12px 0 0;padding:28px 20px"><img src="cid:logo" width="180" alt="Børneloppen" style="display:block;width:180px;max-width:100%;height:auto;border:0;font-family:${skrift};font-size:22px;font-weight:bold;color:#ffffff"></td></tr>
<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e2e2e2;border-top:0;border-radius:0 0 12px 12px;padding:32px 34px 34px;font-family:${skrift};font-size:16px;line-height:1.6;color:#1a1a1a">
<p style="margin:0 0 16px">Kære ${esc(butik)}</p>
<p style="margin:0 0 16px">Nedenfor finder I SoMe-rapporten for ${esc(butik)} for perioden <b>${esc(periode)}</b>.</p>
<p style="margin:0 0 26px">Følg linket for at læse mere om, hvad I har gjort godt, og hvad I eventuelt kan forbedre.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#040DB1" style="background:#040DB1;border-radius:8px;mso-padding-alt:13px 26px"><a href="${esc(url)}" style="display:inline-block;padding:13px 26px;font-family:${skrift};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">Åbn SoMe-rapporten</a></td></tr></table>
${kontakt ? `<p style="margin:26px 0 0">Har I spørgsmål til rapporten, er I velkomne til at skrive til <a href="mailto:${esc(kontakt)}" style="color:#040DB1">${esc(kontakt)}</a>.</p>` : ''}
<p style="margin:${kontakt ? 16 : 26}px 0 0">Med venlig hilsen<br>Børneloppen-teamet</p>
</td></tr>
</table>
</td></tr></table>`;
  const text = `Kære ${butik}\n\nNedenfor finder I SoMe-rapporten for ${butik} for perioden ${periode}. Følg linket for at læse mere om, hvad I har gjort godt, og hvad I eventuelt kan forbedre.\n\n${url}\n\n`
    + (kontakt ? `Har I spørgsmål til rapporten, er I velkomne til at skrive til ${kontakt}.\n\n` : '') + 'Med venlig hilsen\nBørneloppen-teamet';
  const send = (from: string) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + d.noegle, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: til, ...(kontakt ? { reply_to: kontakt } : {}), subject: `SoMe-rapport for ${butik}, ${periode}`, html, text,
      attachments: [{ path: LOGO, filename: 'boerneloppen.png', content_type: 'image/png', content_id: 'logo' }],
    }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  let res = await send(FRA);
  // Domaenet er ikke godkendt hos Resend endnu: saa kan der kun sendes fra deres testadresse
  const test = !!res && res.status === 403;
  if (test) res = await send(TESTFRA);
  const ud = res ? await res.json().catch(() => null) : null;
  if (!res || !res.ok) {
    console.error('Resend-fejl', res?.status, ud?.message);
    return svar({ fejl: 'Mailen blev ikke sendt' + (ud?.message ? ': ' + String(ud.message).slice(0, 300) : '. Prøv igen om lidt.') });
  }
  return svar({ ok: true, til, test });
});
