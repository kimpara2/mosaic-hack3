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
    const { licenseKey, device } = await readJson(req);
    if (!licenseKey) return res.status(400).json({ valid: false, reason: "no_key" });

    const h = hashLicense(licenseKey);
    const { data } = await supabase
      .from("licenses")
      .select("status, plan")
      .eq("license_key_hash", h)
      .limit(1);

    if (!data || data.length === 0) return res.json({ valid: false, reason: "not_found" });
    
    const status = data[0].status;
    const plan = data[0].plan;
    
    // 解約済みの場合は無効
    if (status === "canceled") {
      return res.json({ valid: false, reason: "canceled", status });
    }
    
    // トライアル用ライセンスキーの場合、端末IDで再使用をチェック
    const isTrialLicense = plan === "trial" || plan === "trial-monthly" || plan?.includes("trial");
    
    if (isTrialLicense && device) {
      // このライセンスキーと端末IDの組み合わせが既に使用されているかチェック
      const { data: existingUsage } = await supabase
        .from("license_device_usage")
        .select("device_id")
        .eq("license_key_hash", h)
        .eq("device_id", device)
        .maybeSingle();
      
      if (existingUsage) {
        // 既にこの端末でこのトライアル用ライセンスキーが使われている
        return res.json({ 
          valid: false, 
          reason: "trial_already_used", 
          status,
          message: "この端末では既にトライアルが使用されています。" 
        });
      }
      
      // 初回使用として記録
      await supabase
        .from("license_device_usage")
        .insert({
          license_key_hash: h,
          device_id: device,
          used_at: new Date().toISOString()
        });
    }
    
    // 有効なライセンス（statusがactive、または期限切れでもトライアルでない場合は有効）
    res.json({ valid: status === "active", status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ valid: false, reason: "server_error" });
  }
}