// Ugentlig status paa rapportmailen: hvem har aabnet den rapport, de fik? Mailen gaar til dem, der maa
// skrive rapporter (kan_styre i some_adgang -- adresserne staar ikke i denne fil, repoet er offentligt),
// hver mandag, saa laenge en rapportmail er hoejst 4 uger gammel. Er der ingen, sendes intet; sendes
// der nye rapporter, begynder det forfra af sig selv. Der vises kun den seneste rapport pr. butik.
//
// Startes af cron-jobbet 'some-status-ugentlig' (supabase/migration_some_status.sql) med cron-noeglen i
// headeren x-some-cron, som i some-sync. Tallene er dem, some_mail_log allerede samler: der gemmes
// ikke noget nyt om modtagerne. Mailen sendes med Resend, som some-mail.
//
// Ingen hemmeligheder eller persondata i denne fil (repoet er offentligt).

const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const LOGO = 'https://jfclabs.dk/BL/logo-boerneloppen-mail.png';
const FRA = 'Børneloppen SoMe <boerneloppen-some@jfclabs.dk>';
const TESTFRA = 'Børneloppen SoMe <onboarding@resend.dev>';
type Raekke = { butik: string; modtager: string; fra: string; til: string; sendt_at: string; aabnet_foerst: string | null; aabnet_sidst: string | null; aabninger: number };

const svar = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const dk = { timeZone: 'Europe/Copenhagen' };
const dato = (t: string | Date) => new Date(t).toLocaleDateString('da-DK', { ...dk, day: 'numeric', month: 'long' });
const dagNoegle = (t: string | Date) => new Date(t).toLocaleDateString('sv-SE', dk); // 2026-11-02
const kort = (butik: string) => butik.replace(/^Butik\s+/, '');
const liste = (xs: string[]) => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' og ' + xs[xs.length - 1];
const aabnetTekst = (r: Raekke) => r.aabninger === 1
  ? `Åbnet ${dato(r.aabnet_sidst!)}`
  : `Åbnet ${r.aabninger} gange, senest ${dato(r.aabnet_sidst!)}`;

// Naeste mandag kl. 07 UTC, hvor cron-jobbet koerer (altid efter i dag)
function naesteMandag(): Date {
  for (let i = 1; i <= 7; i++) {
    const t = new Date(Date.now() + i * 864e5);
    if (t.toLocaleDateString('en-US', { ...dk, weekday: 'long' }) === 'Monday') return new Date(dagNoegle(t) + 'T07:00:00Z');
  }
  return new Date();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return svar({ fejl: 'Kun POST.' }, 405);
  const r0 = await fetch(SB + '/rest/v1/rpc/some_status_data', {
    method: 'POST', headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' }, body: '{}',
  }).catch(() => null);
  const d = r0 && r0.ok ? await r0.json().catch(() => null) : null;
  if (!d) return svar({ fejl: 'Kunne ikke læse status.' }, 500);
  const cron = req.headers.get('x-some-cron');
  if (!(cron && d.cron && cron === d.cron)) return svar({ fejl: 'Ingen adgang.' }, 403);

  // Test: body {"til":["adresse"]} sender kun til dem (op til 5), i stedet for til alle med kan_styre.
  // Kraever cron-noeglen ligesom den almindelige koersel; adresserne staar ikke i koden, men i kaldet.
  const body = await req.json().catch(() => null);
  const test: string[] | null = Array.isArray(body?.til) ? body.til : null;
  if (test && (test.length < 1 || test.length > 5 || !test.every((m) => typeof m === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m) && m.length <= 254))) {
    return svar({ fejl: 'Ugyldige testadresser (1-5 mailadresser).' }, 400);
  }
  if (test) d.til = test.map((m) => m.toLowerCase());

  // Kun den seneste afsendelse pr. butik (samme periode og samme afsendelsesdag)
  const alle: Raekke[] = d.raekker ?? [];
  const noegle = (r: Raekke) => [r.fra, r.til, dagNoegle(r.sendt_at)].join('|');
  const seneste = new Map<string, Raekke>();
  for (const r of alle) { const s = seneste.get(r.butik); if (!s || r.sendt_at > s.sendt_at) seneste.set(r.butik, r); }
  const raekker = alle.filter((r) => noegle(r) === noegle(seneste.get(r.butik)!));
  if (!raekker.length) return svar({ ok: true, sprunget: 'ingen rapportmails de sidste 4 uger' });
  if (!d.noegle) return svar({ fejl: 'Mail er ikke sat op (Resend-nøglen mangler i Supabase).' }, 500);
  if (!d.til?.length) return svar({ fejl: 'Ingen modtagere (ingen med kan_styre).' }, 500);

  const aabnet = raekker.filter((r) => r.aabninger > 0).length;
  const iAlt = raekker.length;
  const procent = Math.round((aabnet / iAlt) * 100);
  const sendtDage = liste([...new Set(raekker.map((r) => dagNoegle(r.sendt_at)))].sort().map((k) => dato(k + 'T12:00:00Z')));
  const senesteSendt = new Date(Math.max(...raekker.map((r) => +new Date(r.sendt_at))));
  const mandag = naesteMandag();
  const flere = +senesteSendt + 29 * 864e5 > +mandag;
  const fodnote = flere
    ? `Næste status kommer mandag den ${dato(mandag)}. Statussen sendes hver mandag i op til 4 uger efter, at rapporterne er sendt.`
    : 'Det var den sidste status for disse rapporter. Der kommer en ny, når der sendes nye rapporter ud.';

  // Pr. butik, i alfabetisk raekkefoelge
  const perButik = new Map<string, Raekke[]>();
  for (const r of raekker) { if (!perButik.has(r.butik)) perButik.set(r.butik, []); perButik.get(r.butik)!.push(r); }
  const butikker = [...perButik.keys()].sort((a, b) => a.localeCompare(b, 'en')); // 'en', saa Aalborg og Aarhus staar under A og ikke under Å
  const mangler = butikker.map((b) => ({ b, alle: perButik.get(b)!, rk: perButik.get(b)!.filter((r) => r.aabninger === 0) })).filter((x) => x.rk.length);
  const har = butikker.map((b) => ({ b, rk: perButik.get(b)!.filter((r) => r.aabninger > 0) })).filter((x) => x.rk.length);
  const nMangler = iAlt - aabnet;

  const C = { tekst: '#143546', dæmpet: '#52687a', streg: '#e3ecf2', gron: '#2e7d5b', raad: '#a4361f' };
  const skrift = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif`;
  const overskrift = (t: string, n: number) =>
    `<p style="margin:34px 0 4px;font-size:17px;line-height:1.3;font-weight:bold;color:${C.tekst}">${t} <span style="font-weight:normal;color:${C.dæmpet}">(${n})</span></p>`;
  const række = (venstre: string, hoejre: string) =>
    `<tr><td valign="top" width="150" style="width:150px;padding:12px 12px 12px 0;border-top:1px solid ${C.streg};font-size:15px;line-height:1.4">${venstre}</td>`
    + `<td valign="top" style="padding:12px 0;border-top:1px solid ${C.streg};font-size:14px;line-height:1.5">${hoejre}</td></tr>`;
  const tabel = (rows: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${rows}</table>`;

  const manglerHtml = nMangler
    ? tabel(mangler.map((x) => række(
      `<b>${esc(kort(x.b))}</b><br><span style="font-size:13px;color:${C.dæmpet}">${x.alle.length - x.rk.length} af ${x.alle.length} har åbnet</span>`,
      x.rk.map((r) => `<span style="color:${C.raad};font-weight:bold">${esc(r.modtager)}</span>`).join('<br>'))).join(''))
    : `<p style="margin:10px 0 0;font-size:15px">Alle har åbnet deres rapport.</p>`;
  const harHtml = aabnet
    ? tabel(har.map((x) => række(`<b>${esc(kort(x.b))}</b>`,
      x.rk.map((r) => `${esc(r.modtager)}<br><span style="font-size:13px;color:${C.dæmpet}">${esc(aabnetTekst(r))}</span>`).join('<div style="height:8px;line-height:8px">&nbsp;</div>'))).join(''))
    : `<p style="margin:10px 0 0;font-size:15px">Ingen har åbnet endnu.</p>`;

  const bar = aabnet === 0 || aabnet === iAlt
    ? `<td height="10" bgcolor="${aabnet ? C.gron : C.streg}" style="height:10px;line-height:10px;font-size:0;background:${aabnet ? C.gron : C.streg}">&nbsp;</td>`
    : `<td width="${procent}%" height="10" bgcolor="${C.gron}" style="width:${procent}%;height:10px;line-height:10px;font-size:0;background:${C.gron}">&nbsp;</td>`
      + `<td height="10" bgcolor="${C.streg}" style="height:10px;line-height:10px;font-size:0;background:${C.streg}">&nbsp;</td>`;

  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f8fc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f8fc"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;text-align:left">
<tr><td align="center" bgcolor="#143546" style="background:#143546;border-radius:12px 12px 0 0;padding:26px 20px"><img src="cid:logo" width="160" height="96" alt="Børneloppen" style="display:block;width:160px;height:96px;border:0;background:#143546;font-family:${skrift};font-size:22px;font-weight:bold;color:#ffffff"></td></tr>
<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #d9e4ec;border-top:0;border-radius:0 0 12px 12px;padding:34px 34px 30px;font-family:${skrift};color:${C.tekst}">
<p style="margin:0;font-size:26px;line-height:1.25;font-weight:bold">${aabnet} af ${iAlt} har åbnet deres rapport</p>
<p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:${C.dæmpet}">Rapporterne blev sendt ${esc(sendtDage)}. Status i dag, ${dato(new Date())}.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;border-radius:5px"><tr>${bar}</tr></table>
<p style="margin:8px 0 0;font-size:13px;color:${C.dæmpet}">${procent} % har åbnet, ${nMangler} mangler</p>
${overskrift('Har ikke åbnet', nMangler)}
${manglerHtml}
${overskrift('Har åbnet', aabnet)}
${harHtml}
<p style="margin:34px 0 0;padding-top:18px;border-top:1px solid ${C.streg};font-size:13px;line-height:1.5;color:${C.dæmpet}">${esc(fodnote)}<br>En rapport tæller som åbnet, når modtageren har logget ind via linket i mailen.</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = `${aabnet} af ${iAlt} har åbnet deres rapport\nRapporterne blev sendt ${sendtDage}. Status i dag, ${dato(new Date())}.\n\n`
    + `HAR IKKE ÅBNET (${nMangler})\n` + (nMangler ? mangler.map((x) => `${kort(x.b)} (${x.alle.length - x.rk.length} af ${x.alle.length} har åbnet)\n` + x.rk.map((r) => `  ${r.modtager}`).join('\n')).join('\n') : 'Alle har åbnet deres rapport.')
    + `\n\nHAR ÅBNET (${aabnet})\n` + (aabnet ? har.map((x) => `${kort(x.b)}\n` + x.rk.map((r) => `  ${r.modtager}: ${aabnetTekst(r)}`).join('\n')).join('\n') : 'Ingen har åbnet endnu.')
    + `\n\n${fodnote}\nEn rapport tæller som åbnet, når modtageren har logget ind via linket i mailen.`;

  const send = (from: string) => fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + d.noegle, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: d.til, subject: `${test ? 'TEST – ' : ''}SoMe-status: ${aabnet} af ${iAlt} har åbnet rapporten`, html, text,
      attachments: [{ path: LOGO, filename: 'boerneloppen.png', content_type: 'image/png', content_id: 'logo' }],
    }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  let res = await send(FRA);
  // Domaenet er ikke godkendt hos Resend: saa kan der kun sendes fra deres testadresse
  if (res && res.status === 403) res = await send(TESTFRA);
  if (!res || !res.ok) {
    console.error('Resend-fejl', res ? (await res.json().catch(() => null))?.message : 'ingen svar');
    return svar({ fejl: 'Mailen blev ikke sendt.' }, 502);
  }
  return svar({ ok: true, til: d.til.length, butikker: perButik.size, aabnet, i_alt: iAlt });
});
