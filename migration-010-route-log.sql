CREATE TABLE IF NOT EXISTS wf_route_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, signature TEXT NOT NULL UNIQUE, steps_json TEXT NOT NULL, used_count INTEGER NOT NULL DEFAULT 0, first_used_at TEXT NOT NULL, last_used_at TEXT NOT NULL, last_used_by INTEGER, last_form_name TEXT );
CREATE INDEX IF NOT EXISTS idx_wf_route_log_last ON wf_route_log(last_used_at);
