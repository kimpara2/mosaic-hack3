import supabase from "../lib/_supabase.js";
import { generateKey, hashKey } from "../lib/_crypto.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 管理者チェック
  const adminToken = req.headers["x-admin-token"];
  if (adminToken !== process.env.ADMIN_LICENSE_ISSUE_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { email, plan = "pro" } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const plainKey = generateKey();
  const keyHash = hashKey(plainKey);

  const { error } = await supabase
    .from("licenses")
    .insert({
      email: email.toLowerCase(),
      plan,
      key_hash: keyHash,
      status: "active",
      issued_at: new Date()
    });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "DB insert error" });
  }

  return res.status(200).json({
    ok: true,
    license_key: plainKey,
    plan
  });
}

