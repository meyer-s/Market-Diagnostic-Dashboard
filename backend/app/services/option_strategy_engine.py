from __future__ import annotations

from datetime import datetime, timezone
import json
from math import isfinite
from typing import Any, Optional

import pandas as pd

from app.services.greeks_calculator import calculate_greeks
from app.services.market_data.date_utils import parse_option_expiry
from app.services.market_data.provider import MarketDataProvider
from app.services.options_quotes import option_quote_from_row, quote_number


STRATEGY_MODEL_VERSION = "risk_defined_structures_v1"
RISK_FREE_RATE = 0.0425
MAX_ACTIONABLE_LEG_SPREAD_PCT = 25.0


def strategy_event_fields(plan: Optional[dict[str, object]]) -> dict[str, object]:
    if not plan:
        return {}
    primary = plan.get("primary") if isinstance(plan.get("primary"), dict) else {}
    return {
        "selected_strategy_type": primary.get("strategy_type"),
        "strategy_model_version": plan.get("model_version") or STRATEGY_MODEL_VERSION,
        "strategy_plan_json": json.dumps(plan, separators=(",", ":"), sort_keys=True),
    }


def strategy_plan_from_event(event: object) -> Optional[dict[str, object]]:
    raw = getattr(event, "strategy_plan_json", None)
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _finite(value: object) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) else None


def _nearest_row(frame: pd.DataFrame, target: float) -> Optional[pd.Series]:
    if frame is None or frame.empty or "strike" not in frame.columns:
        return None
    usable = frame.copy()
    usable["strike"] = pd.to_numeric(usable["strike"], errors="coerce")
    usable = usable.dropna(subset=["strike"])
    if usable.empty:
        return None
    usable["distance"] = (usable["strike"] - target).abs()
    return usable.sort_values(["distance", "strike"]).iloc[0]


def _usable_frame(frame: pd.DataFrame, spot: float) -> pd.DataFrame:
    if frame is None or frame.empty or "strike" not in frame.columns:
        return pd.DataFrame()
    usable = frame.copy()
    usable["strike"] = pd.to_numeric(usable["strike"], errors="coerce")
    usable = usable.dropna(subset=["strike"])
    usable = usable[
        (usable["strike"] >= spot * 0.75)
        & (usable["strike"] <= spot * 1.25)
    ]
    if usable.empty:
        return usable
    usable["_premium"] = usable.apply(
        lambda row: option_quote_from_row(row).get("premium"), axis=1
    )
    return usable[usable["_premium"].apply(lambda value: _finite(value) is not None and float(value) > 0)]


def _leg(
    row: pd.Series,
    *,
    action: str,
    option_type: str,
    expiry: str,
    dte: int,
    quantity: int = 1,
    spot: float,
    fallback_volatility: float,
) -> dict[str, object]:
    quote = option_quote_from_row(row)
    strike = float(row["strike"])
    sigma = _finite(quote.get("implied_volatility")) or fallback_volatility
    if sigma > 5:
        sigma /= 100.0
    sigma = max(0.05, min(5.0, sigma))
    greeks = calculate_greeks(
        S=spot,
        K=strike,
        T=max(dte, 1) / 365.0,
        r=RISK_FREE_RATE,
        sigma=sigma,
        option_type=option_type,
    )
    return {
        "action": action,
        "option_type": option_type,
        "strike": strike,
        "expiration": expiry,
        "quantity": quantity,
        "bid": quote.get("bid"),
        "ask": quote.get("ask"),
        "last": quote.get("last"),
        "mid": quote.get("mid"),
        "premium": quote.get("premium"),
        "price_source": quote.get("price_source"),
        "spread_pct": quote.get("spread_pct"),
        "volume": quote.get("volume"),
        "open_interest": quote.get("open_interest"),
        "implied_volatility": quote.get("implied_volatility"),
        "last_trade_at": quote.get("last_trade_date"),
        "quote_source": quote.get("quote_source"),
        "quality": quote.get("quality"),
        "greeks": {
            "delta": float(greeks["delta"]),
            "gamma": float(greeks["gamma"]),
            "theta": float(greeks["theta"]),
            "vega": float(greeks["vega"]),
        },
    }


def _entry_debit(legs: list[dict[str, object]], price_field: str) -> Optional[float]:
    debit = 0.0
    for leg in legs:
        quantity = int(leg.get("quantity") or 0)
        price = _finite(leg.get(price_field))
        if quantity <= 0 or price is None or price <= 0:
            return None
        debit += (1 if leg.get("action") == "buy" else -1) * quantity * price
    return round(debit, 4) if debit > 0 else None


def _natural_debit(legs: list[dict[str, object]]) -> Optional[float]:
    debit = 0.0
    for leg in legs:
        quantity = int(leg.get("quantity") or 0)
        field = "ask" if leg.get("action") == "buy" else "bid"
        price = _finite(leg.get(field))
        if quantity <= 0 or price is None or price <= 0:
            return None
        debit += (1 if leg.get("action") == "buy" else -1) * quantity * price
    return round(debit, 4) if debit > 0 else None


def _terminal_value(legs: list[dict[str, object]], underlying: float) -> float:
    value = 0.0
    for leg in legs:
        strike = float(leg["strike"])
        quantity = int(leg.get("quantity") or 1)
        sign = 1 if leg.get("action") == "buy" else -1
        intrinsic = (
            max(underlying - strike, 0.0)
            if leg.get("option_type") == "call"
            else max(strike - underlying, 0.0)
        )
        value += sign * quantity * intrinsic
    return value


def _payoff_metrics(
    legs: list[dict[str, object]],
    debit: float,
    spot: float,
) -> tuple[Optional[float], str, list[float]]:
    strikes = sorted({float(leg["strike"]) for leg in legs})
    call_slope = sum(
        (1 if leg.get("action") == "buy" else -1) * int(leg.get("quantity") or 1)
        for leg in legs
        if leg.get("option_type") == "call"
    )
    max_profit = None
    max_profit_label = "Unlimited" if call_slope > 0 else "Defined"
    if call_slope <= 0:
        checkpoints = [0.0, *strikes, max(spot * 3.0, strikes[-1] * 2.0)]
        max_profit = max((_terminal_value(legs, point) - debit) * 100.0 for point in checkpoints)
        max_profit = round(max(0.0, max_profit), 2)

    boundaries = [0.0, *strikes, max(spot * 4.0, strikes[-1] * 3.0)]
    breakevens: list[float] = []
    for left, right in zip(boundaries, boundaries[1:]):
        left_value = _terminal_value(legs, left) - debit
        right_value = _terminal_value(legs, right) - debit
        if abs(left_value) < 1e-8:
            breakevens.append(left)
        if left_value * right_value < 0:
            root = left + (right - left) * (-left_value) / (right_value - left_value)
            breakevens.append(root)
    if abs(_terminal_value(legs, boundaries[-1]) - debit) < 1e-8:
        breakevens.append(boundaries[-1])
    normalized = sorted({round(value, 2) for value in breakevens if value > 0})
    return max_profit, max_profit_label, normalized


def reprice_defined_risk_strategy(
    legs: list[dict[str, object]],
    net_debit: float,
    *,
    spot: Optional[float] = None,
) -> dict[str, object]:
    """Recompute risk limits from an actual net debit rather than scanner quotes."""
    if len(legs) < 2 or not isfinite(float(net_debit)) or float(net_debit) <= 0:
        raise ValueError("A multi-leg debit strategy needs at least two legs and a positive net debit.")
    normalized: list[dict[str, object]] = []
    for leg in legs:
        action = str(leg.get("action") or "").strip().lower()
        option_type = str(leg.get("option_type") or "").strip().lower()
        strike = _finite(leg.get("strike"))
        quantity = int(leg.get("quantity") or 0)
        if action not in {"buy", "sell"} or option_type not in {"call", "put"}:
            raise ValueError("Each strategy leg needs buy/sell action and call/put option type.")
        if strike is None or strike <= 0 or quantity <= 0:
            raise ValueError("Each strategy leg needs a positive strike and quantity.")
        normalized.append({**leg, "action": action, "option_type": option_type, "strike": strike, "quantity": quantity})
    reference_spot = _finite(spot) or sum(float(leg["strike"]) for leg in normalized) / len(normalized)
    max_profit, max_profit_label, breakevens = _payoff_metrics(normalized, float(net_debit), reference_spot)
    return {
        "net_premium": round(float(net_debit), 4),
        "max_loss": round(float(net_debit) * 100.0, 2),
        "max_profit": max_profit,
        "max_profit_label": max_profit_label,
        "breakevens": breakevens,
    }


def validate_strategy_legs(
    strategy_type: str,
    legs: list[dict[str, object]],
) -> None:
    """Reject mislabeled structures before their risk receipt is persisted."""
    normalized_type = str(strategy_type or "").strip().lower()
    ordered = sorted(legs, key=lambda leg: float(leg["strike"]))

    if normalized_type in {"call_debit_spread", "put_debit_spread"}:
        option_type = "call" if normalized_type.startswith("call") else "put"
        if (
            len(ordered) != 2
            or any(leg.get("option_type") != option_type or int(leg.get("quantity") or 0) != 1 for leg in ordered)
        ):
            raise ValueError(f"{normalized_type} requires one long and one short {option_type}.")
        lower, upper = ordered
        valid_actions = (
            lower.get("action") == "buy" and upper.get("action") == "sell"
            if option_type == "call"
            else lower.get("action") == "sell" and upper.get("action") == "buy"
        )
        if not valid_actions or float(lower["strike"]) >= float(upper["strike"]):
            raise ValueError(f"{normalized_type} leg actions and strikes do not define the expected debit spread.")
        return

    if normalized_type in {"long_straddle", "long_strangle"}:
        if (
            len(ordered) != 2
            or any(leg.get("action") != "buy" or int(leg.get("quantity") or 0) != 1 for leg in ordered)
            or {leg.get("option_type") for leg in ordered} != {"call", "put"}
        ):
            raise ValueError(f"{normalized_type} requires one long call and one long put.")
        call_strike = float(next(leg["strike"] for leg in ordered if leg.get("option_type") == "call"))
        put_strike = float(next(leg["strike"] for leg in ordered if leg.get("option_type") == "put"))
        if normalized_type == "long_straddle" and call_strike != put_strike:
            raise ValueError("long_straddle requires matching call and put strikes.")
        if normalized_type == "long_strangle" and put_strike >= call_strike:
            raise ValueError("long_strangle requires the put strike below the call strike.")
        return

    if normalized_type in {"long_call_butterfly", "long_put_butterfly"}:
        option_type = "call" if "call" in normalized_type else "put"
        if (
            len(ordered) != 3
            or any(leg.get("option_type") != option_type for leg in ordered)
            or [leg.get("action") for leg in ordered] != ["buy", "sell", "buy"]
            or [int(leg.get("quantity") or 0) for leg in ordered] != [1, 2, 1]
        ):
            raise ValueError(f"{normalized_type} requires 1 long / 2 short / 1 long {option_type} legs.")
        lower, center, upper = (float(leg["strike"]) for leg in ordered)
        if lower >= center or center >= upper or abs((center - lower) - (upper - center)) > 1e-6:
            raise ValueError(f"{normalized_type} requires evenly spaced wing strikes.")
        return

    raise ValueError(f"Unsupported option strategy '{normalized_type}'.")


def _aggregate_greeks(legs: list[dict[str, object]]) -> dict[str, float]:
    totals = {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    for leg in legs:
        sign = 1 if leg.get("action") == "buy" else -1
        quantity = int(leg.get("quantity") or 1)
        greeks = leg.get("greeks") if isinstance(leg.get("greeks"), dict) else {}
        for key in totals:
            totals[key] += sign * quantity * float(greeks.get(key) or 0.0)
    return {
        "delta": round(totals["delta"], 4),
        "delta_shares": round(totals["delta"] * 100.0, 1),
        "gamma": round(totals["gamma"], 6),
        "theta": round(totals["theta"], 2),
        "vega": round(totals["vega"], 2),
    }


def _strategy(
    *,
    strategy_type: str,
    label: str,
    direction: str,
    volatility_exposure: str,
    expiration: str,
    dte: int,
    legs: list[dict[str, object]],
    spot: float,
    expected_move_pct: float,
    iv_hv_ratio: Optional[float],
    rationale: str,
    success_condition: str,
) -> Optional[dict[str, object]]:
    natural_debit = _natural_debit(legs)
    midpoint_debit = _entry_debit(legs, "mid")
    if natural_debit is None:
        return None
    max_profit, max_profit_label, breakevens = _payoff_metrics(legs, natural_debit, spot)
    quality_issues: list[str] = []
    for leg in legs:
        quality = str(leg.get("quality") or "missing")
        spread_pct = _finite(leg.get("spread_pct"))
        if quality in {"missing", "crossed", "last"}:
            quality_issues.append(
                f"{leg['action']} {leg['option_type']} {float(leg['strike']):g} quote is {quality}"
            )
        elif spread_pct is not None and spread_pct > MAX_ACTIONABLE_LEG_SPREAD_PCT:
            quality_issues.append(
                f"{leg['option_type']} {float(leg['strike']):g} spread is {spread_pct:.1f}%"
            )
    status = "actionable" if not quality_issues else "manual_price_discovery"
    return {
        "strategy_type": strategy_type,
        "label": label,
        "direction": direction,
        "volatility_exposure": volatility_exposure,
        "expiration": expiration,
        "dte": dte,
        "legs": legs,
        "net_debit": natural_debit,
        "midpoint_debit": midpoint_debit,
        "entry_price_basis": "natural (buy at ask, sell at bid)",
        "max_loss": round(natural_debit * 100.0, 2),
        "max_profit": max_profit,
        "max_profit_label": max_profit_label,
        "breakevens": breakevens,
        "risk_defined": True,
        "status": status,
        "quote_issues": quality_issues,
        "expected_move_pct": round(expected_move_pct, 2),
        "iv_hv_ratio": round(iv_hv_ratio, 2) if iv_hv_ratio is not None else None,
        "greeks": _aggregate_greeks(legs),
        "rationale": rationale,
        "success_condition": success_condition,
    }


def _nearest_expiry(
    provider: MarketDataProvider,
    symbol: str,
    *,
    target_dte: int,
    min_dte: int,
) -> tuple[Optional[str], Optional[int]]:
    try:
        expiries = provider.option_expirations(symbol)
    except Exception:
        return None, None
    today = datetime.now(timezone.utc).date()
    candidates: list[tuple[str, int]] = []
    for expiry in expiries:
        expiry_date = parse_option_expiry(expiry)
        if expiry_date is None:
            continue
        dte = (expiry_date - today).days
        if dte >= min_dte:
            candidates.append((expiry, dte))
    return min(candidates, key=lambda item: abs(item[1] - target_dte)) if candidates else (None, None)


def _butterfly_rows(
    frame: pd.DataFrame,
    *,
    target: float,
) -> Optional[tuple[pd.Series, pd.Series, pd.Series]]:
    if frame.empty:
        return None
    strikes = sorted(float(value) for value in frame["strike"].unique())
    if len(strikes) < 3:
        return None
    middle = min(strikes[1:-1], key=lambda value: abs(value - target))
    middle_index = strikes.index(middle)
    width = min(middle - strikes[middle_index - 1], strikes[middle_index + 1] - middle)
    if width <= 0:
        return None
    lower_target = middle - width
    upper_target = middle + width
    lower = _nearest_row(frame, lower_target)
    center = _nearest_row(frame, middle)
    upper = _nearest_row(frame, upper_target)
    if lower is None or center is None or upper is None:
        return None
    if not (float(lower["strike"]) < float(center["strike"]) < float(upper["strike"])):
        return None
    return lower, center, upper


def build_risk_defined_strategy(
    *,
    provider: MarketDataProvider,
    symbol: str,
    current_price: Optional[float],
    direction: str,
    hold_days: int,
    expected_move_pct: float,
    iv30: Optional[float],
    hv30: Optional[float],
    selected_contract: Optional[dict[str, object]] = None,
) -> Optional[dict[str, object]]:
    spot = _finite(current_price)
    if provider is None or spot is None or spot <= 0:
        return None
    normalized_direction = str(direction or "").strip().lower()
    directional_side = "call" if normalized_direction == "calls" else "put" if normalized_direction == "puts" else None
    expiry = str((selected_contract or {}).get("expiry") or "").strip() or None
    dte = int((selected_contract or {}).get("dte") or 0) or None
    if expiry is None or dte is None:
        expiry, dte = _nearest_expiry(
            provider,
            symbol,
            target_dte=60,
            min_dte=max(30, int(hold_days) + 14),
        )
    if expiry is None or dte is None:
        return None

    try:
        strikes = [
            strike
            for strike in provider.option_strikes(symbol, expiry)
            if spot * 0.75 <= float(strike) <= spot * 1.25
        ]
        chain = provider.option_chain(symbol, expiry, right="ALL", strikes=strikes)
    except Exception:
        return None
    calls = _usable_frame(chain.calls, spot)
    puts = _usable_frame(chain.puts, spot)
    if calls.empty or puts.empty:
        return None

    fallback_volatility = max(
        0.08,
        min(5.0, ((_finite(iv30) or _finite(hv30) or 30.0) / 100.0)),
    )
    iv_hv_ratio = (
        float(iv30) / float(hv30) * 100.0
        if _finite(iv30) is not None and _finite(hv30) is not None and float(hv30) > 0
        else None
    )
    move_pct = max(1.0, float(expected_move_pct))
    candidates: list[dict[str, object]] = []

    if directional_side is not None:
        frame = calls if directional_side == "call" else puts
        selected_strike = _finite((selected_contract or {}).get("strike"))
        long_row = _nearest_row(frame, selected_strike or spot)
        target_underlying = spot * (1 + move_pct / 100.0) if directional_side == "call" else spot * (1 - move_pct / 100.0)
        eligible = (
            frame[frame["strike"] > float(long_row["strike"])]
            if long_row is not None and directional_side == "call"
            else frame[frame["strike"] < float(long_row["strike"])]
            if long_row is not None
            else pd.DataFrame()
        )
        short_row = _nearest_row(eligible, target_underlying)
        if long_row is not None and short_row is not None:
            legs = [
                _leg(long_row, action="buy", option_type=directional_side, expiry=expiry, dte=dte, spot=spot, fallback_volatility=fallback_volatility),
                _leg(short_row, action="sell", option_type=directional_side, expiry=expiry, dte=dte, spot=spot, fallback_volatility=fallback_volatility),
            ]
            vertical = _strategy(
                strategy_type=f"{directional_side}_debit_spread",
                label="Bull call debit spread" if directional_side == "call" else "Bear put debit spread",
                direction="bullish" if directional_side == "call" else "bearish",
                volatility_exposure="moderately_long_vol",
                expiration=expiry,
                dte=dte,
                legs=legs,
                spot=spot,
                expected_move_pct=move_pct,
                iv_hv_ratio=iv_hv_ratio,
                rationale="Keeps the scanner's direction while the short leg lowers premium and defines the loss.",
                success_condition=f"Underlying moves toward {target_underlying:.2f} before time decay consumes the debit.",
            )
            if vertical:
                candidates.append(vertical)

        fly_rows = _butterfly_rows(frame, target=target_underlying)
        if fly_rows is not None:
            lower, center, upper = fly_rows
            fly_legs = [
                _leg(lower, action="buy", option_type=directional_side, expiry=expiry, dte=dte, spot=spot, fallback_volatility=fallback_volatility),
                _leg(center, action="sell", option_type=directional_side, expiry=expiry, dte=dte, quantity=2, spot=spot, fallback_volatility=fallback_volatility),
                _leg(upper, action="buy", option_type=directional_side, expiry=expiry, dte=dte, spot=spot, fallback_volatility=fallback_volatility),
            ]
            butterfly = _strategy(
                strategy_type=f"long_{directional_side}_butterfly",
                label=f"Long {directional_side} butterfly",
                direction="targeted",
                volatility_exposure="low_or_short_vol_near_target",
                expiration=expiry,
                dte=dte,
                legs=fly_legs,
                spot=spot,
                expected_move_pct=move_pct,
                iv_hv_ratio=iv_hv_ratio,
                rationale="Defines a narrow target zone with a small debit, but gives up profit if the move overshoots.",
                success_condition=f"Underlying finishes near the {float(center['strike']):g} center strike.",
            )
            if butterfly:
                candidates.append(butterfly)
    else:
        common_strikes = sorted(set(float(value) for value in calls["strike"]) & set(float(value) for value in puts["strike"]))
        if common_strikes:
            atm_strike = min(common_strikes, key=lambda value: abs(value - spot))
            call_row = _nearest_row(calls, atm_strike)
            put_row = _nearest_row(puts, atm_strike)
            if call_row is not None and put_row is not None:
                straddle = _strategy(
                    strategy_type="long_straddle",
                    label="Long straddle",
                    direction="bidirectional",
                    volatility_exposure="long_vol",
                    expiration=expiry,
                    dte=dte,
                    legs=[
                        _leg(call_row, action="buy", option_type="call", expiry=expiry, dte=dte, spot=spot, fallback_volatility=fallback_volatility),
                        _leg(put_row, action="buy", option_type="put", expiry=expiry, dte=dte, spot=spot, fallback_volatility=fallback_volatility),
                    ],
                    spot=spot,
                    expected_move_pct=move_pct,
                    iv_hv_ratio=iv_hv_ratio,
                    rationale="Buys movement in either direction when the scanner sees cheap implied volatility but no reliable direction.",
                    success_condition="The move exceeds the combined debit before theta decay dominates.",
                )
                if straddle:
                    candidates.append(straddle)

        call_row = _nearest_row(calls[calls["strike"] > spot], spot * (1 + move_pct * 0.35 / 100.0))
        put_row = _nearest_row(puts[puts["strike"] < spot], spot * (1 - move_pct * 0.35 / 100.0))
        if call_row is not None and put_row is not None and float(put_row["strike"]) < float(call_row["strike"]):
            strangle = _strategy(
                strategy_type="long_strangle",
                label="Long strangle",
                direction="bidirectional",
                volatility_exposure="long_vol",
                expiration=expiry,
                dte=dte,
                legs=[
                    _leg(call_row, action="buy", option_type="call", expiry=expiry, dte=dte, spot=spot, fallback_volatility=fallback_volatility),
                    _leg(put_row, action="buy", option_type="put", expiry=expiry, dte=dte, spot=spot, fallback_volatility=fallback_volatility),
                ],
                spot=spot,
                expected_move_pct=move_pct,
                iv_hv_ratio=iv_hv_ratio,
                rationale="Reduces premium versus the straddle while retaining defined-risk exposure to a large move either way.",
                success_condition="A larger move clears one of the wider breakevens before expiration.",
            )
            if strangle:
                candidates.append(strangle)

    if not candidates:
        return None
    if directional_side is not None:
        primary = next((item for item in candidates if item["strategy_type"].endswith("debit_spread")), candidates[0])
    else:
        prefer_strangle = iv_hv_ratio is not None and iv_hv_ratio <= 85.0 and move_pct >= 4.0
        preferred_type = "long_strangle" if prefer_strangle else "long_straddle"
        primary = next((item for item in candidates if item["strategy_type"] == preferred_type), candidates[0])
    alternatives = [item for item in candidates if item is not primary]
    return {
        "model_version": STRATEGY_MODEL_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "symbol": symbol.strip().upper(),
        "underlying_price": round(spot, 4),
        "market_read": {
            "direction": normalized_direction or "neutral",
            "expected_move_pct": round(move_pct, 2),
            "iv30": _finite(iv30),
            "hv30": _finite(hv30),
            "iv_hv_ratio": round(iv_hv_ratio, 2) if iv_hv_ratio is not None else None,
            "volatility_value": "cheap" if iv_hv_ratio is not None and iv_hv_ratio <= 90 else "roughly_fair",
        },
        "primary": primary,
        "alternatives": alternatives,
        "selection_note": (
            "Directional evidence favors a debit spread; the butterfly is retained only as a target-sensitive alternative."
            if directional_side is not None
            else "Direction is unresolved, so the plan buys volatility in both directions and chooses cost versus distance explicitly."
        ),
        "excluded_structures": [
            {
                "label": "Credit spreads and iron condors",
                "reason": "Not promoted while scanner admission requires IV30 at or below HV30; those structures sell volatility that the current screen identifies as inexpensive.",
            }
        ],
        "data_source": getattr(chain, "source", None) or getattr(provider, "name", "unknown"),
        "quote_source": getattr(chain, "quote_source", None),
        "observed_at": getattr(chain, "observed_at", None) or getattr(chain, "retrieved_at", None),
    }
