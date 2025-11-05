import { stripe } from '../lib/_stripe.js';
import { supabase } from '../lib/_supabase.js';
import { generateLicenseKey, hashLicense } from '../lib/_crypto.js';

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", c => b += c);
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch(e){ reject(e); } });
  });
}

async function findOrCreateCustomer({ email, stripeCustomerId }) {
  let { data: cust } = await supabase
    .from("customers").select("*").eq("stripe_customer_id", stripeCustomerId).maybeSingle();
  if (!cust) {
    const ins = await supabase.from("customers")
      .insert({ email, stripe_customer_id: stripeCustomerId })
      .select().single();
    cust = ins.data;
  }
  return cust;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { sessionId } = await readJson(req);
    if (!sessionId) return res.status(400).json({ message: "session_idがありません" });

    // 1) Stripeセッション検証
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer"]
    });

    const ok =
      (session.status === "complete" || session.payment_status === "paid") &&
      session.mode === "subscription";
    if (!ok) return res.status(400).json({ message: "支払い未完了です" });

    const email = session.customer_details?.email;
    const stripeCustomerId = typeof session.customer === "string"
      ? session.customer : session.customer?.id;

    // 2) 同じ session_id で発行済みなら再利用（冪等化）
    const { data: existing } = await supabase
      .from("licenses")
      .select("plain_key")
      .eq("session_id", session.id)
      .maybeSingle();

    if (existing?.plain_key) {
      return res.json({ licenseKey: existing.plain_key, downloadUrl: process.env.DOWNLOAD_URL });
    }

    // 3) 顧客取得/作成
    const customer = await findOrCreateCustomer({ email, stripeCustomerId });

    // 4) ライセンス発行＆保存
    const plainKey = generateLicenseKey();
    const keyHash = hashLicense(plainKey);

    await supabase.from("licenses").insert({
      customer_id: customer.id,
      license_key_hash: keyHash,
      plain_key: plainKey,    // 初期運用は保持（後で消す運用OK）
      status: "active",
      plan: "pro-monthly",
      session_id: session.id
    });

    // 5) 成功レスポンス
    res.json({ licenseKey: plainKey, downloadUrl: process.env.DOWNLOAD_URL });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "発行に失敗しました。サポートへご連絡ください。" });
  }
}
