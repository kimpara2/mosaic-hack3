import crypto from "node:crypto";

// 表示用ライセンスキー生成（例：xxxxxxxx-xxxxxxxx-xxxxxxxx）
export function generateLicenseKey() {
  const hex = crypto.randomBytes(16).toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,16)}-${hex.slice(16,24)}`;
}

// DBには生キーではなくハッシュを保存
export function hashLicense(licenseKey) {
  return crypto
    .createHmac("sha256", process.env.LICENSE_SIGNING_SECRET)
    .update(licenseKey)
    .digest("hex");
}