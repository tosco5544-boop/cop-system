-- =====================================================================
-- UMW 社内システム  D1 スキーマ
--   適用: npx wrangler d1 execute umw-db --remote --file=./schema.sql
--   または Cloudflare ダッシュボード > D1 > umw-db > Console に貼り付けて実行
--   ※ 何度実行しても既存データは消えません（IF NOT EXISTS / INSERT OR IGNORE）
-- 日時はすべて UTC の ISO8601 文字列（例: 2026-11-16T05:07:00.000Z）
-- 勤務日（work_date）は日本時間の日付（YYYY-MM-DD）
-- =====================================================================

-- ---------- 基盤：社員・セッション・ログイン試行・操作ログ ----------
CREATE TABLE IF NOT EXISTS employees (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code        TEXT NOT NULL UNIQUE,              -- 社員ID（ログインID）
  name                 TEXT NOT NULL,
  dept                 TEXT NOT NULL DEFAULT '',          -- 部署
  title                TEXT NOT NULL DEFAULT '',          -- 役職（ワークフローの承認者判定に使用）
  role                 TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin')),
  password_hash        TEXT NOT NULL,                     -- PBKDF2-SHA256
  must_change_password INTEGER NOT NULL DEFAULT 1,        -- 1: 次回ログイン時に変更を強制
  active               INTEGER NOT NULL DEFAULT 1,        -- 0: 退職・無効
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,                           -- Cookie のトークンの SHA-256（生トークンは保存しない）
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL CHECK (scope IN ('staff', 'admin')),  -- どちらの入口からログインしたか
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_employee ON sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT NOT NULL,
  ip            TEXT,
  success       INTEGER NOT NULL,
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_code ON login_attempts(employee_code, at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip   ON login_attempts(ip, at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  actor_id INTEGER,                                       -- 操作した社員（employees.id）
  action   TEXT NOT NULL,                                 -- 例: auth.login / employee.create / attendance.edit
  target   TEXT,
  detail   TEXT,                                          -- JSON
  ip       TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, actor_id, at);

-- ---------- 勤怠 ----------
CREATE TABLE IF NOT EXISTS attendance_days (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  work_date     TEXT NOT NULL,                            -- 出勤した日（日本時間）
  clock_in      TEXT,
  clock_out     TEXT,
  break_start   TEXT,                                     -- 休憩中のときだけ値が入る
  break_minutes INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  modified_by   INTEGER,                                  -- 管理者が修正した場合の社員ID
  updated_at    TEXT NOT NULL,
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_days(work_date);

CREATE TABLE IF NOT EXISTS attendance_punches (            -- 打刻の生ログ（改ざん防止・確認用）
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type        TEXT NOT NULL CHECK (type IN ('in', 'out', 'break_start', 'break_end')),
  at          TEXT NOT NULL,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_punches_employee ON attendance_punches(employee_id, at);

-- ---------- チャット ----------
CREATE TABLE IF NOT EXISTS chat_channels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL REFERENCES chat_channels(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  edited_at   TEXT,                                       -- 編集・削除した日時（ポーリングで変更を検知）
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_edited  ON chat_messages(channel_id, edited_at);

CREATE TABLE IF NOT EXISTS chat_reads (
  employee_id  INTEGER NOT NULL,
  channel_id   INTEGER NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (employee_id, channel_id)
);

-- ---------- ワークフロー ----------
CREATE TABLE IF NOT EXISTS wf_routes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',                  -- [{name,type:'deptTitle'|'title'|'user',target,cond?:{label,op,value}}]
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wf_forms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  route_id    TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 99,
  fields_json TEXT NOT NULL DEFAULT '[]',                 -- [{id,label,type,required,options?,unit?}]
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wf_requests (
  id           TEXT PRIMARY KEY,
  no           TEXT UNIQUE,                               -- 申請番号（申請時に採番）
  form_id      TEXT,
  form_name    TEXT NOT NULL,
  fields_json  TEXT NOT NULL,                             -- 申請時点の書式のコピー
  title        TEXT NOT NULL,
  values_json  TEXT NOT NULL DEFAULT '{}',
  applicant_id INTEGER NOT NULL REFERENCES employees(id),
  status       TEXT NOT NULL CHECK (status IN ('draft','pending','approved','rejected','returned','withdrawn')),
  current_step INTEGER NOT NULL DEFAULT -1,
  steps_json   TEXT NOT NULL DEFAULT '[]',                -- 確定した承認ステップ
  created_at   TEXT NOT NULL,
  submitted_at TEXT,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_requests_status    ON wf_requests(status);
CREATE INDEX IF NOT EXISTS idx_wf_requests_applicant ON wf_requests(applicant_id);

CREATE TABLE IF NOT EXISTS wf_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES wf_requests(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  by_id      INTEGER NOT NULL,
  action     TEXT NOT NULL,                               -- draft/submit/resubmit/approved/rejected/returned/withdrawn
  step       TEXT,
  comment    TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_history_request ON wf_history(request_id, id);

CREATE TABLE IF NOT EXISTS wf_route_log (                 -- 申請で実際に使われた承認ルートの記録（同じ並びは1行にまとめて回数を数える）
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  signature      TEXT NOT NULL UNIQUE,                    -- 承認者IDとステップ名の並び
  steps_json     TEXT NOT NULL,                           -- [{name, approverId, approverName}]
  used_count     INTEGER NOT NULL DEFAULT 0,
  first_used_at  TEXT NOT NULL,
  last_used_at   TEXT NOT NULL,
  last_used_by   INTEGER,
  last_form_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_route_log_last ON wf_route_log(last_used_at);

-- ---------- 施設・打刻端末（ログイン不要の打刻） ----------
CREATE TABLE IF NOT EXISTS facilities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,                        -- 施設名（社員の「部署」と同じ表記）
  company    TEXT NOT NULL DEFAULT '',                    -- 会社（G社、親会社T社、孫会社F社）
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kiosks (                       -- 施設の打刻用パソコン（ブラウザ）
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash   TEXT NOT NULL UNIQUE,                      -- 端末の Cookie に入れたトークンの SHA-256
  facility_id  INTEGER NOT NULL REFERENCES facilities(id),
  name         TEXT NOT NULL DEFAULT '',                  -- 例：大岩の打刻用PC
  created_by   INTEGER,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kiosks_facility ON kiosks(facility_id);

-- ---------- 事務員（勤怠管理の担当者） ----------
CREATE TABLE IF NOT EXISTS clerks (                       -- ここにある社員は「事務員用ログイン」から勤怠管理ができる
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id),
  created_at  TEXT NOT NULL
);

-- ---------- 延べ利用者数（デイサービスの日次利用者数。管理者のみ） ----------
CREATE TABLE IF NOT EXISTS ua_facilities (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,                            -- 施設名（社内システムの施設名と同じ表記にすると施設長が入力できる）
  sort_order INTEGER NOT NULL DEFAULT 0,
  cap_3h     INTEGER NOT NULL DEFAULT 0,                  -- 3H（午前・午後）の定員
  cap_7h     INTEGER NOT NULL DEFAULT 0,                  -- 7Hの定員
  use_am     INTEGER NOT NULL DEFAULT 1,
  use_pm     INTEGER NOT NULL DEFAULT 1,
  use_7h     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ua_daily_records (             -- 1施設・1日で1行。行がある日＝営業日
  facility_id INTEGER NOT NULL REFERENCES ua_facilities(id),
  date        TEXT    NOT NULL,
  am_support  INTEGER,                                    -- 午前 要支援
  am_care     INTEGER,                                    -- 午前 要介護
  pm_support  INTEGER,                                    -- 午後 要支援
  pm_care     INTEGER,                                    -- 午後 要介護
  full_care   INTEGER,                                    -- 7H 要介護
  updated_at  TEXT    NOT NULL,
  updated_by  INTEGER,                                    -- 入力した社員（employees.id）
  PRIMARY KEY (facility_id, date)
);
CREATE INDEX IF NOT EXISTS idx_ua_daily_records_date ON ua_daily_records(date);

-- =====================================================================
-- 初期データ（既にあれば何もしない）
-- =====================================================================
INSERT OR IGNORE INTO chat_channels (id, name, description, created_at) VALUES
  (1, '全体連絡', '全職員向けのお知らせ・連絡', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, '雑談',     '業務以外の気軽な話題',       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO wf_routes (id, name, steps_json, updated_at) VALUES
  ('r1', '稟議ルート（金額で分岐）', '[{"name":"施設長承認","type":"deptTitle","target":"施設長"},{"name":"事業部長承認","type":"title","target":"事業部長"},{"name":"経理確認","type":"title","target":"経理責任者","cond":{"label":"金額","op":">=","value":100000}},{"name":"社長決裁","type":"title","target":"社長","cond":{"label":"金額","op":">=","value":1000000}}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO wf_forms (id, name, description, route_id, active, sort_order, fields_json, updated_at) VALUES
  ('f1', '稟議書', '設備投資・外注・契約など、決裁が必要な案件の申請', 'r1', 1, 1, '[{"id":"k1","label":"区分","type":"select","required":true,"options":["設備投資","外注・委託","契約締結","その他"]},{"id":"k2","label":"金額","type":"number","required":true,"unit":"円"},{"id":"k3","label":"目的・理由","type":"textarea","required":true},{"id":"k4","label":"支払先・契約先","type":"text","required":false},{"id":"k5","label":"実施希望日","type":"date","required":false}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('f2', '購買申請', '備品・消耗品・ソフトウェアなどの購入申請', 'r1', 1, 2, '[{"id":"k1","label":"品名","type":"text","required":true},{"id":"k2","label":"数量","type":"number","required":true,"unit":"個"},{"id":"k3","label":"金額","type":"number","required":true,"unit":"円"},{"id":"k4","label":"購入理由","type":"textarea","required":true},{"id":"k5","label":"希望納期","type":"date","required":false}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO facilities (name, company, sort_order, created_at) VALUES
  ('大岩', 'G社', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('焼津', 'G社', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('清水銀座', 'G社', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('緑町', 'G社', 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('桜が丘', 'G社', 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('城西', 'G社', 6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ケアプランセンター 草薙', 'G社', 7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('元気ケア草薙', 'G社', 8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ケアプランセンター新川', 'G社', 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ケアプランセンター 沼津', 'G社', 10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('沼津', 'G社', 11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('元気ナーシングケア 草薙', 'G社', 12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ケアプランセンター 焼津', 'G社', 13, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('籠上', 'T社', 14, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('本社', 'T社', 15, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('金谷', 'T社', 16, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('山梨', 'T社', 17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO ua_facilities (id, name, sort_order, cap_3h, cap_7h, use_am, use_pm, use_7h) VALUES
  (1, '城西', 1, 50, 53, 1, 1, 1),
  (2, '焼津', 2, 45, 50, 1, 1, 1),
  (3, '桜が丘', 3, 30, 30, 1, 1, 1),
  (4, '籠上', 4, 25, 50, 1, 1, 1),
  (5, '緑町', 5, 18, 18, 1, 1, 1),
  (6, '大岩', 6, 30, 0, 1, 1, 0),
  (7, '清水銀座', 7, 30, 0, 1, 1, 0),
  (8, '沼津', 8, 25, 0, 1, 1, 0);
