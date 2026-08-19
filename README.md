# Target Solar — Payment Backend

Two Vercel serverless functions that let your payment page collect card
payments in-place via Stripe Elements (no redirect):

- `api/create-payment-intent.ts` — creates a PaymentIntent and returns the
  `client_secret` your frontend passes to Stripe.js.
- `api/webhook.ts` — receives `payment_intent.succeeded` /
  `payment_intent.payment_failed` from Stripe so payments are confirmed
  server-side, not just in the browser.

No `vercel.json` — Vercel auto-detects `.ts` files under `/api` and builds
them as Node.js Serverless Functions with zero config. (The `functions.runtime`
syntax pinning `@vercel/node@3` is a common source of deploy errors; leaving
it out is safer. To pin a Node version, use Settings → General → Node.js
Version in the Vercel dashboard.)

**Don't add `export const config = { api: { bodyParser: false } }` to the
webhook.** That's a Next.js feature; `@vercel/node` ignores it. Vercel reads
the body then replays it on the request, but only via the `'data'`/`'end'`
events — `for await (const chunk of req)` yields an empty buffer and makes
Stripe's signature check fail every time. `api/webhook.ts` reads the raw body
with event listeners for exactly this reason.

## Deploy

1. Push this folder to a new GitHub repo.
2. vercel.com → **Add New Project** → import the repo. Free tier is fine.
3. **Settings → Environment Variables**, add:
   | Variable | Where to get it |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys. Use `sk_test_...` first. |
   | `STRIPE_WEBHOOK_SECRET` | From step 5 below. |
   | `ALLOWED_ORIGIN` | The exact URL of your payment page, e.g. `https://pay.targetsolar.com.au`. Leave unset only while testing. |
4. Deploy → you get a URL like `https://target-solar-backend.vercel.app`.
5. Stripe Dashboard → Developers → Webhooks → **Add endpoint**:
   `https://<your-vercel-url>/api/webhook`, selecting at least
   `payment_intent.succeeded` and `payment_intent.payment_failed`.
   Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`
   in Vercel, then redeploy.
6. Point your frontend at
   `https://<your-vercel-url>/api/create-payment-intent`.

## Request / response shape

POST JSON to `/api/create-payment-intent`:

```json
{
  "amount": 22.67,
  "projectNumber": "zp321",
  "customerName": "Jane Smith",
  "customerEmail": "jane@example.com",
  "customerReference": "INV-1024"
}
```

Response:

```json
{
  "clientSecret": "pi_..._secret_...",
  "paymentIntentId": "pi_..."
}
```

`amount` is in dollars — the function converts to cents. Send the final
total the customer sees (including any surcharge), since that's what gets
charged.

Test with card `4242 4242 4242 4242`, any future expiry, any CVV, while
the test key is in place.

## Two things to fix before going live

1. **`amount` is trusted from the client.** The endpoint charges whatever
   number the browser sends. Once you can look up the real invoice total
   for a `projectNumber` on your side, fetch it server-side and use that
   instead — see the `TODO` in `create-payment-intent.ts`.
2. **The card surcharge.** Australia's RBA is banning card surcharges on
   Visa/Mastercard/eftpos from 1 October 2026 (Amex currently expected to
   stay exempt). If your page adds a surcharge line, it needs to come off
   or move into the base price before then.
