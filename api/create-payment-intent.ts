import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

// Secret key lives only here, server-side. Never ships to the browser.
// No apiVersion is pinned on purpose — a hardcoded version string that your
// installed `stripe` package doesn't recognise needs an `as any` cast to
// compile and can misbehave at runtime. Leaving it off means Stripe uses
// your account's default API version, which is what you want.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Your payment page is served from a different domain than this API, so the
// browser will block the request unless these CORS headers are present.
// Set ALLOWED_ORIGIN in Vercel to your real page URL so only your page can
// call this endpoint.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set on every response, including errors — otherwise the browser hides
  // the real error message behind a generic network failure.
  setCors(res);

  // The browser sends this preflight before the actual POST.
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      amount,
      projectNumber,
      customerName,
      customerEmail,
      customerReference,
    } = (req.body || {}) as {
      amount?: number;
      projectNumber?: string;
      customerName?: string;
      customerEmail?: string;
      customerReference?: string;
    };

    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // ⚠️ TODO before going live: this charges whatever amount the browser
    // sends. Once you can look up the real invoice total for a given
    // projectNumber (CRM, database, wherever the source of truth is),
    // fetch it here and use that instead of the client-supplied value.

    // Convert to cents (Stripe expects the smallest currency unit)
    const amountInCents = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'aud',
      automatic_payment_methods: { enabled: true },
      description: `Target Solar - Project #${projectNumber || 'N/A'}`,
      metadata: {
        projectNumber: (projectNumber || '').slice(0, 500),
        customerName: (customerName || '').slice(0, 500),
        customerEmail: (customerEmail || '').slice(0, 500),
        customerReference: (customerReference || '').slice(0, 500),
      },
      // Stripe emails a receipt automatically when this is set.
      // Note: in test mode Stripe does not actually send it.
      ...(customerEmail ? { receipt_email: customerEmail } : {}),
    });

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('PaymentIntent creation failed:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create payment intent',
    });
  }
}
