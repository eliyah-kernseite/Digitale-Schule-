-- Schema der digitalen Schule. Alle Zeitstempel sind ISO-8601 in UTC.

CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash     TEXT NOT NULL,
  first_name        TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  email_verified_at TEXT,
  disabled_at       TEXT,
  totp_secret       TEXT,
  totp_enabled      INTEGER NOT NULL DEFAULT 0,
  totp_last_step    INTEGER NOT NULL DEFAULT 0,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,
  comp_access_until TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_pending  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tokens (
  id_hash    TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ref        TEXT,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id, kind);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL,
  customer_id              TEXT,
  subscription_id          TEXT UNIQUE,
  status                   TEXT NOT NULL,
  current_period_end       TEXT,
  cancel_at_period_end     INTEGER NOT NULL DEFAULT 0,
  started_at               TEXT,
  updated_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS subscriptions_customer ON subscriptions(customer_id);

CREATE TABLE IF NOT EXISTS subjects (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  tagline      TEXT NOT NULL,
  description  TEXT NOT NULL,
  level_title  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'soon' CHECK (status IN ('live', 'soon')),
  sort         INTEGER NOT NULL DEFAULT 0,
  teacher_name TEXT NOT NULL DEFAULT '',
  teacher_bio  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS seminars (
  id             INTEGER PRIMARY KEY,
  subject_id     INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  block_title    TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  video_file     TEXT,
  video_mime     TEXT,
  video_duration INTEGER NOT NULL DEFAULT 0,
  chapters       TEXT NOT NULL DEFAULT '[]',
  task_type      TEXT NOT NULL DEFAULT 'text' CHECK (task_type IN ('text', 'check')),
  task_prompt    TEXT NOT NULL DEFAULT '',
  published      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (subject_id, position)
);

CREATE TABLE IF NOT EXISTS seminar_progress (
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seminar_id      INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
  watched_seconds REAL NOT NULL DEFAULT 0,
  last_beat_at    INTEGER NOT NULL DEFAULT 0,
  video_done_at   TEXT,
  PRIMARY KEY (user_id, seminar_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seminar_id   INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE (user_id, seminar_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seminar_id INTEGER REFERENCES seminars(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_user_seminar ON reviews(user_id, seminar_id) WHERE seminar_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_user_school ON reviews(user_id) WHERE seminar_id IS NULL;

CREATE TABLE IF NOT EXISTS self_tests (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week          INTEGER NOT NULL CHECK (week IN (0, 12)),
  clarity       INTEGER NOT NULL CHECK (clarity BETWEEN 1 AND 10),
  confidence    INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 10),
  discipline    INTEGER NOT NULL CHECK (discipline BETWEEN 1 AND 10),
  calm          INTEGER NOT NULL CHECK (calm BETWEEN 1 AND 10),
  goal_progress INTEGER NOT NULL CHECK (goal_progress BETWEEN 1 AND 10),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, week)
);

CREATE TABLE IF NOT EXISTS goals (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_checkins (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS waitlist (
  id           INTEGER PRIMARY KEY,
  email        TEXT NOT NULL COLLATE NOCASE,
  subject_slug TEXT NOT NULL,
  confirmed_at TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (email, subject_slug)
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  published_at TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cancellations (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  wished_date  TEXT,
  reason       TEXT NOT NULL DEFAULT '',
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outcome      TEXT NOT NULL,
  requested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_links (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id INTEGER UNIQUE,
  joined_at        TEXT,
  revoked_at       TEXT
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_created ON audit_log(created_at);
