// Shoppen (jfclabs.dk/shop): Stripe-webhook. Når en kunde har gennemført betalingen
// (checkout.session.completed), gemmes ordren i tabellen ordrer, og varerne trækkes fra lageret.
// Samme betaling trækker kun én gang, også hvis Stripe sender beskeden igen (registrer_ordre).
// Kurven kommer fra sessionens metadata varer ("id|farve|antal;..."), som checkout-funktionen sætter.
//
// Secret: STRIPE_WEBHOOK_SECRET (whsec_..., fra webhook-endpointet i Stripe-dashboardet).
// Udrulles med verify_jwt slået fra: Stripe sender ikke et Supabase-login, så Stripes signatur tjekkes her.

const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HEMMELIG = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const TOLERANCE = 300;   // sekunder, som Stripes egne biblioteker

const tekst = (body: string, status = 200) => new Response(body, { status });

// Stripe-Signature: "t=<tid>,v1=<hex>[,v1=...]"; v1 er HMAC-SHA256 af "<tid>.<rå body>" med webhook-hemmeligheden
async function gyldig(body: string, header: string): Promise<boolean> {
  const dele = header.split(',').map((d) => d.split('='));
  const t = dele.find(([k]) => k === 't')?.[1];
  const v1 = dele.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE) return false;
  const noegle = await crypto.subtle.importKey('raw', new TextEncoder().encode(HEMMELIG), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', noegle, new TextEncoder().encode(`${t}.${body}`)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Sammenlign uden at afsløre, hvor tidligt to strenge afviger
  return v1.some((v) => v.length === hex.length && [...v].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return tekst('Kun POST', 405);
  if (!HEMMELIG) return tekst('Webhooken er ikke sat op', 503);
  const body = await req.text();
  if (!(await gyldig(body, req.headers.get('Stripe-Signature') ?? ''))) return tekst('Ugyldig signatur', 400);

  const ev = JSON.parse(body);
  if (ev.type !== 'checkout.session.completed') return tekst('ok');
  const s = ev.data.object;
  const varer = String(s.metadata?.varer ?? '').split(';').filter(Boolean).map((v) => {
    const [id, farve, antal] = v.split('|');
    return { id, farve, antal: Number(antal) };
  }).filter((v) => v.id && v.farve && Number.isInteger(v.antal) && v.antal > 0);
  if (!varer.length) return tekst('ok');   // fx en betaling oprettet i Stripe-dashboardet

  const r = await fetch(`${SB}/rest/v1/rpc/registrer_ordre`, {
    method: 'POST',
    headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session: s.id, p_varer: varer }),
  });
  if (!r.ok) {
    console.error('registrer_ordre', r.status, await r.text());
    return tekst('Kunne ikke gemme ordren', 500);   // Stripe prøver igen senere
  }
  return tekst('ok');
});
