// SoMe-rapporten paa mail: sender butikkens GEMTE rapport (overskrift + tekst) med et link til
// butikkens side, hvor alle tallene staar. Startes med "Send rapporten paa mail" i skrivefeltet
// paa SoMe-siden (BL/some/).
//
// Adgang: den, der maa skrive rapporter (RPC'en kan_styre_some, tjekket med brugerens eget login,
// saa databasen afgoer det) -- eller cron-noeglen i headeren x-some-cron, som i some-sync.
//
// Mailen sendes med Resend (resend.com, gratis op til 3.000 mails om maaneden). API-noeglen ligger
// i Vault som 'resend_api_key' og hentes sammen med rapporten af RPC'en some_mail_data, som kun
// service_role maa kalde. Afsenderen er en adresse paa sidens eget domaene; indtil domaenet er
// godkendt hos Resend, sendes der fra Resends testadresse, som kun kan skrive til kontoens egen mail.
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
const FRA = 'Børneloppen SoMe <some@jfclabs.dk>';
const TESTFRA = 'Børneloppen SoMe <onboarding@resend.dev>';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const dag = (d: string) => new Date(d + 'T12:00:00Z');
// "september 2026" for en hel kalendermaaned, ellers datoerne
function periodeNavn(fra: string, til: string): string {
  const sidste = new Date(Date.UTC(+til.slice(0, 4), +til.slice(5, 7), 0)).getUTCDate();
  if (fra.slice(0, 7) === til.slice(0, 7) && fra.endsWith('-01') && +til.slice(8) === sidste) {
    return dag(fra).toLocaleDateString('da-DK', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const kort = (d: string) => dag(d).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return kort(fra) + ' – ' + kort(til);
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
  const titel = d.rapport.titel || 'SoMe-rapport ' + periode;
  // Knappen er en tabelcelle: Outlook ser bort fra luft og baggrund paa et almindeligt link
  const html = `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.6;color:#1f2937;max-width:600px;margin:0 auto">
<p style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#15803d;margin:0 0 8px">SoMe-rapport · ${esc(periode)} · ${esc(butik)}</p>
<h2 style="font-size:20px;line-height:1.3;margin:0 0 12px">${esc(titel)}</h2>
<div>${esc(d.rapport.tekst).replace(/\r?\n/g, '<br>')}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 12px"><tr><td bgcolor="#15803d" style="border-radius:8px;padding:12px 22px"><a href="${esc(url)}" style="color:#ffffff;text-decoration:none;font-weight:bold">Se alle tallene</a></td></tr></table>
<p style="font-size:13px;color:#6b7280;margin:0">Linket åbner jeres egen side med alle tallene for perioden. I kan selv vælge andre perioder dér.</p>
</div>`;
  const send = (from: string) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + d.noegle, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: til, subject: `SoMe-rapport ${periode} – ${butik}`, html,
      text: `${titel}\n\n${d.rapport.tekst}\n\nSe alle tallene: ${url}`,
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
