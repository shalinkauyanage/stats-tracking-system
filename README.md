# F1  — Stage 2

A personal Formula 1 career with historical career statistics, season-management logic, a Hall of Fame, and a safe Excel import system.

## Requirements
- Node.js 20 or newer
- MySQL 8
- npm

## Installation

1. Install dependencies:

   ```powershell
   npm install --prefix server
   ```

2. Create the server environment file:

   ```powershell
   Copy-Item server/.env.example server/.env
   ```

3. Edit `server/.env` with your MySQL credentials.

4. Set up the database:

   ```powershell
   npm run db:setup
   ```

Only run database setup after confirming the target database is correct and important data is backed up.

## Run the application

Start the API:

```powershell
npm start --prefix server
```

Default API address: `http://localhost:3001`

Health check: `http://localhost:3001/api/health`

## Read-only data API (Stage 3 foundation)

The API exposes data for the web interface:

- `GET /api/drivers` and `GET /api/drivers/:id`
- `GET /api/teams`
- `GET /api/circuits` and `GET /api/circuits/:id`
- `GET /api/seasons`
- `GET /api/hall-of-fame`
- `GET /api/health`
- Existing Excel import endpoints under `/api/import`

List responses use `{ "data": [...] }`; detail responses use `{ "data": {...} }`.
These endpoints are read-only and do not modify database records.

## Excel importer

Preview an Excel workbook without committing changes:

```powershell
npm run import:preview --prefix server -- "..\data\original\F1.xlsx"
```

Review the report before deciding whether to commit an import.

View import history:

```powershell
npm run import:history --prefix server
```

The importer preserves existing values when conflicts occur unless an explicit overwrite is selected. Suspected lap-time corrections are flagged for review.

## Tests

Run server tests:

```powershell
npm test
```

Run database integration tests:

```powershell
npm run test:db
```

The database integration tests require a working MySQL configuration.

## Project structure

- `server/src/logic/` — career calculations, season validation, and Hall of Fame
- `server/src/import/` — Excel parsing, preview, conflict detection, and import execution
- `server/db/migrations/` — database schema migrations
- `server/test/` — automated logic and importer tests
- `server/test-db/` — database integration tests
- `data/original/` — source workbook and backup files
- `docs/` — technical documentation and test results

## Data safety

- Previewing does not commit changes.
- Existing historical seasons and records are protected.
- Conflicting values are retained by default.
- Back up the database before performing imports or schema changes.
