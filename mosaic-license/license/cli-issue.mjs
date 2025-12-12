// C:\Users\kimpa\Desktop\mosaic-license\license\cli-issue.mjs

import 'dotenv/config';
import { supabase } from '../lib/_supabase.js';
import { generateKey, hashKey } from '../lib/_crypto.js';

async function main() {
  console.log("=== CLI License Issue Tool ===");

  // 1. 生ライセンスキー生成（表示用）
  const rawKey = generateKey();
  const hashedKey = hashKey(rawKey);

  console.log("Generated License Key:", rawKey);
  console.log("Hashed:", hashedKey);

  // 2. Supabase に保存
  const { data, error } = await supabase
    .from("licenses")
    .insert({
      plain_key: rawKey,           // ← ここがライセンスキー列っぽい
      license_key_hash: hashedKey, // ← verify.js が見るのはこっち
      status: "active",
      issued_by: "cli",
    })
    .select()
    .single();

  if (error) {
    console.error("Supabase insert error:", error.message);
    process.exit(1);
  }

  console.log("Inserted Record ID:", data.id);
  console.log("=== DONE ===");
}

main();
