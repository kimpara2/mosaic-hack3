// api/issue-license.js
import { supabase } from '../lib/_supabase.js';

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ message: "session_idがありません" });
    }

    const { data: lic, error } = await supabase
      .from("licenses")
      .select("plain_key, status")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      console.error(error);
      return res.status(500).json({ message: "DBエラー" });
    }

    if (!lic) {
      return res.status(404).json({
        message: "ライセンス準備中です。数秒後に再読み込みしてください。",
        downloadUrl: process.env.DOWNLOAD_URL,
      });
    }

    return res.json({
      licenseKey: lic.plain_key,
      downloadUrl: process.env.DOWNLOAD_URL,
      status: lic.status,
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "サーバーエラー" });
  }
}