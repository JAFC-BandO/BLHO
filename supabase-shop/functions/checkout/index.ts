// Shoppen (jfclabs.dk/shop): opretter en Stripe Checkout-betaling for kurven og sender kunden videre
// til Stripes betalingsside. Ligger i shoppens eget Supabase-projekt (swmugtukacirgopjstdx), ikke i
// Børneloppens.
//
// Priserne og farverne hentes fra tabellen produkter, så ingen kan ændre prisen i browseren. Ordrer,
// kundens adresse og kvitteringsmails klarer Stripe (se dem under Betalinger i Stripe-dashboardet).
// Betalingsmetoderne (kort, MobilePay, Apple Pay) slås til i Stripe-dashboardet.
//
// Beløbet reserveres kun (capture_method manual): det må først trækkes, når pakken sendes. Tryk
// "Capture" på betalingen i Stripe-dashboardet, når pakken er sendt (inden 7 dage, ellers frigives den).
//
// Secret: STRIPE_SECRET_KEY (sk_test_... til test, sk_live_... når shoppen åbner).
// Lukket test: står der mails i tabellen kun_koebere, må kun de købe (logget ind i shoppens
// Supabase-Auth). Tøm tabellen, når shoppen åbner; så må alle købe uden login. Login tjekkes her mod
// /auth/v1/user, derfor udrulles funktionen med verify_jwt slået fra.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const svar = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SHOP = 'https://jfclabs.dk/shop/';
const FRAGT_OERE = 4900;   // pladsholder: fast fragt med PostNord; samme som FRAGT_OERE i shop/shop.js
const MAKS_ANTAL = 20;     // pr. linje; samme som MAKS i shop/shop.js
const MAKS_LINJER = 10;

type Farve = { navn: string; billeder: string[] };
type Produkt = { id: string; navn: string; pris_oere: number; farver: Farve[] };
type Linje = { id: string; farve: string; antal: number };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return svar('ok');
  if (req.method !== 'POST') return svar({ fejl: 'Kun POST' }, 405);

  // Den indloggede brugers mail (tom uden gyldigt login)
  const auth = req.headers.get('Authorization') ?? '';
  const u = auth ? await fetch(SB + '/auth/v1/user', { headers: { apikey: SR, Authorization: auth } }).catch(() => null) : null;
  const mail: string = u?.ok ? ((await u.json()).email ?? '').toLowerCase() : '';
  const k = await fetch(`${SB}/rest/v1/kun_koebere?select=mail`, {
    headers: { apikey: SR, Authorization: 'Bearer ' + SR },
  }).catch(() => null);
  if (!k?.ok) return svar({ fejl: 'Prøv igen om lidt.' }, 503);   // hellere lukket end åben ved fejl
  const kun = (await k.json() as { mail: string }[]).map((x) => x.mail);
  if (kun.length && !mail) return svar({ fejl: 'Log ind for at købe.', login: true }, 401);
  if (kun.length && !kun.includes(mail)) return svar({ fejl: 'Shoppen er ikke åben endnu.' }, 403);
  if (!STRIPE) return svar({ fejl: 'Betaling er ikke sat op endnu.' }, 503);

  // Kurven: { varer: [{ id: "benholder", farve: "Sort", antal: 1 }, ...] }
  const varer = (await req.json().catch(() => null))?.varer;
  if (!Array.isArray(varer) || !varer.length) return svar({ fejl: 'Kurven er tom.' }, 400);
  if (varer.length > MAKS_LINJER) return svar({ fejl: 'Der er for mange linjer i kurven.' }, 400);
  const linjer: Linje[] = [];
  for (const v of varer) {
    if (!v || typeof v.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(v.id) || typeof v.farve !== 'string' ||
        !Number.isInteger(v.antal) || v.antal < 1 || v.antal > MAKS_ANTAL) {
      return svar({ fejl: 'Kurven indeholder en ugyldig vare.' }, 400);
    }
    linjer.push({ id: v.id, farve: v.farve, antal: v.antal });
  }

  const ids = [...new Set(linjer.map((l) => l.id))].join(',');
  const r = await fetch(`${SB}/rest/v1/produkter?select=id,navn,pris_oere,farver&aktiv=is.true&id=in.(${ids})`, {
    headers: { apikey: SR, Authorization: 'Bearer ' + SR },
  });
  if (!r.ok) return svar({ fejl: 'Kunne ikke hente produkterne.' }, 502);
  const produkter = new Map((await r.json() as Produkt[]).map((p) => [p.id, p]));

  const f = new URLSearchParams({
    mode: 'payment',
    locale: 'da',
    success_url: SHOP + 'kurv/?tak=1',
    cancel_url: SHOP + 'kurv/',
    'payment_intent_data[capture_method]': 'manual',
    'shipping_address_collection[allowed_countries][0]': 'DK',
    'shipping_options[0][shipping_rate_data][display_name]': 'PostNord',
    'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
    'shipping_options[0][shipping_rate_data][fixed_amount][amount]': String(FRAGT_OERE),
    'shipping_options[0][shipping_rate_data][fixed_amount][currency]': 'dkk',
    'phone_number_collection[enabled]': 'true',
  });
  if (mail) f.set('customer_email', mail);
  for (const [i, l] of linjer.entries()) {
    const p = produkter.get(l.id);
    const farve = p?.farver.find((x) => x.navn === l.farve);
    if (!p || !farve) return svar({ fejl: 'En vare i kurven findes ikke længere.' }, 400);
    f.set(`line_items[${i}][quantity]`, String(l.antal));
    f.set(`line_items[${i}][price_data][currency]`, 'dkk');
    f.set(`line_items[${i}][price_data][unit_amount]`, String(p.pris_oere));
    f.set(`line_items[${i}][price_data][product_data][name]`, `${p.navn}, ${farve.navn.toLowerCase()}`);
    f.set(`line_items[${i}][price_data][product_data][metadata][id]`, p.id);
    f.set(`line_items[${i}][price_data][product_data][metadata][farve]`, farve.navn);
    if (farve.billeder[0]) f.set(`line_items[${i}][price_data][product_data][images][0]`, SHOP + farve.billeder[0]);
  }

  const s = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + STRIPE, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: f,
  });
  const session = await s.json();
  if (!s.ok) {
    console.error('Stripe', s.status, session?.error?.message);
    return svar({ fejl: 'Betalingen kunne ikke startes.' }, 502);
  }
  return svar({ url: session.url });
});
