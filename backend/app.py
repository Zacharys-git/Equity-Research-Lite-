"""
Stock Research Lite — minimal Flask backend.
Sources: yfinance (prices/financials), SEC EDGAR (filings/company facts), FRED (macro).
"""
import os
import math
from datetime import datetime, timedelta
from functools import lru_cache

import requests
import yfinance as yf
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

# curl_cffi spoofs a real Chrome TLS fingerprint so Yahoo Finance doesn't block us.
try:
    from curl_cffi import requests as curl_requests
    YF_SESSION = curl_requests.Session(impersonate="chrome")
except Exception:
    YF_SESSION = None

load_dotenv()

FRED_API_KEY = os.getenv("FRED_API_KEY", "")
SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "Stock Research Lite contact@example.com")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

app = Flask(__name__)
CORS(app, origins=ALLOWED_ORIGINS or "*")


# ---------- helpers ----------

def safe_num(v):
    """Convert numpy/pandas scalars to JSON-safe values; NaN -> None."""
    if v is None:
        return None
    try:
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        if hasattr(v, "item"):
            v = v.item()
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return v
    except Exception:
        return None


def df_to_records(df):
    """Convert yfinance financial dataframe (rows=line items, cols=periods) to list of period dicts."""
    if df is None or df.empty:
        return []
    out = []
    for col in df.columns:
        period = {"period": str(col.date()) if hasattr(col, "date") else str(col)}
        for idx in df.index:
            period[str(idx)] = safe_num(df.loc[idx, col])
        out.append(period)
    return out


def _latest_value(records, *candidate_keys):
    """Find the most recent non-null value for any of the given line-item names."""
    if not records:
        return None
    for r in records:
        for k in candidate_keys:
            v = r.get(k)
            if v is not None:
                return v
    return None


def compute_ratios(income_records, balance_records, cashflow_records, price, shares_out, market_cap):
    """Compute fundamental ratios from financial statements when yfinance .info is rate-limited."""
    revenue = _latest_value(income_records, "Total Revenue", "TotalRevenue", "Revenue")
    gross_profit = _latest_value(income_records, "Gross Profit", "GrossProfit")
    op_income = _latest_value(income_records, "Operating Income", "OperatingIncome")
    net_income = _latest_value(income_records, "Net Income", "Net Income Common Stockholders", "Net Income From Continuing Operation Net Minority Interest")
    ebitda = _latest_value(income_records, "EBITDA", "Normalized EBITDA")

    total_assets = _latest_value(balance_records, "Total Assets", "TotalAssets")
    stockholders_equity = _latest_value(balance_records, "Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest")
    total_debt = _latest_value(balance_records, "Total Debt", "TotalDebt", "Long Term Debt")
    cash = _latest_value(balance_records, "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments", "Cash And Short Term Investments")
    current_assets = _latest_value(balance_records, "Current Assets", "CurrentAssets")
    current_liab = _latest_value(balance_records, "Current Liabilities", "CurrentLiabilities")
    inventory = _latest_value(balance_records, "Inventory")

    def safe_div(a, b):
        if a is None or b is None or b == 0:
            return None
        return a / b

    eps = safe_div(net_income, shares_out)
    book_value = safe_div(stockholders_equity, shares_out)

    enterprise_value = None
    if market_cap is not None:
        enterprise_value = market_cap + (total_debt or 0) - (cash or 0)

    return {
        "trailingPE": safe_div(price, eps),
        "forwardPE": None,  # needs analyst estimates
        "pegRatio": None,
        "priceToBook": safe_div(price, book_value),
        "priceToSales": safe_div(market_cap, revenue),
        "enterpriseValue": enterprise_value,
        "evToRevenue": safe_div(enterprise_value, revenue),
        "evToEbitda": safe_div(enterprise_value, ebitda),
        "grossMargin": safe_div(gross_profit, revenue),
        "operatingMargin": safe_div(op_income, revenue),
        "profitMargin": safe_div(net_income, revenue),
        "returnOnAssets": safe_div(net_income, total_assets),
        "returnOnEquity": safe_div(net_income, stockholders_equity),
        "debtToEquity": safe_div(total_debt, stockholders_equity),
        "currentRatio": safe_div(current_assets, current_liab),
        "quickRatio": safe_div((current_assets or 0) - (inventory or 0), current_liab) if current_assets is not None and current_liab else None,
        "dividendYield": None,
        "payoutRatio": None,
        "beta": None,
        "eps": eps,
        "bookValue": book_value,
    }


# ---------- routes ----------

@app.route("/")
def root():
    return jsonify({
        "service": "stock-research-lite",
        "endpoints": [
            "/api/financials/<ticker>",
            "/api/snapshot/<ticker>",
            "/api/macro",
            "/api/edgar/<ticker>",
            "/api/sectors",
        ],
    })


@app.route("/api/snapshot/<ticker>")
def snapshot(ticker):
    """Price snapshot + headline stats + 1y daily history for charting."""
    ticker = ticker.upper().strip()
    warnings = []
    try:
        t = yf.Ticker(ticker, session=YF_SESSION) if YF_SESSION else yf.Ticker(ticker)
        info = {}
        try:
            info = t.info or {}
        except Exception as e:
            warnings.append(f"info: {e}")

        # fast_info is a lighter endpoint that's less rate-limited.
        # Use it to fill in price/market cap if info() failed.
        try:
            fi = t.fast_info
            if fi is not None:
                fast_map = {
                    "currentPrice": getattr(fi, "last_price", None),
                    "previousClose": getattr(fi, "previous_close", None),
                    "open": getattr(fi, "open", None),
                    "dayHigh": getattr(fi, "day_high", None),
                    "dayLow": getattr(fi, "day_low", None),
                    "fiftyTwoWeekHigh": getattr(fi, "year_high", None),
                    "fiftyTwoWeekLow": getattr(fi, "year_low", None),
                    "fiftyDayAverage": getattr(fi, "fifty_day_average", None),
                    "twoHundredDayAverage": getattr(fi, "two_hundred_day_average", None),
                    "marketCap": getattr(fi, "market_cap", None),
                    "sharesOutstanding": getattr(fi, "shares", None),
                    "regularMarketVolume": getattr(fi, "last_volume", None),
                    "averageVolume": getattr(fi, "ten_day_average_volume", None),
                    "currency": getattr(fi, "currency", None),
                    "exchange": getattr(fi, "exchange", None),
                }
                for k, v in fast_map.items():
                    if info.get(k) is None and v is not None:
                        info[k] = v
        except Exception as e:
            warnings.append(f"fast_info: {e}")

        history = []
        try:
            hist = t.history(period="2y", interval="1d", auto_adjust=False)
            if not hist.empty:
                for idx, row in hist.iterrows():
                    history.append({
                        "date": idx.strftime("%Y-%m-%d"),
                        "open": safe_num(row.get("Open")),
                        "high": safe_num(row.get("High")),
                        "low": safe_num(row.get("Low")),
                        "close": safe_num(row.get("Close")),
                        "volume": safe_num(row.get("Volume")),
                    })
        except Exception as e:
            warnings.append(f"history: {e}")

        # If we got history but no price, derive it from the most recent close.
        if history and info.get("currentPrice") is None:
            info["currentPrice"] = history[-1].get("close")
        if history and info.get("previousClose") is None and len(history) > 1:
            info["previousClose"] = history[-2].get("close")

        # Compute ratios from financial statements when info() is rate-limited.
        # Only fire if at least some core ratio is missing (avoid extra fetches when info works).
        needs_compute = any(info.get(k) is None for k in [
            "trailingPE", "priceToBook", "priceToSalesTrailing12Months",
            "trailingEps", "returnOnEquity", "profitMargins"
        ])
        if needs_compute:
            try:
                income_recs = df_to_records(t.financials)
                balance_recs = df_to_records(t.balance_sheet)
                cashflow_recs = df_to_records(t.cashflow)
                computed = compute_ratios(
                    income_recs, balance_recs, cashflow_recs,
                    info.get("currentPrice"),
                    info.get("sharesOutstanding"),
                    info.get("marketCap"),
                )
                # Only use computed values where info() didn't supply one.
                key_map = {
                    "trailingPE": "trailingPE",
                    "priceToBook": "priceToBook",
                    "priceToSalesTrailing12Months": "priceToSales",
                    "trailingEps": "eps",
                    "returnOnEquity": "returnOnEquity",
                    "returnOnAssets": "returnOnAssets",
                    "profitMargins": "profitMargin",
                    "operatingMargins": "operatingMargin",
                    "grossMargins": "grossMargin",
                    "debtToEquity": "debtToEquity",
                }
                for info_key, computed_key in key_map.items():
                    if info.get(info_key) is None and computed.get(computed_key) is not None:
                        info[info_key] = computed[computed_key]
            except Exception as e:
                warnings.append(f"compute_ratios: {e}")

        keys = [
            "longName", "shortName", "symbol", "sector", "industry", "exchange",
            "currency", "marketCap", "sharesOutstanding", "floatShares",
            "currentPrice", "previousClose", "open", "dayHigh", "dayLow",
            "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "fiftyDayAverage", "twoHundredDayAverage",
            "regularMarketVolume", "averageVolume",
            "trailingPE", "forwardPE", "priceToBook", "priceToSalesTrailing12Months",
            "trailingEps", "forwardEps", "dividendYield", "dividendRate", "payoutRatio",
            "beta", "profitMargins", "operatingMargins", "grossMargins",
            "returnOnAssets", "returnOnEquity",
            "revenueGrowth", "earningsGrowth",
            "totalCash", "totalDebt", "debtToEquity",
            "longBusinessSummary", "website",
        ]
        stats = {k: safe_num(info.get(k)) if not isinstance(info.get(k), str) else info.get(k) for k in keys}

        return jsonify({"ticker": ticker, "stats": stats, "history": history, "warnings": warnings})
    except Exception as e:
        return jsonify({"error": str(e), "ticker": ticker, "stats": {}, "history": []}), 200


SECTOR_ETFS = [
    {"ticker": "XLK",  "sector": "Technology",            "color": "#4ea1ff"},
    {"ticker": "XLF",  "sector": "Financials",            "color": "#3fb950"},
    {"ticker": "XLE",  "sector": "Energy",                "color": "#f85149"},
    {"ticker": "XLV",  "sector": "Health Care",           "color": "#d29922"},
    {"ticker": "XLI",  "sector": "Industrials",           "color": "#a371f7"},
    {"ticker": "XLY",  "sector": "Consumer Discretionary","color": "#ec6cb9"},
    {"ticker": "XLP",  "sector": "Consumer Staples",      "color": "#56d364"},
    {"ticker": "XLU",  "sector": "Utilities",             "color": "#79c0ff"},
    {"ticker": "XLB",  "sector": "Materials",             "color": "#ffa657"},
    {"ticker": "XLRE", "sector": "Real Estate",           "color": "#ff7b72"},
    {"ticker": "XLC",  "sector": "Communication Svcs",    "color": "#bc8cff"},
    {"ticker": "SPY",  "sector": "S&P 500 (Benchmark)",   "color": "#8b949e"},
]


@app.route("/api/sectors")
def sectors():
    """5-year growth comparison across SPDR sector ETFs + SPY benchmark."""
    period = request.args.get("period", "5y")
    out = []
    for s in SECTOR_ETFS:
        try:
            tk = yf.Ticker(s["ticker"], session=YF_SESSION) if YF_SESSION else yf.Ticker(s["ticker"])
            hist = tk.history(period=period, interval="1wk", auto_adjust=True)
            if hist.empty:
                out.append({**s, "error": "no data"})
                continue
            closes = hist["Close"].dropna()
            if len(closes) < 2:
                out.append({**s, "error": "insufficient data"})
                continue
            base = float(closes.iloc[0])
            history = []
            for idx, val in closes.items():
                v = float(val)
                history.append({
                    "date": idx.strftime("%Y-%m-%d"),
                    "normalized": (v / base) * 100.0,
                    "close": v,
                })
            total_return = (history[-1]["normalized"] - 100.0)
            out.append({
                **s,
                "history": history,
                "totalReturn": total_return,
                "startPrice": base,
                "endPrice": float(closes.iloc[-1]),
                "startDate": history[0]["date"],
                "endDate": history[-1]["date"],
            })
        except Exception as e:
            out.append({**s, "error": str(e)})
    # Sort by total return descending (errored ones at the end)
    out.sort(key=lambda x: x.get("totalReturn") if x.get("totalReturn") is not None else -1e9, reverse=True)
    return jsonify({"period": period, "sectors": out})


@app.route("/api/financials/<ticker>")
def financials(ticker):
    """Income statement, balance sheet, cash flow, ratios."""
    ticker = ticker.upper().strip()
    period = request.args.get("period", "annual")  # annual | quarterly
    try:
        t = yf.Ticker(ticker, session=YF_SESSION) if YF_SESSION else yf.Ticker(ticker)
        if period == "quarterly":
            inc = t.quarterly_financials
            bs = t.quarterly_balance_sheet
            cf = t.quarterly_cashflow
        else:
            inc = t.financials
            bs = t.balance_sheet
            cf = t.cashflow

        try:
            info = t.info or {}
        except Exception:
            info = {}

        # Try fast_info for price + market cap (less rate-limited)
        try:
            fi = t.fast_info
            fast_price = getattr(fi, "last_price", None) if fi is not None else None
            fast_mcap = getattr(fi, "market_cap", None) if fi is not None else None
            fast_shares = getattr(fi, "shares", None) if fi is not None else None
        except Exception:
            fast_price = fast_mcap = fast_shares = None

        # Build ratio block, preferring info() values, falling back to computed
        income_records = df_to_records(inc)
        balance_records = df_to_records(bs)
        cashflow_records = df_to_records(cf)

        price = safe_num(info.get("currentPrice")) or fast_price
        market_cap = safe_num(info.get("marketCap")) or fast_mcap
        shares_out = safe_num(info.get("sharesOutstanding")) or fast_shares

        computed = compute_ratios(income_records, balance_records, cashflow_records,
                                  price, shares_out, market_cap)

        def pick(info_key, computed_key=None):
            ck = computed_key or info_key
            v = safe_num(info.get(info_key))
            if v is not None:
                return v
            return computed.get(ck)

        ratios = {
            "trailingPE": pick("trailingPE"),
            "forwardPE": pick("forwardPE"),
            "priceToBook": pick("priceToBook"),
            "priceToSales": pick("priceToSalesTrailing12Months", "priceToSales"),
            "pegRatio": pick("pegRatio"),
            "enterpriseValue": pick("enterpriseValue"),
            "evToRevenue": pick("enterpriseToRevenue", "evToRevenue"),
            "evToEbitda": pick("enterpriseToEbitda", "evToEbitda"),
            "grossMargin": pick("grossMargins", "grossMargin"),
            "operatingMargin": pick("operatingMargins", "operatingMargin"),
            "profitMargin": pick("profitMargins", "profitMargin"),
            "returnOnAssets": pick("returnOnAssets"),
            "returnOnEquity": pick("returnOnEquity"),
            "debtToEquity": pick("debtToEquity"),
            "currentRatio": pick("currentRatio"),
            "quickRatio": pick("quickRatio"),
            "dividendYield": pick("dividendYield"),
            "payoutRatio": pick("payoutRatio"),
            "beta": pick("beta"),
            "eps": pick("trailingEps", "eps"),
            "bookValue": pick("bookValue"),
        }

        return jsonify({
            "ticker": ticker,
            "period": period,
            "incomeStatement": income_records,
            "balanceSheet": balance_records,
            "cashFlow": cashflow_records,
            "ratios": ratios,
        })
    except Exception as e:
        return jsonify({"error": str(e), "ticker": ticker, "incomeStatement": [], "balanceSheet": [], "cashFlow": [], "ratios": {}}), 200


# ---------- SEC EDGAR ----------

@lru_cache(maxsize=1)
def _edgar_ticker_map():
    """SEC publishes a ticker -> CIK JSON. Cache for the life of the process."""
    url = "https://www.sec.gov/files/company_tickers.json"
    r = requests.get(url, headers={"User-Agent": SEC_USER_AGENT}, timeout=15)
    r.raise_for_status()
    raw = r.json()
    out = {}
    for _, row in raw.items():
        out[row["ticker"].upper()] = {
            "cik": str(row["cik_str"]).zfill(10),
            "title": row["title"],
        }
    return out


@app.route("/api/edgar/<ticker>")
def edgar(ticker):
    """Recent SEC filings for the ticker."""
    ticker = ticker.upper().strip()
    try:
        m = _edgar_ticker_map().get(ticker)
        if not m:
            return jsonify({"error": "ticker not found in SEC map", "ticker": ticker}), 404
        cik = m["cik"]
        url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        r = requests.get(url, headers={"User-Agent": SEC_USER_AGENT}, timeout=15)
        r.raise_for_status()
        data = r.json()
        recent = data.get("filings", {}).get("recent", {})
        filings = []
        n = min(20, len(recent.get("form", [])))
        for i in range(n):
            accession = recent["accessionNumber"][i].replace("-", "")
            primary_doc = recent["primaryDocument"][i]
            filings.append({
                "form": recent["form"][i],
                "filingDate": recent["filingDate"][i],
                "reportDate": recent["reportDate"][i],
                "accessionNumber": recent["accessionNumber"][i],
                "primaryDocument": primary_doc,
                "url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession}/{primary_doc}",
            })
        return jsonify({
            "ticker": ticker,
            "cik": cik,
            "name": data.get("name"),
            "sic": data.get("sicDescription"),
            "exchanges": data.get("exchanges"),
            "filings": filings,
        })
    except Exception as e:
        return jsonify({"error": str(e), "ticker": ticker}), 500


# ---------- FRED macro ----------

# Curated macro panel — broad indicators most traders watch.
MACRO_SERIES = [
    {"id": "GDPC1",       "label": "Real GDP (chained 2017 $, SAAR)", "units": "Bil. $"},
    {"id": "CPIAUCSL",    "label": "CPI (All Items, SA)",              "units": "Index"},
    {"id": "CPILFESL",    "label": "Core CPI (ex Food/Energy, SA)",    "units": "Index"},
    {"id": "UNRATE",      "label": "Unemployment Rate",                "units": "%"},
    {"id": "PAYEMS",      "label": "Nonfarm Payrolls",                 "units": "Thousands"},
    {"id": "FEDFUNDS",    "label": "Effective Fed Funds Rate",         "units": "%"},
    {"id": "DGS10",       "label": "10Y Treasury Yield",               "units": "%"},
    {"id": "DGS2",        "label": "2Y Treasury Yield",                "units": "%"},
    {"id": "T10Y2Y",      "label": "10Y - 2Y Spread",                  "units": "%"},
    {"id": "DCOILWTICO",  "label": "WTI Crude Oil",                    "units": "$/bbl"},
    {"id": "VIXCLS",      "label": "VIX",                              "units": "Index"},
    {"id": "DTWEXBGS",    "label": "Trade-Weighted USD Index",         "units": "Index"},
    {"id": "UMCSENT",     "label": "U. Michigan Consumer Sentiment",   "units": "Index"},
    {"id": "INDPRO",      "label": "Industrial Production",            "units": "Index"},
]


def _fred_series(series_id, observations=500):
    if not FRED_API_KEY:
        return {"error": "FRED_API_KEY not set"}
    end = datetime.utcnow().date()
    start = (end - timedelta(days=365 * 5)).isoformat()
    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": start,
        "sort_order": "desc",
        "limit": observations,
    }
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    obs = r.json().get("observations", [])
    pts = []
    for o in obs:
        try:
            v = float(o["value"]) if o["value"] not in (".", "") else None
        except ValueError:
            v = None
        pts.append({"date": o["date"], "value": v})
    pts.reverse()  # oldest -> newest
    latest = next((p for p in reversed(pts) if p["value"] is not None), None)
    prior = None
    if latest:
        rest = [p for p in pts if p["value"] is not None and p["date"] != latest["date"]]
        prior = rest[-1] if rest else None
    change = None
    if latest and prior and prior["value"] not in (None, 0):
        change = (latest["value"] - prior["value"]) / abs(prior["value"]) * 100
    return {
        "latest": latest,
        "prior": prior,
        "pctChange": change,
        "history": pts,
    }


@app.route("/api/macro")
def macro():
    if not FRED_API_KEY:
        return jsonify({"error": "FRED_API_KEY not configured on server"}), 500
    out = []
    for s in MACRO_SERIES:
        try:
            data = _fred_series(s["id"])
            out.append({**s, **data})
        except Exception as e:
            out.append({**s, "error": str(e)})
    return jsonify({"series": out, "asOf": datetime.utcnow().isoformat()})


@app.route("/api/macro/<series_id>")
def macro_one(series_id):
    if not FRED_API_KEY:
        return jsonify({"error": "FRED_API_KEY not configured on server"}), 500
    try:
        return jsonify({"id": series_id, **_fred_series(series_id, observations=120)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)
