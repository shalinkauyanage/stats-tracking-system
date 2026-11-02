# Changelog

## Stage 2: Excel importer (this version)

**Added**
* `server/src/import/`: ZIP, XML and .xlsx readers (no extra libraries), workbook layout checks, the import planner, executor and service, a MySQL repository and an in-memory repository (for tests), plain-text report, API handlers.
* `server/src/routes/importRoutes.js`: `/api/import/*` routes. `server/src/app.js` mounts them (the Stage 1 `/api/health` route is unchanged).
* `server/scripts/import-excel.js` and `npm run import:preview | import:commit | import:history`.
* `server/db/migrations/002_import_tracking.sql`: import history, review items, and a unique "this file was committed" key. It only adds; nothing from Stage 1 is altered.
* 86 new automated tests (163 in total) and 14 new MySQL tests (29 in total).
* `docs/IMPORTER.md`.

**Changed (backward compatible)**
* `legacyBuilder.js`: new option `blankPolicy` (`zero` default, as before, or `unknown`); a missing column is now unknown instead of 0; Excel error cells are no longer reported twice; the blank-cell note lists the exact cells.
* `schema.test.js`: the migration list now expects both 001 and 002.
* `package.json`: version 0.2.0, three `import:*` scripts, and the `test` / `test:db` scripts now use forms that work on every Node version (`node --test` and explicit file names). A bare folder name such as `node --test test/` is rejected by some Node versions (for example 22.22), although it worked on your PC.

**Unchanged**
* All 77 Stage 1 logic tests still pass without modification (apart from the migration list above).
* `001_core_schema.sql`, every Stage 1 rule, and the original `F1.xlsx` (same SHA-256).
