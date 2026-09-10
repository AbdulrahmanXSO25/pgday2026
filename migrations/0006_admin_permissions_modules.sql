-- Migration 0006: align admin_permissions.module CHECK with packages/auth MODULES
-- 0002 used ('users','registrations','speakers','sessions','rooms','sponsors','cfp','media','publish','audit','events')
-- but the auth layer uses ('events','users','speakers','sessions','sponsors','registrations','media','cfp','publishing').
-- Rebuild the table so the DB constraint matches the code (WRITE→READ invariant preserved).

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS admin_permissions_new (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module     TEXT NOT NULL CHECK (module IN
             ('events','users','speakers','sessions','sponsors','registrations','media','cfp','publishing')),
  can_read   INTEGER NOT NULL DEFAULT 0 CHECK (can_read IN (0,1)),
  can_write  INTEGER NOT NULL DEFAULT 0 CHECK (can_write IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, module),
  CHECK (can_write = 0 OR can_read = 1)
);

INSERT OR IGNORE INTO admin_permissions_new (id, user_id, module, can_read, can_write, created_at, updated_at)
SELECT id, user_id,
  CASE module WHEN 'publish' THEN 'publishing' ELSE module END,
  can_read, can_write, created_at, updated_at
FROM admin_permissions
WHERE module IN ('events','users','speakers','sessions','sponsors','registrations','media','cfp','publishing','publish');

DROP TABLE IF EXISTS admin_permissions;
ALTER TABLE admin_permissions_new RENAME TO admin_permissions;

CREATE INDEX IF NOT EXISTS idx_admin_permissions_user_id ON admin_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_permissions_module ON admin_permissions(module);

PRAGMA foreign_keys = ON;