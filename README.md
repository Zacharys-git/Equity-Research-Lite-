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



