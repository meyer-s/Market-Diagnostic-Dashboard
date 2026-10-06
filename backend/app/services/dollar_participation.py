from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import math
import threading
import time
from typing import Any

import numpy as np
import pandas as pd

from app.services.market_data.factory import get_market_data_provider


LOOKBACK_SESSIONS = 63
MIN_BASELINE_SESSIONS = 42
RETURN_SESSIONS = 20
REGIME_ACTIVITY_THRESHOLD = 1.0
REGIME_RETURN_THRESHOLD_PCT = 1.0
_CACHE_TTL_SECONDS = 15 * 60
_CACHE: dict[int, dict[str, Any]] = {}
_CACHE_LOCK = threading.RLock()

INSTRUMENTS = {
    "DXY": {
        "provider_symbol": "DX-Y.NYB",
        "name": "ICE U.S. Dollar Index",
        "role": "Price benchmark",
        "direction": "U.S. dollar vs. six-currency basket",
        "leverage": "Index; not a fund",
    },
    "UUP": {
        "provider_symbol": "UUP",
        "name": "Invesco DB US Dollar Index Bullish Fund",
        "role": "Bullish activity proxy",
        "direction": "Long USDX futures exposure",
        "leverage": "1x directional; not leveraged",
    },
    "UDN": {
        "provider_symbol": "UDN",
        "name": "Invesco DB US Dollar Index Bearish Fund",
        "role": "Bearish activity proxy",
        "direction": "Short USDX futures exposure",
        "leverage": "1x inverse directional; not leveraged",
    },
}


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _round(value: Any, digits: int = 4) -> float | None:
    number = _finite(value)
    return round(number, digits) if number is not None else None


def _normalise_frame(frame: pd.DataFrame, code: str) -> pd.DataFrame:
    if frame is None or frame.empty:
        raise ValueError(f"No daily data returned for {code}")
    missing = {"Close", "Volume"} - set(frame.columns)
    if missing:
        raise ValueError(f"Daily data for {code} is missing {', '.join(sorted(missing))}")

    working = frame[["Close", "Volume"]].copy()
    index = pd.to_datetime(working.index, errors="coerce")
    if getattr(index, "tz", None) is not None:
        index = index.tz_convert("America/New_York").tz_localize(None)
    working.index = index.normalize()
    working.columns = [f"{code.lower()}_close", f"{code.lower()}_volume"]
    working = working[~working.index.isna()]
    working = working.apply(pd.to_numeric, errors="coerce")
    working = working.replace([np.inf, -np.inf], np.nan).dropna()
    close_column, volume_column = working.columns
    working = working[(working[close_column] > 0) & (working[volume_column] >= 0)]
    return working.groupby(level=0).last().sort_index()


def _rolling_robust_z(series: pd.Series) -> tuple[pd.Series, pd.Series]:
    logged = np.log1p(series.clip(lower=0))
    rolling = logged.rolling(LOOKBACK_SESSIONS, min_periods=MIN_BASELINE_SESSIONS)
    median = rolling.median()
    mad = rolling.apply(
        lambda values: float(np.median(np.abs(values - np.median(values)))),
        raw=True,
    )
    rolling_std = rolling.std(ddof=0)
    denominator = mad.where(mad > 1e-9, rolling_std / 1.4826)
    score = 0.67448975 * (logged - median) / denominator.replace(0, np.nan)
    score = score.clip(-3.0, 3.0)
    baseline = np.expm1(median).clip(lower=0)
    return score, baseline


def _classify_regime(
    dxy_return_pct: float | None,
    bull_excess: float | None,
    bear_excess: float | None,
) -> str:
    if dxy_return_pct is None or bull_excess is None or bear_excess is None:
        return "insufficient"
    tilt = bull_excess - bear_excess
    if bull_excess >= REGIME_ACTIVITY_THRESHOLD and bear_excess >= REGIME_ACTIVITY_THRESHOLD:
        return "two_sided"
    if abs(dxy_return_pct) >= REGIME_RETURN_THRESHOLD_PCT and max(bull_excess, bear_excess) < 0.75:
        return "price_led"
    if dxy_return_pct >= REGIME_RETURN_THRESHOLD_PCT and tilt >= REGIME_ACTIVITY_THRESHOLD:
        return "aligned_bull"
    if dxy_return_pct <= -REGIME_RETURN_THRESHOLD_PCT and tilt <= -REGIME_ACTIVITY_THRESHOLD:
        return "aligned_bear"
    if dxy_return_pct >= REGIME_RETURN_THRESHOLD_PCT and tilt <= -REGIME_ACTIVITY_THRESHOLD:
        return "bear_against_price"
    if dxy_return_pct <= -REGIME_RETURN_THRESHOLD_PCT and tilt >= REGIME_ACTIVITY_THRESHOLD:
        return "bull_against_price"
    if abs(dxy_return_pct) < REGIME_RETURN_THRESHOLD_PCT and abs(tilt) >= REGIME_ACTIVITY_THRESHOLD:
        return "activity_led"
    return "balanced"


REGIME_LABELS = {
    "insufficient": "Insufficient history",
    "two_sided": "Two-sided activity",
    "price_led": "Price moved without unusual activity",
    "aligned_bull": "DXY rose with bull activity",
    "aligned_bear": "DXY fell with bear activity",
    "bear_against_price": "Bear-heavy while DXY rose",
    "bull_against_price": "Bull-heavy while DXY fell",
    "activity_led": "Activity moved without a large DXY move",
    "balanced": "No unusual relationship",
}


def _regime_summary(regime: str) -> str:
    return {
        "two_sided": "Both matched products traded unusually heavily. That is broad participation, not proof of opposing investor positions.",
        "price_led": "DXY made a material 20-session move while both product-activity scores stayed below the unusual threshold.",
        "aligned_bull": "DXY rose while unusually high activity was concentrated in the bullish product.",
        "aligned_bear": "DXY fell while unusually high activity was concentrated in the bearish product.",
        "bear_against_price": "DXY rose while unusual activity was heavier in the bearish product. This is a divergence in observed activity, not a reversal signal.",
        "bull_against_price": "DXY fell while unusual activity was heavier in the bullish product. This is a divergence in observed activity, not a reversal signal.",
        "activity_led": "One side traded unusually heavily without a large 20-session DXY move.",
        "balanced": "Neither DXY movement nor one-sided product activity crossed the descriptive thresholds.",
        "insufficient": "The shared history is not yet long enough to establish a rolling activity baseline.",
    }[regime]


def _build_episodes(frame: pd.DataFrame) -> list[dict[str, Any]]:
    episodes: list[dict[str, Any]] = []
    working = frame[frame["regime"] != "insufficient"]
    if working.empty:
        return episodes
    group_ids = working["regime"].ne(working["regime"].shift()).cumsum()
    for _, group in working.groupby(group_ids):
        regime = str(group["regime"].iloc[0])
        if regime == "balanced" and len(group) < 5:
            continue
        start_close = _finite(group["dxy_close"].iloc[0])
        end_close = _finite(group["dxy_close"].iloc[-1])
        change = None
        if start_close and end_close:
            change = (end_close / start_close - 1.0) * 100.0
        episodes.append(
            {
                "start_date": group.index[0].date().isoformat(),
                "end_date": group.index[-1].date().isoformat(),
                "sessions": int(len(group)),
                "regime": regime,
                "label": REGIME_LABELS[regime],
                "dxy_change_pct": _round(change, 2),
                "average_tilt": _round(group["participation_tilt"].mean(), 2),
                "average_bull_excess": _round(group["bull_excess"].mean(), 2),
                "average_bear_excess": _round(group["bear_excess"].mean(), 2),
            }
        )
    return episodes[-12:][::-1]


def build_dollar_participation_from_frames(
    frames: dict[str, pd.DataFrame],
    *,
    days: int,
    provider: str,
) -> dict[str, Any]:
    normalized = {code: _normalise_frame(frames[code], code) for code in INSTRUMENTS}
    shared = normalized["DXY"].join(normalized["UUP"], how="inner").join(normalized["UDN"], how="inner")
    if len(shared) < MIN_BASELINE_SESSIONS + RETURN_SESSIONS:
        raise ValueError("Not enough shared DXY, UUP, and UDN sessions to build the activity baseline")

    for code in ("UUP", "UDN"):
        key = code.lower()
        shared[f"{key}_dollar_activity"] = shared[f"{key}_close"] * shared[f"{key}_volume"]
        score, baseline = _rolling_robust_z(shared[f"{key}_dollar_activity"])
        shared[f"{key}_activity_z"] = score
        shared[f"{key}_baseline_activity"] = baseline
        shared[f"{key}_activity_ratio"] = shared[f"{key}_dollar_activity"] / baseline.replace(0, np.nan)

    shared["bull_excess"] = shared["uup_activity_z"].clip(lower=0)
    shared["bear_excess"] = shared["udn_activity_z"].clip(lower=0)
    shared["participation_tilt"] = shared["bull_excess"] - shared["bear_excess"]
    shared["participation_intensity"] = shared["bull_excess"] + shared["bear_excess"]
    shared["dxy_return_20d_pct"] = shared["dxy_close"].pct_change(RETURN_SESSIONS) * 100.0
    shared["dxy_return_1d_pct"] = shared["dxy_close"].pct_change() * 100.0
    shared["same_day_association_63d"] = shared["dxy_return_1d_pct"].rolling(LOOKBACK_SESSIONS).corr(
        shared["participation_tilt"]
    )
    shared["regime"] = [
        _classify_regime(_finite(row.dxy_return_20d_pct), _finite(row.bull_excess), _finite(row.bear_excess))
        for row in shared.itertuples()
    ]

    scored = shared.dropna(subset=["uup_activity_z", "udn_activity_z", "dxy_return_20d_pct"])
    if scored.empty:
        raise ValueError("Shared history did not produce a complete rolling activity score")
    display = scored.tail(days).copy()
    base_close = float(display["dxy_close"].iloc[0])
    display["dxy_indexed"] = display["dxy_close"] / base_close * 100.0

    history: list[dict[str, Any]] = []
    for date, row in display.iterrows():
        history.append(
            {
                "date": date.date().isoformat(),
                "dxy_close": _round(row["dxy_close"], 4),
                "dxy_indexed": _round(row["dxy_indexed"], 4),
                "dxy_return_20d_pct": _round(row["dxy_return_20d_pct"], 4),
                "bull_activity_z": _round(row["uup_activity_z"], 4),
                "bear_activity_z": _round(row["udn_activity_z"], 4),
                "bull_excess": _round(row["bull_excess"], 4),
                "bear_excess": _round(row["bear_excess"], 4),
                "bear_plot": _round(-row["bear_excess"], 4),
                "participation_tilt": _round(row["participation_tilt"], 4),
                "participation_intensity": _round(row["participation_intensity"], 4),
                "bull_activity_ratio": _round(row["uup_activity_ratio"], 4),
                "bear_activity_ratio": _round(row["udn_activity_ratio"], 4),
                "same_day_association_63d": _round(row["same_day_association_63d"], 4),
                "regime": str(row["regime"]),
                "regime_label": REGIME_LABELS[str(row["regime"])],
            }
        )

    latest = display.iloc[-1]
    latest_regime = str(latest["regime"])
    as_of = display.index[-1].date().isoformat()
    age_days = (datetime.now(timezone.utc).date() - display.index[-1].date()).days
    warnings: list[str] = []
    if age_days > 5:
        warnings.append(f"The latest shared daily observation is {age_days} calendar days old.")
    minimum_source_count = min(len(value) for value in normalized.values())
    if minimum_source_count and len(shared) / minimum_source_count < 0.95:
        warnings.append("More than 5% of at least one instrument's dates did not align to the shared calendar.")

    instruments = []
    for code, definition in INSTRUMENTS.items():
        instruments.append(
            {
                "code": code,
                **definition,
                "observations_returned": len(normalized[code]),
                "shared_observations": len(shared),
                "normalization": (
                    "Indexed to 100 in the selected window"
                    if code == "DXY"
                    else "Log dollar activity versus its own trailing 63-session median and MAD"
                ),
            }
        )

    return {
        "as_of": as_of,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period": {
            "requested_sessions": days,
            "returned_sessions": len(display),
            "start_date": display.index[0].date().isoformat(),
            "end_date": as_of,
        },
        "current": {
            "regime": latest_regime,
            "regime_label": REGIME_LABELS[latest_regime],
            "summary": _regime_summary(latest_regime),
            "dxy_level": _round(latest["dxy_close"], 3),
            "dxy_return_20d_pct": _round(latest["dxy_return_20d_pct"], 2),
            "bull_activity_z": _round(latest["uup_activity_z"], 2),
            "bear_activity_z": _round(latest["udn_activity_z"], 2),
            "bull_activity_ratio": _round(latest["uup_activity_ratio"], 2),
            "bear_activity_ratio": _round(latest["udn_activity_ratio"], 2),
            "bull_dollar_activity": _round(latest["uup_dollar_activity"], 0),
            "bear_dollar_activity": _round(latest["udn_dollar_activity"], 0),
            "participation_tilt": _round(latest["participation_tilt"], 2),
            "participation_intensity": _round(latest["participation_intensity"], 2),
            "same_day_association_63d": _round(latest["same_day_association_63d"], 2),
        },
        "history": history,
        "episodes": _build_episodes(display),
        "instruments": instruments,
        "data_quality": {
            "status": "partial" if warnings else "ok",
            "provider": provider,
            "price_field": "Adjusted daily close",
            "volume_field": "Reported daily share volume",
            "alignment": "Exact shared market date; no forward fill",
            "shared_observations_before_scoring": len(shared),
            "warnings": warnings,
        },
        "methodology": {
            "activity": "Adjusted close multiplied by reported share volume. This is a dollar-activity proxy, not creations, holdings, or net flow.",
            "normalization": "Each product is compared only with its own trailing 63-session log dollar-activity distribution using a median and median absolute deviation. Scores are clipped at +/-3.",
            "tilt": "Only above-baseline activity contributes: max(UUP robust score, 0) minus max(UDN robust score, 0). Separate bull and bear scores remain visible so simultaneous activity is not hidden.",
            "regimes": "Descriptive labels use a 1.0 robust-score activity threshold and a 1% absolute 20-session DXY move. They are not fitted forecasts or trading rules.",
            "fund_size": "Self-normalization removes the misleading raw-volume comparison across differently sized funds. Historical daily AUM and shares outstanding are not available here, so this is not an AUM-turnover measure.",
            "instrument_choice": "UUP and UDN are the matched 1x long/short USDX-futures pair. Leveraged single-currency and broader-basket products are excluded because leverage path and tracking exposure would make the comparison less like-for-like.",
            "tracking": "UUP and UDN use futures and collateral. Futures carry and roll, fund fees, premium or discount to NAV, market hours, and session timing can make fund returns and trading activity imperfect proxies for the DXY spot benchmark.",
            "association": "The displayed 63-session correlation compares same-day DXY returns with participation tilt. Overlapping sessions, market-hour differences, and common volatility can affect it; correlation is descriptive, not causal.",
        },
        "sources": [
            {
                "label": "ICE U.S. Dollar Index methodology",
                "url": "https://www.ice.com/publicdocs/data/ICE_FX_Indexes_Methodology.pdf",
                "role": "DXY benchmark definition",
            },
            {
                "label": "Invesco UUP product definition",
                "url": "https://www.invesco.com/us/en/financial-products/etfs/invesco-db-us-dollar-index-bullish-fund.html",
                "role": "Bullish fund objective and tracked futures exposure",
            },
            {
                "label": "Invesco UDN product definition",
                "url": "https://www.invesco.com/us/en/financial-products/etfs/invesco-db-us-dollar-index-bearish-fund.html",
                "role": "Bearish fund objective and tracked futures exposure",
            },
        ],
    }


def _fetch_frames(days: int) -> tuple[dict[str, pd.DataFrame], str]:
    provider = get_market_data_provider("yahoo")
    requested_bars = days + LOOKBACK_SESSIONS + RETURN_SESSIONS + 10

    def fetch(code: str) -> tuple[str, pd.DataFrame]:
        symbol = INSTRUMENTS[code]["provider_symbol"]
        return code, provider.historical_bars(symbol, "1D", bars=requested_bars)

    with ThreadPoolExecutor(max_workers=3) as executor:
        frames = dict(executor.map(fetch, INSTRUMENTS))
    return frames, getattr(provider, "name", "yahoo")


def get_dollar_participation(days: int = 504) -> dict[str, Any]:
    days = max(126, min(1260, int(days)))
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(days)
        if cached and now - float(cached["cached_at"]) < _CACHE_TTL_SECONDS:
            return deepcopy(cached["payload"])

    frames, provider = _fetch_frames(days)
    payload = build_dollar_participation_from_frames(frames, days=days, provider=provider)
    with _CACHE_LOCK:
        _CACHE[days] = {"cached_at": now, "payload": deepcopy(payload)}
    return payload
