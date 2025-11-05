-- ライセンスキーと端末IDの使用履歴を記録するテーブル
-- トライアル用ライセンスキーが同じ端末で再使用されないようにするため

CREATE TABLE IF NOT EXISTS license_device_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  license_key_hash TEXT NOT NULL, -- ライセンスキーのハッシュ
  device_id TEXT NOT NULL, -- ハッシュ化された端末ID
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- 使用日時
  UNIQUE(license_key_hash, device_id) -- 同じライセンスキーと端末IDの組み合わせは1回のみ
);

-- インデックスを作成（検索高速化）
CREATE INDEX IF NOT EXISTS idx_license_device_usage_key_hash ON license_device_usage(license_key_hash);
CREATE INDEX IF NOT EXISTS idx_license_device_usage_device_id ON license_device_usage(device_id);

-- コメントを追加
COMMENT ON TABLE license_device_usage IS 'ライセンスキーと端末IDの使用履歴を記録（トライアル用ライセンスキーの再使用防止）';
COMMENT ON COLUMN license_device_usage.license_key_hash IS 'ライセンスキーのハッシュ値';
COMMENT ON COLUMN license_device_usage.device_id IS 'SHA256ハッシュ化された端末ID';
COMMENT ON COLUMN license_device_usage.used_at IS 'ライセンスキーが使用された日時';

