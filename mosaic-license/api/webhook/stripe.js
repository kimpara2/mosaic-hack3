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

function generatePlainKey() {
  // 既存の形式があるならここを合わせてOK
  return `MH-${crypto.randomUUID()}`;
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function upsertCustomerByStripeCustomerId(stripeCustomerId, email) {
  // customers テーブルは「stripe_customer_id」を持ってる前提（あなたの既存コードもそう）
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

    /**
     * ✅ Checkout完了（success.html に session_id が渡ってくるのでここが超重要）
     * ここで licenses をINSERTしておくと success.html で表示できる
     */
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object; // checkout.session

      // サブスクのみ扱う（必要なら mode === 'payment' も追加可）
      if (s.mode === 'subscription') {
        const stripeCustomerId = s.customer; // cus_...
        const email = s.customer_details?.email || s.customer_email || null;
        const sessionId = s.id; // cs_test_...
        const plan = 'pro-monthly'; // ここは必要なら priceId で分岐して決めてOK

        const customerId = await upsertCustomerByStripeCustomerId(stripeCustomerId, email);

        // 二重発行防止：session_id（cs_...）で1回だけ発行
        const { data: exists, error: exErr } = await supabase
          .from('licenses')
          .select('id')
          .eq('session_id', sessionId)
          .maybeSingle();
        if (exErr) throw exErr;

        if (!exists) {
          const plainKey = generatePlainKey();
          const licenseKeyHash = sha256Hex(plainKey);

          const payload = {
            customer_id: customerId,
            license_key_hash: licenseKeyHash,
            plain_key: plainKey,
            status: 'active',
            plan,
            session_id: sessionId,
            // ↓ licenses に email / issued_by があるなら入れる（無ければ削ってOK）
            email,
            issued_by: 'stripe',
          };

          const { error: insErr } = await supabase.from('licenses').insert(payload);
          if (insErr) throw insErr;

          console.log('[checkout.session.completed] license issued:', sessionId);
        } else {
          // 念のため有効化
          await supabase.from('licenses')
            .update({ status: 'active' })
            .eq('session_id', sessionId);
        }
      }
    }

    /**
     * ✅ 請求が支払われた（毎月更新でも来る）
     * ここでは基本「active化」でOK（既にcheckoutで発行済みの想定）
     */
    if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      await setAllLicensesStatusByStripeCustomer(inv.customer, 'active');
    }

    /**
     * ❌ 支払い失敗 → 停止
     */
    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      await setAllLicensesStatusByStripeCustomer(inv.customer, 'suspended');
    }

    /**
     * 🔄 サブスク状態変更
     */
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

    /**
     * 🗑 解約
     */
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