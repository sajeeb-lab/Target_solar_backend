import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

// Returns the card details for a completed payment, so the success screen
// can show "Visa ending 4242" without the frontend needing a secret key.

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { paymentIntentId } = (req.body || {}) as { paymentIntentId?: string };

    // PaymentIntent IDs always look like pi_XXXX. Checking the shape stops
    // arbitrary strings being passed through to the Stripe API.
    if (!paymentIntentId || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
      return res.status(400).json({ error: 'Invalid payment reference' });
    }

    const paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method'],
    });

    // Only return details for payments that actually succeeded — otherwise
    // this endpoint could be used to probe whether an ID exists.
    if (paymentIntent.status !== 'succeeded') {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const pm = paymentIntent.payment_method;

    // payment_method is a string when not expanded, an object when it is.
    // It can also be null, and non-card methods have no `card` field.
    if (!pm || typeof pm === 'string' || !pm.card) {
      return res.status(200).json({
        cardLast4: null,
        cardBrand: null,
        cardExpMonth: null,
        cardExpYear: null,
      });
    }

    // Only the last 4 digits, brand and expiry — never the full number,
    // which Stripe does not expose to anyone, including you.
    return res.status(200).json({
      cardLast4: pm.card.last4,
      cardBrand: pm.card.brand,
      cardExpMonth: pm.card.exp_month,
      cardExpYear: pm.card.exp_year,
    });
  } catch (error) {
    console.error('Failed to retrieve PaymentIntent:', error);
    return res.status(500).json({ error: 'Unable to retrieve payment details.' });
  }
}
