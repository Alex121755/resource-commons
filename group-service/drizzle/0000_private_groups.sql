CREATE TABLE groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL,
  invite_hash TEXT UNIQUE, invite_expires INTEGER
);
--> statement-breakpoint
CREATE TABLE members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  identity TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (group_id, identity)
);
--> statement-breakpoint
CREATE INDEX member_lookup ON members(identity);
--> statement-breakpoint
CREATE TABLE resources (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author TEXT NOT NULL, title TEXT NOT NULL, quantity INTEGER NOT NULL,
  note TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX resource_lookup ON resources(group_id, created_at);
