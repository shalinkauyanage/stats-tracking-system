# F1 Career — Frontend

React + Vite frontend for the existing F1 Career API.

## Requirements
- Node.js 20 or newer
- Existing API running on `http://localhost:3002`

## Run locally

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

By default the app reads from `http://localhost:3002/api`. To change this, create a `.env` file in `frontend` with:

```env
VITE_API_BASE=http://localhost:3002/api
```

The UI uses only the API's existing read endpoints. Empty season and Hall of Fame results are shown as empty states; no sample data is invented.
