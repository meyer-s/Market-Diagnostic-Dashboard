from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Tuple

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, Query

router = APIRouter()

_CACHE_TTL_SECONDS = 4 * 60 * 60
_cached_by_days: dict[int, dict[str, object]] = {}

AMEX_PROXY = [
    "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "XLV", "XLI", "XLP",
    "XLY", "XLU", "XLB", "XLRE", "XLC", "ARKK", "ARKG", "SMH", "SOXX", "GDX",
    "SLV", "GLD", "USO", "UNG", "TLT", "HYG", "LQD", "EEM", "EFA", "KWEB",
]

NASDAQ_PROXY = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "NFLX", "AMD",
    "CSCO", "ADBE", "PEP", "COST", "TMUS", "INTC", "QCOM", "AMGN", "INTU", "TXN",
    "AMAT", "MU", "ADI", "LRCX", "PANW", "CRWD", "MELI", "ASML", "KLAC", "MAR",
]

NYSE_PROXY = [
    "JPM", "BAC", "WFC", "GS", "MS", "XOM", "CVX", "JNJ", "PG", "KO",
    "MCD", "HD", "CAT", "GE", "IBM", "BA", "UNH", "PFE", "VZ", "T",
    "DIS", "NKE", "MMM", "HON", "RTX", "LOW", "BK", "BLK", "SPGI", "CB",
]

BREADTH_SYMBOL_CANDIDATES = {
    "nyse": {
        "advancing": ["^ADVN"],
        "declining": ["^DECL"],
        "volume_advancing": ["^UVOL"],
        "volume_declining": ["^DVOL"],
        "new_highs": ["^NYHGH", "^NYSH"],
        "new_lows": ["^NYLOW", "^NYL"],
    },
    "nsdq": {
        "advancing": ["^ADVNQ", "^ADVD"],
        "declining": ["^DECLQ", "^DECD"],
        "volume_advancing": ["^UVOLQ"],
        "volume_declining": ["^DVOLQ"],
        "new_highs": ["^NAHGH", "^NAH"],
        "new_lows": ["^NALOW", "^NAL"],
    },
    "amex": {
        "advancing": ["^ADVA"],
        "declining": ["^DECA"],
        "volume_advancing": ["^UVOLA"],
        "volume_declining": ["^DVOLA"],
        "new_highs": ["^AMEXH", "^AEHGH"],
        "new_lows": ["^AMEXL", "^AELOW"],
    },
}


def _extract_close_volume(downloaded: pd.DataFrame) -> Tuple[pd.DataFrame | None, pd.DataFrame | None]:
    if downloaded is None or downloaded.empty:
        return None, None

    if isinstance(downloaded.columns, pd.MultiIndex):
        level0 = downloaded.columns.get_level_values(0)
        level1 = downloaded.columns.get_level_values(1)
        if "Close" in level0 and "Volume" in level0:
            return downloaded["Close"], downloaded["Volume"]
        if "Close" in level1 and "Volume" in level1:
            swapped = downloaded.swaplevel(axis=1)
            return swapped["Close"], swapped["Volume"]
        return None, None

    has_close = "Close" in downloaded.columns
    has_volume = "Volume" in downloaded.columns
    if not has_close or not has_volume:
        return None, None

    close = pd.DataFrame({"SINGLE": downloaded["Close"]})
    volume = pd.DataFrame({"SINGLE": downloaded["Volume"]})
    return close, volume


def _fetch_breadth_metric_series(candidates: List[str]) -> Dict[str, float]:
    for symbol in candidates:
        try:
            frame = yf.download(
                tickers=symbol,
                period="1y",
                interval="1d",
                auto_adjust=False,
                progress=False,
                threads=True,
            )
        except Exception:
            continue

        if frame is None or frame.empty:
            continue

        series = None
        if isinstance(frame.columns, pd.MultiIndex):
            if "Close" in frame.columns.get_level_values(0):
                series = frame["Close"]
            elif "Adj Close" in frame.columns.get_level_values(0):
                series = frame["Adj Close"]
        else:
            if "Close" in frame.columns:
                series = frame["Close"]
            elif "Adj Close" in frame.columns:
                series = frame["Adj Close"]

        if series is None:
            continue

        if isinstance(series, pd.DataFrame):
            if series.empty:
                continue
            series = series.iloc[:, 0]

        clean = series.dropna()
        if clean.empty:
            continue

        mapped: Dict[str, float] = {}
        for idx, value in clean.items():
            mapped[pd.Timestamp(idx).strftime("%Y-%m-%d")] = float(value)

        if mapped:
            return mapped

    return {}


def _build_bucket_from_breadth_symbols(exchange_key: str, label: str, lookback_days: int) -> Dict[str, object] | None:
    candidates = BREADTH_SYMBOL_CANDIDATES.get(exchange_key)
    if not candidates:
        return None

    adv = _fetch_breadth_metric_series(candidates["advancing"])
    dec = _fetch_breadth_metric_series(candidates["declining"])
    uvol = _fetch_breadth_metric_series(candidates["volume_advancing"])
    dvol = _fetch_breadth_metric_series(candidates["volume_declining"])
    highs = _fetch_breadth_metric_series(candidates["new_highs"])
    lows = _fetch_breadth_metric_series(candidates["new_lows"])

    if not adv or not dec or not uvol or not dvol:
        return None

    common_dates = sorted(set(adv.keys()) & set(dec.keys()) & set(uvol.keys()) & set(dvol.keys()))
    if len(common_dates) < 20:
        return None

    common_dates = common_dates[-lookback_days:]
    history: List[Dict[str, float | int | str]] = []

    for date_key in common_dates:
        adv_val = max(float(adv.get(date_key, 0.0)), 0.0)
        dec_val = max(float(dec.get(date_key, 0.0)), 0.0)
        uvol_val = max(float(uvol.get(date_key, 0.0)), 0.0)
        dvol_val = max(float(dvol.get(date_key, 0.0)), 0.0)
        high_val = max(float(highs.get(date_key, 0.0)), 0.0)
        low_val = max(float(lows.get(date_key, 0.0)), 0.0)

        breadth_total = max(adv_val + dec_val, 1.0)
        volume_total = max(uvol_val + dvol_val, 1.0)
        hl_total = max(high_val + low_val, 1.0)

        history.append(
            {
                "date": date_key,
                "advancing": int(round(adv_val)),
                "declining": int(round(dec_val)),
                "advancing_pct": (adv_val / breadth_total) * 100.0,
                "declining_pct": (dec_val / breadth_total) * 100.0,
                "ad_rate": adv_val - dec_val,
                "volume_advancing": uvol_val,
                "volume_declining": dvol_val,
                "volume_advancing_pct": (uvol_val / volume_total) * 100.0,
                "volume_declining_pct": (dvol_val / volume_total) * 100.0,
                "new_highs": int(round(high_val)),
                "new_lows": int(round(low_val)),
                "new_highs_pct": (high_val / hl_total) * 100.0,
                "new_lows_pct": (low_val / hl_total) * 100.0,
                "participation_pct": 100.0,
            }
        )

    latest = history[-1]
    return {
        "label": label,
        "advancing": latest["advancing"],
        "declining": latest["declining"],
        "advancing_pct": latest["advancing_pct"],
        "declining_pct": latest["declining_pct"],
        "volume_advancing": latest["volume_advancing"],
        "volume_declining": latest["volume_declining"],
        "volume_advancing_pct": latest["volume_advancing_pct"],
        "volume_declining_pct": latest["volume_declining_pct"],
        "new_highs": latest["new_highs"],
        "new_lows": latest["new_lows"],
        "new_highs_pct": latest["new_highs_pct"],
        "new_lows_pct": latest["new_lows_pct"],
        "participation_pct": 100.0,
        "universe_size": int(max(1, latest["advancing"] + latest["declining"])),
        "history": history,
        "source": "breadth-symbols",
    }


def _resolve_exchange_bucket(exchange_key: str, label: str, proxy_symbols: List[str], lookback_days: int) -> Dict[str, object]:
    direct = _build_bucket_from_breadth_symbols(exchange_key, label, lookback_days)
    if direct:
        return direct

    fallback = _compute_bucket(proxy_symbols, f"{label} Proxy", lookback_days=lookback_days)
    fallback["source"] = "proxy-fallback"
    return fallback


def _build_bucket_history(
    close_frame: pd.DataFrame,
    volume_frame: pd.DataFrame,
    symbols: List[str],
    lookback_days: int = 90,
) -> List[Dict[str, float | int | str]]:
    history: List[Dict[str, float | int | str]] = []
    if close_frame is None or close_frame.empty:
        return history

    close = close_frame.copy().sort_index()
    volume = volume_frame.copy().sort_index()
    close = close[[c for c in close.columns if c in symbols]]
    volume = volume[[c for c in volume.columns if c in symbols]]

    if close.empty:
        return history

    dates = close.index.tolist()
    start_idx = max(1, len(dates) - lookback_days)

    for idx in range(start_idx, len(dates)):
        current_close = close.iloc[idx]
        previous_close = close.iloc[idx - 1]
        current_volume = volume.iloc[idx] if idx < len(volume.index) else pd.Series(dtype=float)

        valid_mask = current_close.notna() & previous_close.notna()
        up_mask = valid_mask & (current_close > previous_close)
        down_mask = valid_mask & (current_close < previous_close)

        advancing = int(up_mask.sum())
        declining = int(down_mask.sum())

        up_vol = float(current_volume[up_mask].sum()) if not current_volume.empty else 0.0
        down_vol = float(current_volume[down_mask].sum()) if not current_volume.empty else 0.0

        new_highs = 0
        new_lows = 0
        for symbol in symbols:
            series = close[symbol].dropna()
            if len(series) < 20:
                continue
            current_date = dates[idx]
            if current_date not in series.index:
                continue
            window = series.loc[:current_date].tail(252)
            if window.empty:
                continue
            current_price = float(series.loc[current_date])
            if current_price >= float(window.max()) * 0.999:
                new_highs += 1
            if current_price <= float(window.min()) * 1.001:
                new_lows += 1

        breadth_total = max(advancing + declining, 1)
        volume_total = max(up_vol + down_vol, 1.0)
        hl_total = max(new_highs + new_lows, 1)

        history.append(
            {
                "date": pd.Timestamp(dates[idx]).strftime("%Y-%m-%d"),
                "advancing": advancing,
                "declining": declining,
                "advancing_pct": float((advancing / breadth_total) * 100.0),
                "declining_pct": float((declining / breadth_total) * 100.0),
                "ad_rate": float(advancing - declining),
                "volume_advancing": up_vol,
                "volume_declining": down_vol,
                "volume_advancing_pct": float((up_vol / volume_total) * 100.0),
                "volume_declining_pct": float((down_vol / volume_total) * 100.0),
                "new_highs": new_highs,
                "new_lows": new_lows,
                "new_highs_pct": float((new_highs / hl_total) * 100.0),
                "new_lows_pct": float((new_lows / hl_total) * 100.0),
                "participation_pct": float((advancing + declining) / max(len(symbols), 1) * 100.0),
            }
        )

    return history


def _compute_bucket(symbols: List[str], label: str, lookback_days: int) -> Dict[str, object]:
    tickers = " ".join(symbols)
    data = yf.download(
        tickers=tickers,
        period="1y",
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=True,
        group_by="column",
    )

    close_frame, volume_frame = _extract_close_volume(data)
    if close_frame is None or volume_frame is None:
        return {
            "label": label,
            "advancing": 0,
            "declining": 0,
            "advancing_pct": 0.0,
            "declining_pct": 0.0,
            "volume_advancing": 0.0,
            "volume_declining": 0.0,
            "volume_advancing_pct": 0.0,
            "volume_declining_pct": 0.0,
            "new_highs": 0,
            "new_lows": 0,
            "new_highs_pct": 0.0,
            "new_lows_pct": 0.0,
            "participation_pct": 0.0,
            "universe_size": len(symbols),
            "history": [],
        }

    advancing = 0
    declining = 0
    volume_adv = 0.0
    volume_dec = 0.0
    new_highs = 0
    new_lows = 0

    def _get_series(frame: pd.DataFrame, symbol: str) -> pd.Series:
        if symbol in frame.columns:
            return frame[symbol]
        if "SINGLE" in frame.columns and len(symbols) == 1:
            return frame["SINGLE"]
        return pd.Series(dtype=float)

    for symbol in symbols:
        close_series = _get_series(close_frame, symbol).dropna()
        volume_series = _get_series(volume_frame, symbol).dropna()
        if len(close_series) < 3:
            continue

        current = float(close_series.iloc[-1])
        previous = float(close_series.iloc[-2])
        latest_volume = float(volume_series.iloc[-1]) if len(volume_series) else 0.0

        if current > previous:
            advancing += 1
            volume_adv += max(latest_volume, 0.0)
        elif current < previous:
            declining += 1
            volume_dec += max(latest_volume, 0.0)

        lookback = close_series.tail(252)
        if len(lookback) >= 20:
            max_52w = float(lookback.max())
            min_52w = float(lookback.min())
            if current >= max_52w * 0.999:
                new_highs += 1
            if current <= min_52w * 1.001:
                new_lows += 1

    active = max(advancing + declining, 1)
    volume_total = max(volume_adv + volume_dec, 1.0)
    hl_total = max(new_highs + new_lows, 1)

    history = _build_bucket_history(close_frame, volume_frame, symbols, lookback_days=lookback_days)

    participation_pct = (advancing + declining) / max(len(symbols), 1) * 100.0

    return {
        "label": label,
        "advancing": advancing,
        "declining": declining,
        "advancing_pct": (advancing / active) * 100.0,
        "declining_pct": (declining / active) * 100.0,
        "volume_advancing": volume_adv,
        "volume_declining": volume_dec,
        "volume_advancing_pct": (volume_adv / volume_total) * 100.0,
        "volume_declining_pct": (volume_dec / volume_total) * 100.0,
        "new_highs": new_highs,
        "new_lows": new_lows,
        "new_highs_pct": (new_highs / hl_total) * 100.0,
        "new_lows_pct": (new_lows / hl_total) * 100.0,
        "participation_pct": participation_pct,
        "universe_size": len(symbols),
        "history": history,
    }


@router.get("/market-internals/overview")
def get_market_internals_overview(days: int = Query(90, ge=30, le=365)) -> Dict[str, object]:
    now = datetime.utcnow()
    cached = _cached_by_days.get(days)
    if cached:
        cached_at = cached.get("cached_at")
        payload = cached.get("payload")
        if isinstance(cached_at, datetime) and payload and (now - cached_at).total_seconds() < _CACHE_TTL_SECONDS:
            return payload  # type: ignore[return-value]

    amex = _resolve_exchange_bucket("amex", "AMEX", AMEX_PROXY, lookback_days=days)
    nasdaq = _resolve_exchange_bucket("nsdq", "NSDQ", NASDAQ_PROXY, lookback_days=days)
    nyse = _resolve_exchange_bucket("nyse", "NYSE", NYSE_PROXY, lookback_days=days)

    combined_adv = amex["advancing"] + nasdaq["advancing"] + nyse["advancing"]
    combined_dec = amex["declining"] + nasdaq["declining"] + nyse["declining"]
    combined_volume_adv = amex["volume_advancing"] + nasdaq["volume_advancing"] + nyse["volume_advancing"]
    combined_volume_dec = amex["volume_declining"] + nasdaq["volume_declining"] + nyse["volume_declining"]
    combined_highs = amex["new_highs"] + nasdaq["new_highs"] + nyse["new_highs"]
    combined_lows = amex["new_lows"] + nasdaq["new_lows"] + nyse["new_lows"]

    breadth_total = max(combined_adv + combined_dec, 1)
    volume_total = max(combined_volume_adv + combined_volume_dec, 1.0)
    hl_total = max(combined_highs + combined_lows, 1)

    amex_history = {entry["date"]: entry for entry in amex.get("history", [])}
    nasdaq_history = {entry["date"]: entry for entry in nasdaq.get("history", [])}
    nyse_history = {entry["date"]: entry for entry in nyse.get("history", [])}
    combined_dates = sorted(set(amex_history.keys()) & set(nasdaq_history.keys()) & set(nyse_history.keys()))
    combined_history = []

    for date_key in combined_dates:
        amx = amex_history[date_key]
        ndx = nasdaq_history[date_key]
        ny = nyse_history[date_key]

        adv = int(amx["advancing"] + ndx["advancing"] + ny["advancing"])
        dec = int(amx["declining"] + ndx["declining"] + ny["declining"])
        vol_adv = float(amx["volume_advancing"] + ndx["volume_advancing"] + ny["volume_advancing"])
        vol_dec = float(amx["volume_declining"] + ndx["volume_declining"] + ny["volume_declining"])
        highs = int(amx["new_highs"] + ndx["new_highs"] + ny["new_highs"])
        lows = int(amx["new_lows"] + ndx["new_lows"] + ny["new_lows"])
        participation_pct = float(
            (
                float(amx.get("participation_pct", 0.0))
                + float(ndx.get("participation_pct", 0.0))
                + float(ny.get("participation_pct", 0.0))
            )
            / 3.0
        )

        breadth_total_hist = max(adv + dec, 1)
        volume_total_hist = max(vol_adv + vol_dec, 1.0)
        hl_total_hist = max(highs + lows, 1)

        combined_history.append(
            {
                "date": date_key,
                "advancing": adv,
                "declining": dec,
                "advancing_pct": float((adv / breadth_total_hist) * 100.0),
                "declining_pct": float((dec / breadth_total_hist) * 100.0),
                "ad_rate": float(adv - dec),
                "volume_advancing": vol_adv,
                "volume_declining": vol_dec,
                "volume_advancing_pct": float((vol_adv / volume_total_hist) * 100.0),
                "volume_declining_pct": float((vol_dec / volume_total_hist) * 100.0),
                "new_highs": highs,
                "new_lows": lows,
                "new_highs_pct": float((highs / hl_total_hist) * 100.0),
                "new_lows_pct": float((lows / hl_total_hist) * 100.0),
                "participation_pct": participation_pct,
            }
        )

    composite_participation_pct = (
        float(amex.get("participation_pct", 0.0))
        + float(nasdaq.get("participation_pct", 0.0))
        + float(nyse.get("participation_pct", 0.0))
    ) / 3.0

    payload = {
        "as_of": now.isoformat(),
        "composite": {
            "advancing": combined_adv,
            "declining": combined_dec,
            "advancing_pct": (combined_adv / breadth_total) * 100.0,
            "declining_pct": (combined_dec / breadth_total) * 100.0,
            "volume_advancing": combined_volume_adv,
            "volume_declining": combined_volume_dec,
            "volume_advancing_pct": (combined_volume_adv / volume_total) * 100.0,
            "volume_declining_pct": (combined_volume_dec / volume_total) * 100.0,
            "new_highs": combined_highs,
            "new_lows": combined_lows,
            "new_highs_pct": (combined_highs / hl_total) * 100.0,
            "new_lows_pct": (combined_lows / hl_total) * 100.0,
            "participation_pct": composite_participation_pct,
            "universe_size": len(AMEX_PROXY) + len(NASDAQ_PROXY) + len(NYSE_PROXY),
        },
        "days": days,
        "history": combined_history,
        "exchanges": {
            "amex": amex,
            "nsdq": nasdaq,
            "nasdaq": nasdaq,
            "nyse": nyse,
        },
    }

    _cached_by_days[days] = {"cached_at": now, "payload": payload}
    return payload
