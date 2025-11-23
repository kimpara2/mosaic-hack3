// lib/_crypto.js
import crypto from "node:crypto";

// ライセンスキー（表示用）生成
// 例: xxxxxxxx-xxxxxxxx-xxxxxxxx
export function generateKey() {
  const hex = crypto.randomBytes(16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}`;
}

// DB には生キーではなくハッシュを保存
export function hashKey(licenseKey) {
  return crypto
    .createHmac("sha256", process.env.LICENSE_SIGNING_SECRET)
    .update(licenseKey)
    .digest("hex");
}
