ALTER TABLE facilities ADD COLUMN company TEXT NOT NULL DEFAULT '';
UPDATE facilities SET company = 'G社' WHERE company = '';
INSERT OR IGNORE INTO facilities (name, company, sort_order, created_at) VALUES ('籠上', 'T社', 14, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ('本社', 'T社', 15, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ('金谷', 'T社', 16, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ('山梨', 'T社', 17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE facilities SET company = 'T社' WHERE name IN ('籠上', '本社', '金谷', '山梨');
