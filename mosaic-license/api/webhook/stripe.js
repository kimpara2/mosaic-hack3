// api/webhook/stripe.js
import Stripe from 'stripe';
import crypto from 'crypto';
import { supabase } from '../../lib/_supabase.js';

export const config = { api: { bodyParser: false } };

// Stripe インスタンス
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-10-28.acacia',
});

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', c => chunks.push(c));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

/**
 * ✅ 正式仕様：XXXXXXXX-XXXXXXXX-XXXXXXXX（8-8-8）
 */
function generatePlainKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外
  const pick = (n) => {
    const bytes = crypto.randomBytes(n);
    let out = '';
    for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };
  return `${pick(8)}-${pick(8)}-${pick(8)}`;
}

/**
 * ✅ 正式仕様：HMAC-SHA256
 * DBにはこれを license_key_hash として保存する
 */
function hmacSha256Hex(text) {
  const secret = process.env.LICENSE_HMAC_SECRET;
  if (!secret) throw new Error('LICENSE_HMAC_SECRET is missing');
  return crypto.createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}

async function upsertCustomerByStripeCustomerId(stripeCustomerId, email) {
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from('customers')
    .insert({
      stripe_customer_id: stripeCustomerId,
      email: email || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

async function setAllLicensesStatusByStripeCustomer(stripeCustomerId, newStatus) {
  const { data: cust } = await supabase
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();

  if (!cust) return;

  await supabase
    .from('licenses')
    .update({ status: newStatus })
    .eq('customer_id', cust.id);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    const buf = await buffer(req);

    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('[webhook] signature error:', e?.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    console.log('[webhook] type=', event.type);

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;

      if (s.mode === 'subscription') {
        const stripeCustomerId = s.customer;
        const email = s.customer_details?.email || s.customer_email || null;
        const sessionId = s.id; // cs_test_...
        const plan = 'pro-monthly';

        const customerId = await upsertCustomerByStripeCustomerId(stripeCustomerId, email);

        // 二重発行防止：session_idで1回だけ
        const { data: exists, error: exErr } = await supabase
          .from('licenses')
          .select('id')
          .eq('session_id', sessionId)
          .maybeSingle();
        if (exErr) throw exErr;

        if (!exists) {
          const plainKey = generatePlainKey();              // ★ 8-8-8
          const licenseKeyHash = hmacSha256Hex(plainKey);   // ★ HMAC-SHA256

          const payload = {
            customer_id: customerId,
            license_key_hash: licenseKeyHash,
            plain_key: plainKey,
            status: 'active',
            plan,
            session_id: sessionId,
            email,
            issued_by: 'stripe',
          };

          const { error: insErr } = await supabase.from('licenses').insert(payload);
          if (insErr) throw insErr;

          console.log('[checkout.session.completed] license issued:', plainKey);
        } else {
          await supabase
            .from('licenses')
            .update({ status: 'active' })
            .eq('session_id', sessionId);
        }
      }
    }

    if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      await setAllLicensesStatusByStripeCustomer(inv.customer, 'active');
    }

    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      await setAllLicensesStatusByStripeCustomer(inv.customer, 'suspended');
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const map = {
        trialing: 'active',
        active: 'active',
        past_due: 'suspended',
        unpaid: 'suspended',
        canceled: 'canceled',
        incomplete: 'suspended',
        incomplete_expired: 'suspended',
      };
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