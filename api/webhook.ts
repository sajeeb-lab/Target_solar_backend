import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// NOTE: `export const config = { api: { bodyParser: false } }` is a Next.js
// feature and is IGNORED by @vercel/node — don't add it here, it does nothing.
//
// Vercel always reads the incoming body to populate `req.body`, but it then
// replays those bytes back onto the request so you can still read them raw.
// That replay only works through the 'data'/'end' events — `for await
// (const chunk of req)` returns an EMPTY buffer, which makes Stripe's
// signature check fail every single time. Hence the event-based reader below.
function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // No CORS headers — Stripe calls this server-to-server, not from a browser.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];

  if (!sig || typeof sig !== 'string') {
    return res.status(400).json({ error: 'Missing Stripe signature header' });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || '',
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log('Payment succeeded:', pi.id);
      console.log('  Project:', pi.metadata.projectNumber);
      console.log('  Name:', pi.metadata.customerName);
      console.log('  Email:', pi.metadata.customerEmail);
      console.log('  Reference:', pi.metadata.customerReference);
      console.log('  Amount:', pi.amount / 100, 'AUD');
      // TODO: this is the reliable place to mark the project as paid in
      // your CRM, send a confirmation, etc. Don't rely on the browser
      // reporting success — a closed tab or dropped connection would
      // otherwise leave the payment unrecorded on your side.
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log('Payment failed:', pi.id, pi.last_payment_error?.message);
      // TODO: notify the customer or log the failure.
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  // Always respond 200 quickly, or Stripe will retry the delivery.
  return res.status(200).json({ received: true });
}
