// api/webhook/stripe.js
import Stripe from 'stripe';
import { supabase } from '../../lib/_supabase.js';

export const config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', c => chunks.push(c));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

async function setAllLicensesStatusByStripeCustomer(stripeCustomerId, newStatus) {
  const { data: cust } = await supabase
    .from('customers').select('id').eq('stripe_customer_id', stripeCustomerId).maybeSingle();
  if (!cust) return;
  await supabase.from('licenses').update({ status: newStatus }).eq('customer_id', cust.id);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    const buf = await buffer(req);
    // ここは APIキー不要。ライブラリの webhooks API を直接使う
    event = Stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[webhook] signature error:', e?.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    console.log('[webhook] type=', event.type);

    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      await setAllLicensesStatusByStripeCustomer(inv.customer, 'suspended');
    }
    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const map = { trialing:'active', active:'active', past_due:'suspended', unpaid:'suspended', canceled:'canceled', incomplete:'suspended', incomplete_expired:'suspended' };
      await setAllLicensesStatusByStripeCustomer(sub.customer, map[sub.status] || 'suspended');
    }
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await setAllLicensesStatusByStripeCustomer(sub.customer, 'canceled');
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('[webhook] handler error:', e);
    return res.status(500).send('Internal Error');
  }
}
