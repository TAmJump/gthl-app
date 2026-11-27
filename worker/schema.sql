-- GO TO HAPPY LIFE 生活支援アプリ D1 スキーマ
-- 方針: 12桁の個人番号・カード番号は保存しない。要配慮情報は暗号化して保存する。

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,                 -- 例: GTHL-000001
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- member / staff / admin
  name TEXT NOT NULL,
  name_kana TEXT,
  birthdate TEXT,
  phone TEXT,
  address_enc TEXT,                    -- 暗号化
  emergency_enc TEXT,                  -- 暗号化（緊急連絡先）
  lang TEXT DEFAULT 'ja',
  identity_status TEXT NOT NULL DEFAULT 'unverified', -- unverified / verified
  identity_method TEXT,                -- jpki / staff_check など
  identity_at TEXT,
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active / withdrawn
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,                 -- 証明番号
  member_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,     -- 照会URLのトークン（ハッシュのみ保存）
  scope TEXT NOT NULL DEFAULT 'identity_registration',
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cert_member ON certificates(member_id);

CREATE TABLE IF NOT EXISTS cert_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_id TEXT NOT NULL,
  looked_at TEXT NOT NULL,
  result TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  catalog_id INTEGER NOT NULL,         -- 240項目のID（1〜240）
  catalog_name TEXT NOT NULL,
  note_enc TEXT,
  preferred_at TEXT,
  status TEXT NOT NULL DEFAULT 'received', -- received / quoted / approved / started / done / cancelled
  quote_amount INTEGER,
  quote_note TEXT,
  approved_at TEXT,
  assignee TEXT,
  received_at TEXT NOT NULL,
  started_at TEXT,
  done_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_member ON requests(member_id);
CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status);

CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  name TEXT NOT NULL,
  species TEXT,
  birth_year INTEGER,
  alive INTEGER NOT NULL DEFAULT 1,    -- 以前のペット（遺骨・供養）も登録できる
  vet TEXT,
  care_enc TEXT,                       -- 食事・投薬（暗号化）
  caretaker TEXT,                      -- 緊急引取先
  caretaker_consent INTEGER NOT NULL DEFAULT 0,
  after_wish TEXT,                     -- 飼い主死亡時の希望／遺骨・供養の希望
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pets_member ON pets(member_id);

CREATE TABLE IF NOT EXISTS wishes (
  member_id TEXT PRIMARY KEY,
  medical_enc TEXT,                    -- 医療・延命の希望（代理同意ではない）
  contact_enc TEXT,                    -- 連絡してほしい人
  funeral TEXT,                        -- 葬儀・納骨の希望
  belongings TEXT,                     -- 遺品・住まいの希望
  message_enc TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  provider TEXT NOT NULL,              -- 契約先（他社を含む）
  category TEXT NOT NULL,              -- 死後事務 / 生活支援 / 身元保証 / 財産管理 / 任意後見 / 遺言
  signed_on TEXT,
  ends_on TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contracts_member ON contracts(member_id);

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  member_id TEXT,                      -- 非会員の寄付も可
  amount INTEGER NOT NULL,
  frequency TEXT NOT NULL,             -- once / monthly
  provider TEXT NOT NULL DEFAULT 'square',
  provider_ref TEXT,                   -- Square の order_id
  status TEXT NOT NULL DEFAULT 'pending', -- pending / paid / cancelled
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_don_ref ON donations(provider_ref);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT,                          -- member_id / 'public' / 'system'
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters(name, value) VALUES ('member', 0), ('cert', 0);
