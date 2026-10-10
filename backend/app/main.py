import asyncio
import os
from datetime import datetime, timezone
from typing import Any

import httpx
import yfinance as yf
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
CORS_ORIGINS = [v.strip() for v in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if v.strip()]

app = FastAPI(title="Fixo API", version="1.0.0", description="Indian-market data and simulated paper trading API.")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])

SYMBOLS: dict[str, dict[str, str]] = {
    "NIFTY50": {"ticker": "^NSEI", "company": "NIFTY 50", "exchange": "NSE index"},
    "SENSEX": {"ticker": "^BSESN", "company": "S&P BSE SENSEX", "exchange": "BSE index"},
    "RELIANCE": {"ticker": "RELIANCE.NS", "company": "Reliance Industries", "exchange": "NSE"},
    "TCS": {"ticker": "TCS.NS", "company": "Tata Consultancy Services", "exchange": "NSE"},
    "INFY": {"ticker": "INFY.NS", "company": "Infosys", "exchange": "NSE"},
    "HDFCBANK": {"ticker": "HDFCBANK.NS", "company": "HDFC Bank", "exchange": "NSE"},
    "SBIN": {"ticker": "SBIN.NS", "company": "State Bank of India", "exchange": "NSE"},
    "ICICIBANK": {"ticker": "ICICIBANK.NS", "company": "ICICI Bank", "exchange": "NSE"},
    "ITC": {"ticker": "ITC.NS", "company": "ITC Limited", "exchange": "NSE"},
    "BHARTIARTL": {"ticker": "BHARTIARTL.NS", "company": "Bharti Airtel", "exchange": "NSE"},
    "LT": {"ticker": "LT.NS", "company": "Larsen & Toubro", "exchange": "NSE"},
    "WIPRO": {"ticker": "WIPRO.NS", "company": "Wipro", "exchange": "NSE"},
    "AXISBANK": {"ticker": "AXISBANK.NS", "company": "Axis Bank", "exchange": "NSE"},
    "MARUTI": {"ticker": "MARUTI.NS", "company": "Maruti Suzuki India", "exchange": "NSE"},
}


class OrderRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    side: str
    quantity: float = Field(gt=0, le=1_000_000)


def ensure_config() -> None:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="Backend Supabase configuration is incomplete.")


async def supabase_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in to use this endpoint.")
    ensure_config()
    token = authorization.split(" ", 1)[1].strip()
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.get(f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"})
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Your session is invalid or expired. Sign in again.")
    return {"id": response.json()["id"], "token": token}


def yahoo_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if normalized not in SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Unsupported instrument: {normalized}")
    return SYMBOLS[normalized]["ticker"]


def fetch_quote_sync(symbol: str) -> dict[str, Any]:
    normalized = symbol.strip().upper()
    ticker_symbol = yahoo_symbol(normalized)
    meta = SYMBOLS[normalized]
    ticker = yf.Ticker(ticker_symbol)
    frame = ticker.history(period="1d", interval="5m", auto_adjust=False)
    if frame.empty or "Close" not in frame:
        frame = ticker.history(period="5d", interval="1d", auto_adjust=False)
    if frame.empty or "Close" not in frame:
        raise ValueError("Yahoo Finance returned no price history.")
    closes = frame["Close"].dropna()
    if closes.empty:
        raise ValueError("Yahoo Finance returned no closing prices.")
    price = float(closes.iloc[-1])
    previous = float(closes.iloc[-2]) if len(closes) > 1 else price
    change = ((price - previous) / previous * 100) if previous else 0.0
    stamp = frame.index[-1]
    try:
        quote_time = stamp.to_pydatetime()
        if quote_time.tzinfo is None:
            quote_time = quote_time.replace(tzinfo=timezone.utc)
        else:
            quote_time = quote_time.astimezone(timezone.utc)
    except Exception:
        quote_time = datetime.now(timezone.utc)
    return {"symbol": normalized, "company": meta["company"], "price": round(price, 4),
        "change_percent": round(change, 4), "currency": "INR", "exchange": meta["exchange"],
        "source": "yahoo-finance", "updated_at": quote_time.isoformat()}

async def fetch_quote(symbol: str) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(fetch_quote_sync, symbol)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch {symbol} from Yahoo Finance: {str(exc)[:160]}") from exc


async def cache_quote(quote: dict[str, Any]) -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Server-side Supabase service key is required to cache trade quotes.")
    payload = {key: quote[key] for key in ("symbol", "company", "price", "change_percent", "currency", "exchange", "source", "updated_at")}
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.post(f"{SUPABASE_URL}/rest/v1/market_quotes?on_conflict=symbol",
            headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}, json=payload)
    if response.status_code not in (200, 201, 204):
        raise HTTPException(status_code=502, detail="Could not cache quote in Supabase.")


async def user_rest(path: str, user: dict[str, Any], params: dict[str, str] | None = None) -> Any:
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.get(f"{SUPABASE_URL}/rest/v1/{path}", params=params or {},
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {user['token']}"})
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Could not read your portfolio from Supabase.")
    return response.json()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "fixo-api", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/market/symbols")
async def symbols() -> dict[str, Any]:
    return {"symbols": [{"symbol": key, **value} for key, value in SYMBOLS.items()]}


@app.get("/api/market/quotes")
async def quotes(symbols: str = Query(default="NIFTY50,SENSEX,RELIANCE,TCS,INFY,HDFCBANK,SBIN")) -> dict[str, Any]:
    requested = list(dict.fromkeys(s.strip().upper() for s in symbols.split(",") if s.strip()))
    if not requested or len(requested) > 20:
        raise HTTPException(status_code=400, detail="Provide between 1 and 20 symbols.")
    results = await asyncio.gather(*(fetch_quote(s) for s in requested), return_exceptions=True)
    data, errors = [], []
    for symbol, result in zip(requested, results):
        if isinstance(result, Exception):
            errors.append({"symbol": symbol, "error": str(result.detail if isinstance(result, HTTPException) else result)})
        else:
            data.append(result)
            if SUPABASE_SERVICE_ROLE_KEY:
                try:
                    await cache_quote(result)
                except HTTPException:
                    pass
    return {"quotes": data, "errors": errors, "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance; data may be delayed"}


@app.get("/api/market/history/{symbol}")
async def history(symbol: str, period: str = Query(default="1mo", pattern="^(1d|5d|1mo|3mo|6mo|1y|2y)$")) -> dict[str, Any]:
    ticker = yahoo_symbol(symbol)
    def read_history() -> list[dict[str, Any]]:
        frame = yf.Ticker(ticker).history(period=period, interval="1d", auto_adjust=False)
        return [{"date": stamp.isoformat(), "close": round(float(row["Close"]), 4),
                 "volume": int(row.get("Volume", 0) or 0)}
                for stamp, row in frame.iterrows() if row.get("Close") is not None]
    try:
        points = await asyncio.to_thread(read_history)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Yahoo Finance history is unavailable.") from exc
    if not points:
        raise HTTPException(status_code=502, detail="Yahoo Finance returned no historical data.")
    return {"symbol": symbol.strip().upper(), "period": period, "points": points,
        "source": "Yahoo Finance; historical data may be delayed"}


@app.get("/api/portfolio")
async def portfolio(user: dict[str, Any] = Depends(supabase_user)) -> dict[str, Any]:
    rows = await user_rest("portfolios", user, {"select": "id,user_id,cash_balance,currency,updated_at",
        "user_id": f"eq.{user['id']}", "limit": "1"})
    if not rows:
        raise HTTPException(status_code=404, detail="Portfolio is not initialized. Check that the Fixo database migration ran.")
    portfolio_row = rows[0]
    positions = await user_rest("positions", user, {"select": "id,symbol,quantity,average_price,updated_at",
        "portfolio_id": f"eq.{portfolio_row['id']}", "order": "symbol.asc"})
    orders = await user_rest("paper_orders", user, {"select": "id,symbol,side,quantity,price,notional,status,created_at",
        "order": "created_at.desc", "limit": "50"})
    return {"portfolio": portfolio_row, "positions": positions, "orders": orders}


@app.post("/api/orders")
async def place_order(body: OrderRequest, user: dict[str, Any] = Depends(supabase_user)) -> dict[str, Any]:
    symbol = body.symbol.strip().upper()
    if symbol not in SYMBOLS:
        raise HTTPException(status_code=400, detail="Unsupported instrument.")
    side = body.side.strip().lower()
    if side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="Side must be buy or sell.")
    quote = await fetch_quote(symbol)
    await cache_quote(quote)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/place_paper_order",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {user['token']}", "Content-Type": "application/json"},
            json={"p_symbol": symbol, "p_side": side, "p_quantity": body.quantity})
    if response.status_code >= 400:
        detail = "Order rejected by the paper-trading engine."
        try:
            payload = response.json()
            detail = payload.get("message") or payload.get("details") or detail
        except Exception:
            pass
        raise HTTPException(status_code=422, detail=str(detail)[:240])
    result = response.json()
    return result if isinstance(result, dict) else {"result": result}


@app.get("/api/watchlist")
async def get_watchlist(user: dict[str, Any] = Depends(supabase_user)) -> dict[str, Any]:
    items = await user_rest("watchlist_items", user, {"select": "id,symbol,created_at", "order": "created_at.asc"})
    return {"items": items}
