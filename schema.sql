CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  name TEXT NOT NULL,
  token TEXT NOT NULL,
  grid TEXT NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  week TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_members_room ON members(room_code);
