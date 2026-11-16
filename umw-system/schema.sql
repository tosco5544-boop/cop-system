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

-- =====================================================================
-- 初期データ（既にあれば何もしない）
-- =====================================================================
INSERT OR IGNORE INTO chat_channels (id, name, description, created_at) VALUES
  (1, '全体連絡', '全職員向けのお知らせ・連絡', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, '雑談',     '業務以外の気軽な話題',       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO wf_routes (id, name, steps_json, updated_at) VALUES
  ('r1', '稟議ルート（金額で分岐）', '[{"name":"課長承認","type":"deptTitle","target":"課長"},{"name":"部長承認","type":"deptTitle","target":"部長"},{"name":"経理部長確認","type":"title","target":"経理部長","cond":{"label":"金額","op":">=","value":100000}},{"name":"社長決裁","type":"title","target":"社長","cond":{"label":"金額","op":">=","value":1000000}}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('r2', '一般承認ルート', '[{"name":"課長承認","type":"deptTitle","target":"課長"},{"name":"部長承認","type":"deptTitle","target":"部長"}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('r3', '総務確認ルート', '[{"name":"課長承認","type":"deptTitle","target":"課長"},{"name":"総務確認","type":"title","target":"総務担当"}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO wf_forms (id, name, description, route_id, active, sort_order, fields_json, updated_at) VALUES
  ('f1', '稟議書', '設備投資・外注・契約など、決裁が必要な案件の申請', 'r1', 1, 1, '[{"id":"k1","label":"区分","type":"select","required":true,"options":["設備投資","外注・委託","契約締結","その他"]},{"id":"k2","label":"金額","type":"number","required":true,"unit":"円"},{"id":"k3","label":"目的・理由","type":"textarea","required":true},{"id":"k4","label":"支払先・契約先","type":"text","required":false},{"id":"k5","label":"実施希望日","type":"date","required":false}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('f2', '購買申請', '備品・消耗品・ソフトウェアなどの購入申請', 'r1', 1, 2, '[{"id":"k1","label":"品名","type":"text","required":true},{"id":"k2","label":"数量","type":"number","required":true,"unit":"個"},{"id":"k3","label":"金額","type":"number","required":true,"unit":"円"},{"id":"k4","label":"購入理由","type":"textarea","required":true},{"id":"k5","label":"希望納期","type":"date","required":false}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('f3', '休暇申請', '有給休暇・特別休暇・代休の申請', 'r2', 1, 3, '[{"id":"k1","label":"休暇種別","type":"select","required":true,"options":["年次有給休暇","特別休暇","代休"]},{"id":"k2","label":"開始日","type":"date","required":true},{"id":"k3","label":"終了日","type":"date","required":true},{"id":"k4","label":"理由・備考","type":"textarea","required":false}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('f4', '会議室・設備利用申請', '大会議室・社用車・貸出機材の利用申請', 'r3', 1, 4, '[{"id":"k1","label":"対象設備","type":"select","required":true,"options":["大会議室","社用車","プロジェクター","その他"]},{"id":"k2","label":"利用日","type":"date","required":true},{"id":"k3","label":"利用目的","type":"textarea","required":true}]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
