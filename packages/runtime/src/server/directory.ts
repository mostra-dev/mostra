/**
 * A remote server's directory ledger, `server.sqlite` (DATA_MODEL §7.1): what spans hosted homes,
 * and only that. Accounts and their sign-in identities, the homes and the instances linked to
 * them, the hosted routes and every label ever issued, which home holds which version file, and
 * the authorization server's clients, grants and tokens (stored only as SHA-256 hashes).
 */
import type { Migration } from "../ledger/index.ts";

/** The server directory's migrations: their own list, apart from a home's. */
export const SERVER_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "server directory",
    up(db) {
      db.exec(`
        CREATE TABLE account (
          id TEXT PRIMARY KEY,
          name TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
          created_at TEXT NOT NULL
        );
        CREATE TABLE identity (
          provider TEXT NOT NULL,
          subject TEXT NOT NULL,
          account_id TEXT NOT NULL REFERENCES account(id),
          email TEXT,
          name TEXT,
          linked_at TEXT NOT NULL,
          PRIMARY KEY (provider, subject)
        );
        CREATE TABLE home (
          id TEXT PRIMARY KEY,
          owner_account_id TEXT NOT NULL UNIQUE REFERENCES account(id),
          data_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          suspended_at TEXT
        );
        CREATE TABLE instance_link (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES account(id),
          home_id TEXT NOT NULL REFERENCES home(id),
          name TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          relay_high INTEGER NOT NULL DEFAULT 0,
          linked_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE UNIQUE INDEX instance_link_default ON instance_link(account_id) WHERE is_default = 1;
        CREATE TABLE home_cursor (
          home_id TEXT PRIMARY KEY REFERENCES home(id),
          incarnation TEXT NOT NULL,
          high_cursor INTEGER NOT NULL,
          relay_high INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE artifact_route (
          id TEXT PRIMARY KEY,
          home_id TEXT NOT NULL REFERENCES home(id),
          artifact_id TEXT NOT NULL,
          owner_link_id TEXT NOT NULL REFERENCES instance_link(id),
          label TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          UNIQUE (home_id, artifact_id)
        );
        CREATE TABLE label_issued (
          label TEXT PRIMARY KEY,
          home_id TEXT NOT NULL,
          route_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('server', 'operator')),
          issued_at TEXT NOT NULL
        );
        -- A label is issued once, forever: never deleted, never moved to another home.
        CREATE TRIGGER label_issued_kept BEFORE DELETE ON label_issued
        BEGIN
          SELECT RAISE(ABORT, 'an issued label is kept forever');
        END;
        CREATE TRIGGER label_issued_fixed BEFORE UPDATE ON label_issued
          WHEN NEW.label IS NOT OLD.label OR NEW.home_id IS NOT OLD.home_id
        BEGIN
          SELECT RAISE(ABORT, 'an issued label never moves');
        END;
        CREATE TABLE home_file (
          home_id TEXT NOT NULL REFERENCES home(id),
          sha256 TEXT NOT NULL,
          PRIMARY KEY (home_id, sha256)
        );
        CREATE TABLE file_ref (
          sha256 TEXT PRIMARY KEY,
          homes INTEGER NOT NULL CHECK (homes >= 0),
          unreferenced_at TEXT
        );
        CREATE TABLE oauth_client (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('metadata', 'registered', 'shell', 'cli')),
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_used_at TEXT
        );
        CREATE TABLE consent (
          account_id TEXT NOT NULL REFERENCES account(id),
          client_id TEXT NOT NULL REFERENCES oauth_client(id),
          granted_at TEXT NOT NULL,
          revoked_at TEXT,
          PRIMARY KEY (account_id, client_id)
        );
        CREATE TABLE sender_shown (
          account_id TEXT NOT NULL,
          home_id TEXT NOT NULL,
          at TEXT NOT NULL,
          PRIMARY KEY (account_id, home_id)
        );
        CREATE TABLE "grant" (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES account(id),
          client_id TEXT NOT NULL REFERENCES oauth_client(id),
          scope TEXT NOT NULL,
          resource TEXT NOT NULL,
          link_id TEXT REFERENCES instance_link(id),
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE TABLE token (
          hash TEXT PRIMARY KEY,
          grant_id TEXT REFERENCES "grant"(id),
          kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh', 'device', 'code')),
          expires_at TEXT NOT NULL,
          used_at TEXT,
          successor_hash TEXT,
          data_json TEXT
        );
        CREATE TABLE outbound (
          id TEXT PRIMARY KEY,
          port TEXT NOT NULL CHECK (port IN ('metering', 'events')),
          payload_json TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT NOT NULL
        );
      `);
    },
  },
];
