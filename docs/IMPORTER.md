# The Excel importer (Stage 2)

## What it does

Reads `F1.xlsx`, checks it, shows you a **preview**, and only then saves it. It fills the
**legacy baseline**: drivers, teams, Grands Prix, career totals, team history (without years),
Grand Prix winners and circuit records. It never touches seasons, standings, season stats or the Hall of Fame.

## The two steps

1. **Preview** (saves nothing): reads the file, validates it, compares it with what is already saved and lists what *would* happen.
2. **Commit** (needs `--yes`): reads the same file again, re-checks against the *current* database and saves everything in **one transaction** (all or nothing).
   Commit refuses if the file's fingerprint differs from the one you previewed.

## Commands (PowerShell, from the `server` folder)

```powershell
npm run import:preview -- ..\data\original\F1.xlsx          # look first
npm run import:commit  -- ..\data\original\F1.xlsx --yes    # then import
npm run import:history                                       # past imports + open review items
```

Options: `--blanks=unknown` (see below), `--ack=KEY` / `--ack-all`, `--overwrite=KEY` / `--overwrite-all`, `--no-db` (preview against an empty archive, no MySQL needed).

## What the checks catch

| Problem | What happens |
|---|---|
| Not an .xlsx, damaged, password-protected, over 25 MB | Refused with a plain message |
| Missing sheet, missing required column | **Blocked** |
| Excel error in a data cell (`#REF!`, `#DIV/0!`...) | **Blocked**, with the exact cell (e.g. `Driver Stats, cell B3`) |
| Blank driver name with data in the row | **Blocked** |
| Words, decimals or negatives in a number column | **Blocked** |
| Duplicate driver / team / Grand Prix in the file | **Blocked** |
| A winner or record holder who is not in Driver Stats | **Blocked** |
| Number stored as text (`"42"`) | Read as 42, **warning** |
| Content outside the data the importer reads | **Warning**, ignored |
| Team totals that disagree with driver totals | **Warning**, imported as written |
| Lap time typo (`01:11:775`) | **Pending your approval**: original kept, no time stored |
| A new name that looks like an existing one (`Max Verstapen`) | **Needs your acknowledgement** before importing |
| Legacy totals for a driver who already has finished seasons in the app | **Needs your acknowledgement** (double-counting risk) |

Excel "linked data types" (the Grand Prix names and flags in your file) look like `#VALUE!` to most programs. The importer recovers their real text, so they are **not** treated as errors.

## Safe re-importing

* The **same file** can never be committed twice (checked by fingerprint, and enforced by a unique key in MySQL).
* A **re-saved or edited file** is compared row by row using name keys (lower case, one space, no accents):
  * already saved and identical → **unchanged**, skipped
  * not saved yet → **created**
  * saved but different → **conflict**: the saved value is **kept** unless you choose `--overwrite=KEY` for that exact item. The old value is written to `change_log` first.
* Nothing is ever deleted. Things that exist only in the archive are left alone.
* An approved lap-time correction is not undone by a later import that still contains the original typo.

## Blank cells

Your workbook uses blank cells as zero in its count columns (this is proved by `wins + 2nd + 3rd = podiums` for all 22 drivers).
So by default blanks import as **0**, and the preview lists exactly which cells were treated that way (143 in your file).
If you would rather not assume anything, use `--blanks=unknown`: those cells are saved as **unknown (NULL)** and career totals show them as unknown.
`M.P.S` blanks are always unknown, and a missing column is always unknown.

## After an import

Warnings and pending items are saved as **open review items** (`npm run import:history` lists them). For your file there are 7:
the two Las Vegas lap times (pending your approval) and five Team Stats vs Driver Stats inconsistencies.
Nothing about them was changed. The screens to approve or resolve them arrive in a later stage.

## Web API (used by the app screens in Stage 4)

| Route | Purpose |
|---|---|
| `POST /api/import/preview` | body = the .xlsx file, header `X-File-Name`. Saves nothing |
| `POST /api/import/commit?confirm=yes&expected_sha256=...` | same body. Optional `blank_policy`, repeated `acknowledged`, `overwrite` |
| `GET /api/import/batches` | import history |
| `GET /api/import/issues?status=open` | review items |
