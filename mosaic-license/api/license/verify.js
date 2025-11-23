// api/license/verify.js
import { supabase } from '../../lib/_supabase.js';
import { hashLicense } from '../../lib/_crypto.js';

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", c => b += c);
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch(e){ reject(e); } });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { licenseKey } = await readJson(req);
    if (!licenseKey) return res.status(400).json({ valid: false, reason: "no_key" });

    const h = hashLicense(licenseKey);
    const { data } = await supabase
      .from("licenses")
      .select("status")
      .eq("license_key_hash", h)
      .limit(1);

    if (!data || data.length === 0) return res.json({ valid: false, reason: "not_found" });
    const status = data[0].status;
    res.json({ valid: status === "active", status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ valid: false, reason: "server_error" });
  }
}