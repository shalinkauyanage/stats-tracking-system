# How the archive works (plain English)

## 1. Three kinds of data, kept apart

| Kind | Where | Can it change? |
|---|---|---|
| **Identities** | `drivers`, `teams`, `circuits` | A driver has **no team column**. A driver is one person forever. |
| **Legacy baseline** | `legacy_*` tables | Imported once from `F1.xlsx`. New seasons never modify it. |
| **Season data** | `seasons`, `season_entries`, standings, stats, `championship_history` | Typed at the end of each season. Editable later on purpose. |

## 2. Driver transfers

`season_entries` has one row per **driver + team + season**.

| season | driver | team |
|---|---|---|
| 2025 | Driver A | Ferrari |
| 2026 | Driver A | Mercedes |

* The database refuses a second row for the same driver in the same season.
* "Copy last season's line-up" creates **new** rows for the new season. The old rows are never touched.
* Standings, stats and titles point at the season entry, so they stay with the team they were earned with.
* A driver who leaves simply has no entry in later seasons. Their history stays.

## 3. Career totals (and why nothing is counted twice)

```
career total = legacy baseline
             + every season that is FINAL and NOT marked "already in legacy"
```

Example with real numbers: Max Verstappen has **42 wins** in the workbook. You finish season 2027 with 10 wins → career = **52**.
If you later back-fill the 2024 season he won in the past and mark it *"already included in legacy totals"*, it is shown on his profile but **not added**, so he stays at 42, not 51.

Other rules:
* A **draft** season counts for nothing until you finalise it.
* **Blank ≠ 0.** A blank is "unknown" and is skipped; if everything is unknown the total shows "—". A typed `0` is a real zero.
  (One exception: the old workbook uses blanks to mean zero in its count columns, which was proved by `wins + 2nd + 3rd = podiums`, so those blanks import as 0 and the import report says so.)
* Points are the numbers **you type**. Nothing is calculated from races.
* `M.P.S` is kept as a legacy field exactly as written. Its meaning is **not guessed** and it is never added to anything.

## 4. Hall of Fame

* One championship row per season per type (Drivers' / Constructors'), enforced by the database.
* Each row stores the champion's **team for that season** and a **snapshot of the names**, so a later transfer or rename never changes an old card.
* A recorded champion can only be replaced on purpose, with a written reason, and the change goes in `change_log`.
* The workbook has title **counts** but no years. They appear as *unassigned legacy titles* (Verstappen 2, Hamilton 1, Antonelli 1; Ferrari 2, Mercedes 2) until you tell the app the years. Assigning a year uses up one unassigned title and never adds a new one.

## 5. Flagged for your review (nothing was changed)

| Item | What the importer will do |
|---|---|
| Las Vegas fastest lap `01:11:775` and pole `01:11:561` (colon instead of dot) | Original text kept. Suggested fix `1:11.775` / `1:11.561` is **pending your approval**. No lap time is stored until you approve. |
| Team Stats show 96 wins/poles and 288 podiums, Driver Stats show 104 / 104 / 312 | Both imported exactly as written, flagged. Red Bull shows 41 wins but Verstappen alone has 42. |
| `M.P.S` | Stored as `mps`, meaning unknown. |
| No years anywhere in the workbook | Team history is stored in order without years; titles are unassigned until you add years. |

## 6. Importing the Excel file (Stage 2)

See `docs/IMPORTER.md`. In short: preview first (saves nothing), then commit (all or nothing). Existing data is never deleted,
never overwritten unless you choose it for that one item, and the same file can never be imported twice. An import only fills the
legacy baseline; seasons, standings, season stats and the Hall of Fame are never touched.
