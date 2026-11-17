CREATE TABLE IF NOT EXISTS clerks ( employee_id INTEGER PRIMARY KEY REFERENCES employees(id), created_at TEXT NOT NULL );
