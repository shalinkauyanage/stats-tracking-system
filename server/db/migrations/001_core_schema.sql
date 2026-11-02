-- =====================================================================
--  F1 Career Archive - core schema (migration 001)
--  Requires MySQL 8.0.16 or newer (CHECK constraints are enforced from 8.0.16).
--
--  HOW THE DATA IS ORGANISED (read this first)
--  1. PERMANENT IDENTITIES:  drivers, teams, circuits. A driver has NO team column.
--  2. SEASON DATA:           season_entries says "driver X drove for team Y in season Z".
--                            Standings, stats, titles and awards hang off a season.
--  3. LEGACY BASELINE:       legacy_* tables hold the numbers from your Excel file,
--                            exactly as imported. They never change when you add seasons.
--  4. CAREER TOTAL           = legacy baseline + every FINAL season that is NOT flagged
--                            seasons.in_legacy_baseline. (Calculated in JavaScript, see
--                            server/src/logic/careerTotals.js - nothing is stored twice.)
--  5. NULL means "unknown / not recorded". It is never silently turned into 0.
--  6. Everything that matters is RESTRICT (the default FK behaviour), so history
--     cannot be deleted by accident. There is no CASCADE anywhere. Three foreign
--     keys leave the words "ON DELETE RESTRICT" out on purpose: their columns are
--     also used in a CHECK constraint, and MySQL is strict about mixing the two.
--     Leaving the clause out gives exactly the same RESTRICT behaviour.
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. Permanent identities
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  display_name  VARCHAR(100) NOT NULL,
  name_key      VARCHAR(100) NOT NULL COMMENT 'lower-case, single-spaced, no accents: used to stop duplicates',
  nationality   VARCHAR(60)  NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1 COMMENT 'inactive drivers keep all their history',
  notes         TEXT         NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_drivers_name_key (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teams (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  name_key      VARCHAR(100) NOT NULL,
  colour_hex    CHAR(7)      NULL COMMENT 'optional, e.g. #E10600',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  notes         TEXT         NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_teams_name_key (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS circuits (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gp_name       VARCHAR(100) NOT NULL COMMENT 'Grand Prix label exactly as used in the workbook, e.g. Bahrain',
  name_key      VARCHAR(100) NOT NULL,
  circuit_name  VARCHAR(120) NULL COMMENT 'optional real circuit name; never guessed by the importer',
  country       VARCHAR(80)  NULL,
  sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_circuits_name_key (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. Seasons and season-specific driver/team assignments
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seasons (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  year                SMALLINT UNSIGNED NOT NULL,
  label               VARCHAR(60) NULL,
  status              ENUM('draft','final') NOT NULL DEFAULT 'draft'
                      COMMENT 'only FINAL seasons count towards career totals',
  in_legacy_baseline  TINYINT(1) NOT NULL DEFAULT 0
                      COMMENT '1 = this season is already inside the legacy totals, so it must not be added again',
  notes               TEXT NULL,
  finalized_at        TIMESTAMP NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_seasons_year (year),
  CONSTRAINT chk_seasons_year CHECK (year BETWEEN 1900 AND 2300)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row = "this driver drove for this team in this season".
-- A transfer simply creates a new row in a different season. Old rows are never touched.
CREATE TABLE IF NOT EXISTS season_entries (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id   INT UNSIGNED NOT NULL,
  driver_id   INT UNSIGNED NOT NULL,
  team_id     INT UNSIGNED NOT NULL,
  note        VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_entry_driver_per_season (season_id, driver_id),   -- one team per driver per season
  UNIQUE KEY uq_entry_id_season (id, season_id),                  -- lets other tables prove "same season"
  KEY ix_entries_driver (driver_id),
  KEY ix_entries_team (team_id),
  CONSTRAINT fk_entries_season FOREIGN KEY (season_id) REFERENCES seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_entries_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE RESTRICT,
  CONSTRAINT fk_entries_team   FOREIGN KEY (team_id)   REFERENCES teams (id)   ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. Final standings (points are typed in at season end, never calculated)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_standings (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id        INT UNSIGNED NOT NULL,
  season_entry_id  INT UNSIGNED NOT NULL,
  position         SMALLINT UNSIGNED NOT NULL,
  points           INT UNSIGNED NULL COMMENT 'NULL = not recorded',
  PRIMARY KEY (id),
  UNIQUE KEY uq_dstand_entry (season_entry_id),
  UNIQUE KEY uq_dstand_position (season_id, position),
  CONSTRAINT fk_dstand_entry FOREIGN KEY (season_entry_id, season_id)
    REFERENCES season_entries (id, season_id) ON DELETE RESTRICT,
  CONSTRAINT chk_dstand_position CHECK (position >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS constructor_standings (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id   INT UNSIGNED NOT NULL,
  team_id     INT UNSIGNED NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL,
  points      INT UNSIGNED NULL COMMENT 'NULL = not recorded',
  PRIMARY KEY (id),
  UNIQUE KEY uq_cstand_team (season_id, team_id),
  UNIQUE KEY uq_cstand_position (season_id, position),
  CONSTRAINT fk_cstand_season FOREIGN KEY (season_id) REFERENCES seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cstand_team   FOREIGN KEY (team_id)   REFERENCES teams (id)   ON DELETE RESTRICT,
  CONSTRAINT chk_cstand_position CHECK (position >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. Season achievements (every number is optional: NULL = unknown, not 0)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_season_stats (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_entry_id       INT UNSIGNED NOT NULL,
  wins                  SMALLINT UNSIGNED NULL,
  second_places         SMALLINT UNSIGNED NULL,
  third_places          SMALLINT UNSIGNED NULL,
  podiums               SMALLINT UNSIGNED NULL,
  poles                 SMALLINT UNSIGNED NULL,
  p1_fl_gp              SMALLINT UNSIGNED NULL COMMENT 'workbook column "P1 + FL + GP"; meaning kept as labelled',
  fastest_laps          SMALLINT UNSIGNED NULL,
  dnfs                  SMALLINT UNSIGNED NULL,
  sprint_wins           SMALLINT UNSIGNED NULL,
  sprint_podiums        SMALLINT UNSIGNED NULL,
  sprint_poles          SMALLINT UNSIGNED NULL,
  sprint_fastest_laps   SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dstats_entry (season_entry_id),
  CONSTRAINT fk_dstats_entry FOREIGN KEY (season_entry_id) REFERENCES season_entries (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_season_stats (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id             INT UNSIGNED NOT NULL,
  team_id               INT UNSIGNED NOT NULL,
  wins                  SMALLINT UNSIGNED NULL,
  podiums               SMALLINT UNSIGNED NULL,
  poles                 SMALLINT UNSIGNED NULL,
  fastest_laps          SMALLINT UNSIGNED NULL,
  sprint_wins           SMALLINT UNSIGNED NULL,
  sprint_podiums        SMALLINT UNSIGNED NULL,
  sprint_poles          SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tstats_team_season (season_id, team_id),
  CONSTRAINT fk_tstats_season FOREIGN KEY (season_id) REFERENCES seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tstats_team   FOREIGN KEY (team_id)   REFERENCES teams (id)   ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. Championship history = the Hall of Fame
--    team_id is the team the champion drove for THAT season; the names are copied
--    as snapshots so the card never changes if a driver or team is renamed later.
--    Rows can only be changed on purpose (see saveChampionship in hallOfFame.js).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS championship_history (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id              INT UNSIGNED NOT NULL,
  championship_type      ENUM('drivers','constructors') NOT NULL,
  driver_id              INT UNSIGNED NULL,
  team_id                INT UNSIGNED NOT NULL,
  points                 INT UNSIGNED NULL,
  driver_name_snapshot   VARCHAR(100) NULL,
  team_name_snapshot     VARCHAR(100) NOT NULL,
  correction_note        VARCHAR(255) NULL,
  last_corrected_at      TIMESTAMP NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_champ_season_type (season_id, championship_type),
  CONSTRAINT fk_champ_season FOREIGN KEY (season_id) REFERENCES seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_champ_driver FOREIGN KEY (driver_id) REFERENCES drivers (id),   -- default = RESTRICT (see note above)
  CONSTRAINT fk_champ_team   FOREIGN KEY (team_id)   REFERENCES teams (id)   ON DELETE RESTRICT,
  CONSTRAINT chk_champ_driver_rule CHECK (
    (championship_type = 'drivers'      AND driver_id IS NOT NULL AND driver_name_snapshot IS NOT NULL)
 OR (championship_type = 'constructors' AND driver_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS season_awards (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id   INT UNSIGNED NOT NULL,
  award_name  VARCHAR(120) NOT NULL,
  driver_id   INT UNSIGNED NULL,
  team_id     INT UNSIGNED NULL,
  notes       VARCHAR(255) NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_award_season FOREIGN KEY (season_id) REFERENCES seasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_award_driver FOREIGN KEY (driver_id) REFERENCES drivers (id),   -- default = RESTRICT
  CONSTRAINT fk_award_team   FOREIGN KEY (team_id)   REFERENCES teams (id),     -- default = RESTRICT
  CONSTRAINT chk_award_target CHECK (driver_id IS NOT NULL OR team_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. Circuit records and Grand Prix winners
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circuit_records (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  circuit_id      INT UNSIGNED NOT NULL,
  record_type     ENUM('race_fastest_lap','qualifying_pole','sprint_fastest_lap','sprint_pole') NOT NULL,
  driver_id       INT UNSIGNED NULL,
  team_id         INT UNSIGNED NULL,
  season_id       INT UNSIGNED NULL COMMENT 'filled in only when known',
  lap_time_ms     INT UNSIGNED NULL,
  lap_time_text   VARCHAR(20)  NULL COMMENT 'display text, e.g. 1:10.153',
  original_text   VARCHAR(255) NULL COMMENT 'exactly what the workbook said; never overwritten',
  review_status   ENUM('ok','pending_review','approved') NOT NULL DEFAULT 'ok',
  suggested_text  VARCHAR(20)  NULL COMMENT 'proposed correction, waiting for your approval',
  suggested_ms    INT UNSIGNED NULL,
  source          ENUM('legacy_import','manual') NOT NULL DEFAULT 'manual',
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_record_circuit_type (circuit_id, record_type),
  CONSTRAINT fk_record_circuit FOREIGN KEY (circuit_id) REFERENCES circuits (id) ON DELETE RESTRICT,
  CONSTRAINT fk_record_driver  FOREIGN KEY (driver_id)  REFERENCES drivers (id)  ON DELETE RESTRICT,
  CONSTRAINT fk_record_team    FOREIGN KEY (team_id)    REFERENCES teams (id)    ON DELETE RESTRICT,
  CONSTRAINT fk_record_season  FOREIGN KEY (season_id)  REFERENCES seasons (id)  ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Winners of each Grand Prix. The workbook has the ORDER of winners but no years,
-- so season_id starts empty and can be filled in later.
CREATE TABLE IF NOT EXISTS circuit_gp_winners (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  circuit_id   INT UNSIGNED NOT NULL,
  sequence_no  SMALLINT UNSIGNED NOT NULL,
  driver_id    INT UNSIGNED NOT NULL,
  season_id    INT UNSIGNED NULL,
  source       ENUM('legacy_import','manual') NOT NULL DEFAULT 'manual',
  PRIMARY KEY (id),
  UNIQUE KEY uq_gpwinner_order (circuit_id, sequence_no),
  CONSTRAINT fk_gpwinner_circuit FOREIGN KEY (circuit_id) REFERENCES circuits (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gpwinner_driver  FOREIGN KEY (driver_id)  REFERENCES drivers (id)  ON DELETE RESTRICT,
  CONSTRAINT fk_gpwinner_season  FOREIGN KEY (season_id)  REFERENCES seasons (id)  ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. Legacy baseline (the numbers from F1.xlsx, kept apart from season data)
--    NULL = the workbook had no usable value. "M.P.S" is stored as-is (mps);
--    its meaning has deliberately NOT been guessed.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legacy_driver_totals (
  driver_id            INT UNSIGNED NOT NULL,
  wins                 INT UNSIGNED NULL,
  second_places        INT UNSIGNED NULL,
  third_places         INT UNSIGNED NULL,
  podiums              INT UNSIGNED NULL,
  poles                INT UNSIGNED NULL,
  p1_fl_gp             INT UNSIGNED NULL,
  fastest_laps         INT UNSIGNED NULL,
  dnfs                 INT UNSIGNED NULL,
  mps                  INT UNSIGNED NULL,
  points               INT UNSIGNED NULL,
  drivers_titles       INT UNSIGNED NULL,
  constructors_titles  INT UNSIGNED NULL COMMENT 'titles the driver shared as a member of the winning team',
  source_file          VARCHAR(255) NULL,
  source_row           INT UNSIGNED NULL,
  imported_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (driver_id),
  CONSTRAINT fk_legacy_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS legacy_team_totals (
  team_id              INT UNSIGNED NOT NULL,
  wins                 INT UNSIGNED NULL,
  podiums              INT UNSIGNED NULL,
  poles                INT UNSIGNED NULL,
  mps                  INT UNSIGNED NULL,
  points               INT UNSIGNED NULL,
  drivers_titles       INT UNSIGNED NULL,
  constructors_titles  INT UNSIGNED NULL,
  source_file          VARCHAR(255) NULL,
  source_row           INT UNSIGNED NULL,
  imported_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id),
  CONSTRAINT fk_legacy_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Teams a driver has driven for, in order, with NO years (the workbook has none).
CREATE TABLE IF NOT EXISTS legacy_driver_team_history (
  driver_id    INT UNSIGNED NOT NULL,
  sequence_no  TINYINT UNSIGNED NOT NULL,
  team_id      INT UNSIGNED NOT NULL,
  PRIMARY KEY (driver_id, sequence_no),
  CONSTRAINT fk_ldth_driver FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ldth_team   FOREIGN KEY (team_id)   REFERENCES teams (id)   ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 8. Optional detailed race results (never required, never used to calculate points)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS race_results (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id        INT UNSIGNED NOT NULL,
  circuit_id       INT UNSIGNED NOT NULL,
  season_entry_id  INT UNSIGNED NOT NULL,
  finish_position  SMALLINT UNSIGNED NULL,
  grid_position    SMALLINT UNSIGNED NULL,
  fastest_lap      TINYINT(1) NULL,
  dnf              TINYINT(1) NULL,
  is_sprint        TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_result (season_id, circuit_id, season_entry_id, is_sprint),
  CONSTRAINT fk_result_circuit FOREIGN KEY (circuit_id) REFERENCES circuits (id) ON DELETE RESTRICT,
  CONSTRAINT fk_result_entry FOREIGN KEY (season_entry_id, season_id)
    REFERENCES season_entries (id, season_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 9. Safety net: imports and an edit log for corrections
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_batches (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_name     VARCHAR(255) NOT NULL,
  file_sha256   CHAR(64)     NOT NULL,
  status        ENUM('previewed','committed','failed') NOT NULL DEFAULT 'previewed',
  summary_json  JSON NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_import_sha (file_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS change_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  table_name  VARCHAR(64) NOT NULL,
  record_id   INT UNSIGNED NULL,
  action      VARCHAR(30) NOT NULL COMMENT 'e.g. correct_champion, unlock_season',
  old_json    JSON NULL,
  new_json    JSON NULL,
  note        VARCHAR(255) NULL,
  changed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_log_table (table_name, record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  setting_key    VARCHAR(60)  NOT NULL,
  setting_value  VARCHAR(255) NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
