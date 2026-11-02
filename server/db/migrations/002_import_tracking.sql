-- =====================================================================
--  Migration 002 - import tracking (Stage 2)
--  Adds history and review items for Excel imports. It does NOT change any
--  Stage 1 rule: no existing column is altered or removed.
--
--  * import_batches   gets extra columns. "committed_sha256" is UNIQUE and is only
--                     filled in when an import succeeds, so the database itself
--                     refuses to commit the very same file twice.
--  * import_items     what each import created or (on purpose) overwrote.
--  * import_issues    warnings / pending reviews found during an import, kept so
--                     you can review them later.
-- =====================================================================

SET NAMES utf8mb4;

ALTER TABLE import_batches
  ADD COLUMN file_size        INT UNSIGNED NULL AFTER file_sha256,
  ADD COLUMN committed_sha256 CHAR(64) NULL COMMENT 'set only when committed; UNIQUE = the same file cannot be committed twice' AFTER status,
  ADD COLUMN committed_at     TIMESTAMP NULL AFTER committed_sha256,
  ADD COLUMN error_message    VARCHAR(500) NULL AFTER committed_at,
  ADD UNIQUE KEY uq_import_committed_sha (committed_sha256);

CREATE TABLE IF NOT EXISTS import_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id     INT UNSIGNED NOT NULL,
  entity_type  VARCHAR(40)  NOT NULL COMMENT 'driver, team, circuit, legacy_driver_totals, ...',
  natural_key  VARCHAR(200) NOT NULL,
  action       ENUM('created','updated') NOT NULL,
  before_json  JSON NULL,
  after_json   JSON NULL,
  PRIMARY KEY (id),
  KEY ix_items_batch (batch_id),
  CONSTRAINT fk_items_batch FOREIGN KEY (batch_id) REFERENCES import_batches (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_issues (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id      INT UNSIGNED NOT NULL,
  severity      ENUM('warning','pending_review','review_required') NOT NULL,
  code          VARCHAR(60)   NOT NULL,
  message       VARCHAR(1000) NOT NULL,
  details_json  JSON NULL,
  status        ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  resolved_note VARCHAR(255) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at   TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY ix_issues_status (status),
  KEY ix_issues_batch (batch_id),
  CONSTRAINT fk_issues_batch FOREIGN KEY (batch_id) REFERENCES import_batches (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
