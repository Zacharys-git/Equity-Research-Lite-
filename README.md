# Stock Research Lite

A minimal stock research site. Type any ticker and get:

- **Snapshot** — price, 1-2y chart with SMA 20/50/200, key stats, business summary
- **Financials** — income statement, balance sheet, cash flow, ratios, recent SEC filings
- **Sectors** — 5-year total return ranking across the 11 SPDR sector ETFs vs SPY benchmark
- **Macro** — U.S. macro indicators from FRED (CPI, GDP, unemployment, yields, VIX, oil, etc.) with hover tooltips on every sparkline

**Data sources:** yfinance · SEC EDGAR · FRED.

---

## Quick Start

### Windows

Double-click **`run.bat`**.

The first run takes ~1 minute (creates a virtualenv, installs dependencies). Subsequent runs start in seconds.

It will:
1. Copy `backend/.env.example` to `backend/.env` (if missing)
2. Create `backend/venv` and install Python deps (if missing)
3. Start the Flask backend on http://localhost:5001
4. Start the static frontend on http://localhost:8000
5. Open the site in your browser

To stop, close the two cmd windows.

### Mac / Linux

```bash
chmod +x run.sh
./run.sh
```

Press `Ctrl+C` to stop both servers.

---

## Requirements

- **Python 3.10+** on PATH (`python --version` should work). Get it at https://www.python.org/downloads/
- Internet access (calls Yahoo Finance, FRED, and SEC EDGAR)

That's it. No Node, no npm.

---

## Architecture

- **Frontend** — vanilla HTML/CSS/JS in `frontend/`. No build step.
- **Backend** — Flask in `backend/`. Wraps yfinance, FRED, and SEC EDGAR.
- The frontend calls the backend at `http://localhost:5001` when running locally.

```
stock-research-lite/
├── run.bat              one-click start (Windows)
├── run.sh               one-click start (Mac/Linux)
├── backend/
│   ├── app.py           Flask app — all API routes
│   ├── requirements.txt Python deps
│   ├── .env.example     contains the FRED key for our team
│   ├── Procfile         for Render/Heroku deploy
│   └── render.yaml      Render config
├── frontend/
│   ├── index.html
│   ├── app.js           edit API_BASE before deploying
│   └── style.css
└── README.md
```

---

## API Reference

| Endpoint | Description |
|---|---|
| `GET /api/snapshot/<ticker>` | Price, key stats, 2y daily history |
| `GET /api/financials/<ticker>?period=annual\|quarterly` | Income / balance / cash flow / ratios |
| `GET /api/edgar/<ticker>` | Recent SEC filings |
| `GET /api/sectors` | 5y total return for 11 sector ETFs + SPY |
| `GET /api/macro` | All FRED macro indicators (latest + history) |
| `GET /api/macro/<series_id>` | Single FRED series, 120 obs |

Try it locally: http://localhost:5001/api/snapshot/AAPL

---

## Deploying

### Backend → Render (free)

1. Push to a GitHub repo.
2. On https://render.com → New → Web Service → connect repo.
3. Render auto-detects `backend/render.yaml`.
4. Set env vars in Render dashboard (copy from `.env.example`):
   - `FRED_API_KEY` — `4078fcabb20b7dd06b16c50328ec4192`
   - `SEC_USER_AGENT` — `Your Team your-email@example.com`
   - `ALLOWED_ORIGINS` — `https://YOUR-USERNAME.github.io`
5. Deploy. URL will be `https://<your-app>.onrender.com`.

> Free Render web services sleep after 15 min idle — first request after sleep takes ~30 s.

### Frontend → GitHub Pages

1. Edit `frontend/app.js` line ~9: replace the placeholder backend URL with your Render URL.
2. Commit + push.
3. GitHub repo → Settings → Pages → Source = `Deploy from a branch`, Branch = `main`, Folder = `/frontend`.
4. Live at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

---

## Notes for Collaborators

- The FRED API key is committed in `backend/.env.example`. We're sharing it intentionally inside our team. If you're adding a new dev, point them at this README.
- yfinance hits Yahoo Finance directly. Yahoo aggressively rate-limits — `curl_cffi` is in our deps to spoof a Chrome TLS fingerprint and stay under their radar.
- If you edit `frontend/app.js` or `frontend/style.css`, bump the `?v=N` cache-busting query string in `frontend/index.html` (or hard-refresh your browser with Ctrl+F5).
- All three external APIs are free. FRED requires the API key in `.env.example`. SEC EDGAR requires a `User-Agent` (a contact email is in `.env.example`).
