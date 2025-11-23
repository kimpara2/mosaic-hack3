// mosaic-license/api/manual-issue.js

import { supabase } from "../lib/_supabase.js";
import { generateKey, hashKey } from "../lib/_crypto.js";

const ADMIN_TOKEN = process.env.LICENSE_ADMIN_TOKEN;

/**
 * 管理者用：ライセンスキー手動発行 API
 * POST /api/manual-issue
 * Headers:
 *   x-admin-token: <管理用の秘密トークン>
 * Body(JSON):
 *   { "email": "user@example.com", "plan": "pro" }
 */
export default async function handler(req, res) {
  console.log("[manual-issue] start", { method: req.method });

  // メソッドチェック
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 管理用トークンチェック
  const tokenFromHeader = req.headers["x-admin-token"];
  if (!ADMIN_TOKEN || tokenFromHeader !== ADMIN_TOKEN) {
    console.warn("[manual-issue] invalid admin token", {
      hasEnv: !!ADMIN_TOKEN,
      tokenFromHeader,
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  // body パース（念のため string でも対応）
  let body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = body ? JSON.parse(body) : {};
    } catch (e) {
      console.error("[manual-issue] JSON parse error", e);
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const { email, plan } = body || {};
  if (!email || !plan) {
    return res.status(400).json({ error: "email and plan are required" });
  }

  try {
    // 生ライセンスキー生成
    const rawKey = generateKey();
    // ハッシュ化して DB 保存用に
    const hashedKey = hashKey(rawKey);

    // ここはあなたの Supabase のテーブル構成に合わせて
    const { data, error } = await supabase
      .from("licenses") // ← テーブル名（必要なら変更）
      .insert({
        email,
        plan,
        license_key_hash: hashedKey, // カラム名も環境に合わせて
        issued_by: "manual",
      })
      .select()
      .single();

    if (error) {
      console.error("[manual-issue] Supabase insert error", error);
      return res.status(500).json({
        error: "Supabase insert error",
        details: error.message,
      });
    }

    console.log("[manual-issue] success", data.id);

    // 生キーはレスポンスだけに載せて、DBには保存しない
    return res.status(200).json({
      success: true,
      licenseKey: rawKey, // ← これを控えてユーザーに渡す
      recordId: data.id,
    });
  } catch (err) {
    console.error("[manual-issue] unexpected error", err);
    return res.status(500).json({
      error: "Internal Server Error",
      details: err.message,
    });
  }
}


