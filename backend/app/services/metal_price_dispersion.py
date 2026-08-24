"""Registry and normalization logic for cross-venue metal price comparisons.

The registry is deliberately broader than the currently connected feeds.  A
registered product is not treated as an observation until a provider supplies
the quote identity, timestamp, unit, and redistribution metadata required by
this module.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import statistics
from typing import Any, Iterable, Optional


TROY_OZ_PER_KG = 32.1507466
GRAMS_PER_TROY_OZ = 31.1034768
POUNDS_PER_KG = 2.2046226218
POUNDS_PER_METRIC_TONNE = 2204.6226218


METAL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "AU": {"name": "Gold", "canonical_currency": "USD", "canonical_unit": "troy oz"},
    "AG": {"name": "Silver", "canonical_currency": "USD", "canonical_unit": "troy oz"},
    "PT": {"name": "Platinum", "canonical_currency": "USD", "canonical_unit": "troy oz"},
    "PD": {"name": "Palladium", "canonical_currency": "USD", "canonical_unit": "troy oz"},
    "CU": {"name": "Copper", "canonical_currency": "USD", "canonical_unit": "lb"},
    "AL": {"name": "Aluminum", "canonical_currency": "USD", "canonical_unit": "metric tonne"},
}


def _venue(
    registry_id: str,
    venue: str,
    country: str,
    market_type: str,
    product_name: str,
    symbol: Optional[str],
    native_currency: str,
    native_unit: str,
    *,
    contract_size: Optional[str],
    purity: Optional[str],
    delivery_location: Optional[str],
    tax_basis: str,
    source_name: str,
    redistribution_status: str,
    liquidity_tier: str,
) -> dict[str, Any]:
    provider_prefix = registry_id.split("_", 1)[0]
    provider_id = "us_reference" if provider_prefix in {"comex", "nymex", "cme"} else provider_prefix
    return {
        "registry_id": registry_id,
        "venue": venue,
        "country": country,
        "market_type": market_type,
        "product_name": product_name,
        "symbol": symbol,
        "native_currency": native_currency,
        "native_unit": native_unit,
        "contract_size": contract_size,
        "purity": purity,
        "delivery_location": delivery_location,
        "tax_basis": tax_basis,
        "source_name": source_name,
        "redistribution_status": redistribution_status,
        "liquidity_tier": liquidity_tier,
        "provider_id": provider_id,
    }


# Product identity and access state live here, not in frontend cards.  Product
# codes are included only where the current source mapping is explicit.
EXCHANGE_REGISTRY: dict[str, tuple[dict[str, Any], ...]] = {
    "AG": (
        _venue("comex_silver", "COMEX", "United States", "futures", "COMEX Silver futures", "SI", "USD", "troy oz", contract_size="5,000 troy oz", purity="Exchange specification", delivery_location="COMEX approved depositories", tax_basis="Exchange futures; local tax not embedded", source_name="Yahoo Finance month-specific futures history", redistribution_status="Third-party provider terms", liquidity_tier="Core"),
        _venue("shfe_silver", "SHFE", "China", "futures", "Silver futures", "AG", "CNY", "kg", contract_size="15 kg", purity="Exchange specification", delivery_location="SHFE approved warehouses", tax_basis="Local contract basis; verify VAT treatment", source_name="Shanghai Futures Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("sge_ag9999", "SGE", "China", "physical spot", "Ag99.99", "Ag99.99", "CNY", "kg", contract_size=None, purity="99.99%", delivery_location="Shanghai Gold Exchange network", tax_basis="Physical-market tax basis; verify before comparison", source_name="Shanghai Gold Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Regional"),
        _venue("sge_ag_td", "SGE", "China", "deferred physical", "Silver deferred", "Ag(T+D)", "CNY", "kg", contract_size=None, purity="Exchange specification", delivery_location="Shanghai Gold Exchange network", tax_basis="Deferred physical tax basis; verify before comparison", source_name="Shanghai Gold Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Regional"),
        _venue("lbma_silver", "LBMA", "United Kingdom", "benchmark", "LBMA Silver Price", "LBMA Silver Price", "USD", "troy oz", contract_size=None, purity="Benchmark specification", delivery_location="London loco", tax_basis="Benchmark basis", source_name="LBMA Silver Price", redistribution_status="Usage licence required", liquidity_tier="Benchmark"),
        _venue("mcx_silver", "MCX", "India", "futures", "Silver futures", "SILVER", "INR", "kg", contract_size=None, purity="Exchange specification", delivery_location="MCX approved delivery centres", tax_basis="Local contract basis; verify duties and taxes", source_name="Multi Commodity Exchange of India", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("ose_silver", "OSE", "Japan", "futures", "Silver futures", None, "JPY", "gram", contract_size=None, purity="Exchange specification", delivery_location="OSE contract specification", tax_basis="Local contract basis", source_name="Osaka Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Regional"),
    ),
    "AU": (
        _venue("comex_gold", "COMEX", "United States", "futures", "COMEX Gold futures", "GC", "USD", "troy oz", contract_size="100 troy oz", purity="Exchange specification", delivery_location="COMEX approved depositories", tax_basis="Exchange futures; local tax not embedded", source_name="Yahoo Finance month-specific futures history", redistribution_status="Third-party provider terms", liquidity_tier="Core"),
        _venue("lbma_gold", "LBMA", "United Kingdom", "benchmark", "LBMA Gold Price", "LBMA Gold Price", "USD", "troy oz", contract_size=None, purity="Benchmark specification", delivery_location="London loco", tax_basis="Benchmark basis", source_name="LBMA Gold Price", redistribution_status="Usage licence review required", liquidity_tier="Benchmark"),
        _venue("sge_au9999", "SGE", "China", "physical spot", "Au99.99", "Au99.99", "CNY", "gram", contract_size=None, purity="99.99%", delivery_location="Shanghai Gold Exchange network", tax_basis="Physical-market tax basis; verify before comparison", source_name="Shanghai Gold Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("shfe_gold", "SHFE", "China", "futures", "Gold futures", "AU", "CNY", "gram", contract_size=None, purity="Exchange specification", delivery_location="SHFE approved warehouses", tax_basis="Local contract basis; verify VAT treatment", source_name="Shanghai Futures Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("mcx_gold", "MCX", "India", "futures", "Gold futures", "GOLD", "INR", "10 gram", contract_size=None, purity="Exchange specification", delivery_location="MCX approved delivery centres", tax_basis="Local contract basis; verify duties and taxes", source_name="Multi Commodity Exchange of India", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("ose_gold", "OSE", "Japan", "futures", "Gold Standard futures", None, "JPY", "gram", contract_size=None, purity="Exchange specification", delivery_location="OSE contract specification", tax_basis="Local contract basis", source_name="Osaka Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
    ),
    "PT": (
        _venue("nymex_platinum", "NYMEX", "United States", "futures", "NYMEX Platinum futures", "PL", "USD", "troy oz", contract_size="50 troy oz", purity="Exchange specification", delivery_location="NYMEX approved depositories", tax_basis="Exchange futures; local tax not embedded", source_name="Yahoo Finance month-specific futures history", redistribution_status="Third-party provider terms", liquidity_tier="Core"),
        _venue("lbma_platinum", "LBMA", "United Kingdom", "benchmark", "LBMA Platinum Price", "LBMA Platinum Price", "USD", "troy oz", contract_size=None, purity="Benchmark specification", delivery_location="London loco", tax_basis="Benchmark basis", source_name="LBMA Platinum Price", redistribution_status="Usage licence review required", liquidity_tier="Benchmark"),
        _venue("sge_pt9995", "SGE", "China", "physical spot", "Pt99.95", "Pt99.95", "CNY", "gram", contract_size=None, purity="99.95%", delivery_location="Shanghai Gold Exchange network", tax_basis="Physical-market tax basis; verify before comparison", source_name="Shanghai Gold Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Regional"),
        _venue("ose_platinum", "OSE", "Japan", "futures", "Platinum Standard futures", None, "JPY", "gram", contract_size=None, purity="Exchange specification", delivery_location="OSE contract specification", tax_basis="Local contract basis", source_name="Osaka Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
    ),
    "PD": (
        _venue("nymex_palladium", "NYMEX", "United States", "futures", "NYMEX Palladium futures", "PA", "USD", "troy oz", contract_size="100 troy oz", purity="Exchange specification", delivery_location="NYMEX approved depositories", tax_basis="Exchange futures; local tax not embedded", source_name="Yahoo Finance month-specific futures history", redistribution_status="Third-party provider terms", liquidity_tier="Core"),
        _venue("lbma_palladium", "LBMA", "United Kingdom", "benchmark", "LBMA Palladium Price", "LBMA Palladium Price", "USD", "troy oz", contract_size=None, purity="Benchmark specification", delivery_location="London loco", tax_basis="Benchmark basis", source_name="LBMA Palladium Price", redistribution_status="Usage licence review required", liquidity_tier="Benchmark"),
        _venue("sge_pd9995", "SGE", "China", "physical spot", "Pd99.95", "Pd99.95", "CNY", "gram", contract_size=None, purity="99.95%", delivery_location="Shanghai Gold Exchange network", tax_basis="Physical-market tax basis; verify before comparison", source_name="Shanghai Gold Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Regional"),
        _venue("ose_palladium", "OSE", "Japan", "futures", "Palladium futures", "FUT_PALD", "JPY", "gram", contract_size="500 gram", purity="Exchange specification", delivery_location="OSE designated warehouses", tax_basis="Local contract basis; delivery can be subject to consumption tax", source_name="Japan Exchange Group settlement CSV", redistribution_status="Official public settlement file; JPX terms apply", liquidity_tier="Regional"),
    ),
    "CU": (
        _venue("comex_copper", "COMEX", "United States", "continuous futures proxy", "Copper continuous futures series", "HG=F", "USD", "lb", contract_size=None, purity="Provider series; contract identity unavailable", delivery_location="Provider series; verify listed contract", tax_basis="Futures proxy; tax not embedded", source_name="Stored Yahoo Finance daily history", redistribution_status="Third-party provider terms", liquidity_tier="Core"),
        _venue("lme_copper", "LME", "United Kingdom", "futures", "LME Copper", None, "USD", "metric tonne", contract_size=None, purity="Exchange specification", delivery_location="LME approved warehouses", tax_basis="Exchange contract basis", source_name="London Metal Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("shfe_copper", "SHFE", "China", "futures", "Copper futures", "CU", "CNY", "metric tonne", contract_size=None, purity="Exchange specification", delivery_location="SHFE approved warehouses", tax_basis="Local contract basis; verify VAT treatment", source_name="Shanghai Futures Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("mcx_copper", "MCX", "India", "futures", "Copper futures", "COPPER", "INR", "kg", contract_size=None, purity="Exchange specification", delivery_location="MCX approved delivery centres", tax_basis="Local contract basis; verify duties and taxes", source_name="Multi Commodity Exchange of India", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
    ),
    "AL": (
        _venue("cme_aluminum", "CME", "United States", "continuous futures proxy", "Aluminum continuous futures series", "ALI=F", "USD", "metric tonne", contract_size=None, purity="Provider series; contract identity unavailable", delivery_location="Provider series; verify listed contract", tax_basis="Futures proxy; tax not embedded", source_name="Stored Yahoo Finance daily history", redistribution_status="Third-party provider terms", liquidity_tier="Regional"),
        _venue("lme_aluminum", "LME", "United Kingdom", "futures", "LME Aluminum", None, "USD", "metric tonne", contract_size=None, purity="Exchange specification", delivery_location="LME approved warehouses", tax_basis="Exchange contract basis", source_name="London Metal Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("shfe_aluminum", "SHFE", "China", "futures", "Aluminum futures", "AL", "CNY", "metric tonne", contract_size=None, purity="Exchange specification", delivery_location="SHFE approved warehouses", tax_basis="Local contract basis; verify VAT treatment", source_name="Shanghai Futures Exchange", redistribution_status="Official/licensed feed required", liquidity_tier="Core"),
        _venue("mcx_aluminum", "MCX", "India", "futures", "Aluminium futures", "ALUMINIUM", "INR", "kg", contract_size=None, purity="Exchange specification", delivery_location="MCX approved delivery centres", tax_basis="Local contract basis; verify duties and taxes", source_name="Multi Commodity Exchange of India", redistribution_status="Official/licensed feed required", liquidity_tier="Regional"),
    ),
}


DEFAULT_REFERENCE_IDS = {
    "AU": "comex_gold",
    "AG": "comex_silver",
    "PT": "nymex_platinum",
    "PD": "nymex_palladium",
    "CU": "comex_copper",
    "AL": "cme_aluminum",
}

PROVIDER_ACCESS_STATUS = {
    "shfe": "Official public Daily Express; venue usage and redistribution terms apply",
    "sge": "Official public daily quotation; venue usage and redistribution terms apply",
    "lbma": "Public delayed benchmark; commercial, valuation, or derived use may require an IBA or LME licence",
    "mcx": "Official public bhavcopy; usage and redistribution are governed by MCX terms",
    "ose": "Official public settlement CSV; JPX usage terms apply",
    "lme": "Public day-delayed display or labeled secondary cash-settlement fallback; distribution or derived use may require an LME licence",
}


def normalize_metal_price(
    metal: str,
    local_price: float,
    currency: str,
    native_unit: str,
    local_currency_per_usd: Optional[float],
) -> float:
    """Convert a local quote into the metal's declared canonical USD unit."""
    if metal not in METAL_DEFINITIONS:
        raise ValueError(f"Unsupported metal: {metal}")
    if local_price <= 0:
        raise ValueError("Price must be positive")
    if currency != "USD" and (local_currency_per_usd is None or local_currency_per_usd <= 0):
        raise ValueError("A positive local-currency-per-USD FX rate is required")

    usd_price = local_price if currency == "USD" else local_price / float(local_currency_per_usd)
    unit = native_unit.strip().lower()
    canonical_unit = METAL_DEFINITIONS[metal]["canonical_unit"]

    if canonical_unit == "troy oz":
        factors = {
            "troy oz": 1.0,
            "kg": 1.0 / TROY_OZ_PER_KG,
            "gram": GRAMS_PER_TROY_OZ,
            "10 gram": GRAMS_PER_TROY_OZ / 10.0,
            "metric tonne": 1.0 / (TROY_OZ_PER_KG * 1000.0),
        }
    elif canonical_unit == "lb":
        factors = {
            "lb": 1.0,
            "kg": 1.0 / POUNDS_PER_KG,
            "metric tonne": 1.0 / POUNDS_PER_METRIC_TONNE,
        }
    else:
        factors = {
            "metric tonne": 1.0,
            "kg": 1000.0,
            "lb": POUNDS_PER_METRIC_TONNE,
        }

    if unit not in factors:
        raise ValueError(f"Unsupported quote unit {native_unit!r} for {metal}")
    return usd_price * factors[unit]


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _freshness(value: Optional[str], now: datetime) -> tuple[str, Optional[float]]:
    parsed = _parse_timestamp(value)
    if parsed is None:
        return "unknown", None
    age_hours = max(0.0, (now - parsed).total_seconds() / 3600.0)
    if age_hours <= 36:
        return "fresh", age_hours
    if age_hours <= 96:
        return "delayed", age_hours
    return "stale", age_hours


def _comparison_status(
    row: dict[str, Any],
    reference: dict[str, Any],
    comparison_time: str,
) -> tuple[str, list[str]]:
    if row["registry_id"] == reference.get("registry_id"):
        incomplete_identity = []
        if not row.get("contract_month"):
            incomplete_identity.append("listed contract month is unavailable")
        if "proxy" in str(row.get("market_type", "")) or "continuous" in str(row.get("market_type", "")):
            incomplete_identity.append("continuous-series identity is not a listed contract")
        if not row.get("quote_timestamp"):
            incomplete_identity.append("quote timestamp is unavailable")
        if incomplete_identity:
            return "reference_only", incomplete_identity
        return "reference", []

    mismatches: list[tuple[str, str, bool]] = []
    reference_status, _ = _comparison_status(reference, reference, comparison_time)
    if reference_status == "reference_only":
        mismatches.append(("reference_identity", "reference instrument identity is incomplete", False))
    if row.get("market_type") != reference.get("market_type"):
        mismatches.append(("market_type", "market type differs", False))
    if not row.get("contract_month") or row.get("contract_month") != reference.get("contract_month"):
        mismatches.append(("carry", "delivery month is not matched", True))
    if row.get("tax_basis") != reference.get("tax_basis"):
        mismatches.append(("tax", "tax basis differs", True))
    if row.get("purity") != reference.get("purity"):
        mismatches.append(("delivery", "purity basis differs", True))
    if row.get("delivery_location") != reference.get("delivery_location"):
        mismatches.append(("delivery", "delivery location differs", True))

    row_time = _parse_timestamp(row.get("quote_timestamp"))
    reference_time = _parse_timestamp(reference.get("quote_timestamp"))
    if row_time is None or reference_time is None:
        mismatches.append(("timestamp", "common quote time is unavailable", False))
    else:
        tolerance_minutes = {
            "common_timestamp": 15.0,
            "latest_available": 24.0 * 60.0,
            "daily_settlement": 36.0 * 60.0,
        }[comparison_time]
        delta_minutes = abs((row_time - reference_time).total_seconds()) / 60.0
        if delta_minutes > tolerance_minutes:
            mismatches.append(("timestamp", f"quote times differ by {delta_minutes / 60.0:.1f} hours", False))

    if not mismatches:
        return "comparable", []
    adjustment_values = row.get("adjustment_values_pct") or {}
    if all(
        adjustable and isinstance(adjustment_values.get(key), (int, float))
        for key, _label, adjustable in mismatches
    ):
        return "adjusted", [label for _key, label, _adjustable in mismatches]
    return "headline_only", [label for _key, label, _adjustable in mismatches]


def _normalize_observation(metal: str, registry_row: dict[str, Any], observation: dict[str, Any], now: datetime) -> dict[str, Any]:
    row = {**registry_row, **observation}
    try:
        row["normalized_price"] = normalize_metal_price(
            metal,
            float(row["local_price"]),
            str(row["currency"]),
            str(row["native_unit"]),
            row.get("fx_rate_local_per_usd"),
        )
        row["normalization_error"] = None
    except (KeyError, TypeError, ValueError) as exc:
        row["normalized_price"] = None
        row["normalization_error"] = str(exc)

    freshness, age_hours = _freshness(row.get("quote_timestamp"), now)
    row["availability_status"] = "observed" if row["normalized_price"] is not None else "unavailable"
    row["freshness_status"] = freshness
    row["quote_age_hours"] = round(age_hours, 1) if age_hours is not None else None
    return row


def build_global_price_dispersion(
    metal: str,
    observations: Iterable[dict[str, Any]],
    *,
    reference: str = "auto",
    comparison_time: str = "latest_available",
    basis: str = "raw_converted",
    now: Optional[datetime] = None,
    source_statuses: Optional[Iterable[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Build an inspectable comparison response from provider observations."""
    metal = metal.upper()
    if metal not in METAL_DEFINITIONS:
        raise ValueError(f"Unsupported metal: {metal}")
    if comparison_time not in {"latest_available", "common_timestamp", "daily_settlement"}:
        raise ValueError(f"Unsupported comparison time: {comparison_time}")
    if basis not in {"raw_converted", "tax_adjusted", "delivery_adjusted"}:
        raise ValueError(f"Unsupported basis: {basis}")

    comparison_time_applied = comparison_time if comparison_time == "latest_available" else "latest_available"

    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    registry = [deepcopy(row) for row in EXCHANGE_REGISTRY[metal]]
    registry_by_id = {row["registry_id"]: row for row in registry}
    observation_by_id = {row["registry_id"]: row for row in observations if row.get("registry_id") in registry_by_id}
    source_status_list = [dict(row) for row in (source_statuses or [])]
    source_status_by_id = {row.get("provider_id"): row for row in source_status_list}

    rows: list[dict[str, Any]] = []
    for registry_row in registry:
        access_status = PROVIDER_ACCESS_STATUS.get(registry_row.get("provider_id"))
        if access_status:
            registry_row["redistribution_status"] = access_status
        observation = observation_by_id.get(registry_row["registry_id"])
        if observation:
            rows.append(_normalize_observation(metal, registry_row, observation, now))
        else:
            provider_status = source_status_by_id.get(registry_row.get("provider_id"))
            if provider_status and provider_status.get("status") in {"live", "cached", "stale_cache"}:
                data_delay = "Latest official publication contained no qualifying quote for this product"
                unavailable_reason = "No qualifying quote was published in the latest official source response"
            elif provider_status and provider_status.get("status") == "unavailable":
                data_delay = "Official source request failed and no cached observation was available"
                unavailable_reason = "Official source unavailable; no cached observation is available"
            else:
                data_delay = "Feed not connected"
                unavailable_reason = "Official or licensed quote feed is not connected"
            rows.append({
                **registry_row,
                "contract_month": None,
                "local_price": None,
                "currency": registry_row["native_currency"],
                "fx_rate_local_per_usd": None,
                "fx_timestamp": None,
                "normalized_price": None,
                "premium_pct": None,
                "premium_type": None,
                "price_type": None,
                "quote_timestamp": None,
                "session_status": "unavailable",
                "freshness_status": "unavailable",
                "quote_age_hours": None,
                "data_delay": data_delay,
                "volume": None,
                "open_interest": None,
                "availability_status": "unavailable",
                "comparability_status": "unavailable",
                "comparability_reasons": [unavailable_reason],
                "normalization_error": None,
                "decomposition": None,
            })

    observed = [row for row in rows if row["availability_status"] == "observed"]
    default_reference_id = DEFAULT_REFERENCE_IDS[metal]
    requested_reference = reference
    reference_resolution = "requested"

    reference_row: Optional[dict[str, Any]] = None
    matching_reference_row: Optional[dict[str, Any]] = None
    reference_price: Optional[float] = None
    using_global_median = False
    if reference == "global_median" and observed:
        matching_reference_row = next((row for row in observed if row["registry_id"] == default_reference_id), observed[0])
        median_candidates = []
        for row in observed:
            candidate_status, _ = _comparison_status(row, matching_reference_row, comparison_time_applied)
            if candidate_status in {"reference", "comparable", "adjusted"}:
                median_candidates.append(row["normalized_price"])
        if len(median_candidates) >= 2:
            reference_price = statistics.median(median_candidates)
            using_global_median = True
        else:
            reference_row = matching_reference_row
            reference_price = reference_row["normalized_price"]
            reference_resolution = "median_unavailable_fallback"
    else:
        target_id = default_reference_id if reference == "auto" else reference
        reference_row = next((row for row in observed if row["registry_id"] == target_id), None)
        if reference_row is None and observed:
            reference_row = observed[0]
            reference_resolution = "fallback_to_observed"
        reference_price = reference_row.get("normalized_price") if reference_row else None
        matching_reference_row = reference_row

    for row in observed:
        if reference_price:
            row["premium_pct"] = ((row["normalized_price"] / reference_price) - 1.0) * 100.0
        else:
            row["premium_pct"] = None

        if matching_reference_row:
            status, reasons = _comparison_status(row, matching_reference_row, comparison_time_applied)
            if using_global_median and status == "reference":
                status = "comparable"
        else:
            status, reasons = "headline_only", ["Global median is a statistical reference, not a matched instrument"]
        row["comparability_status"] = status
        row["comparability_reasons"] = reasons
        row["premium_type"] = "comparable_premium" if status in {"reference", "comparable", "adjusted"} else "headline_gap"
        adjustment_values = row.get("adjustment_values_pct") or {}
        known_adjustment_total = sum(
            float(adjustment_values[key]) for key in ("carry", "tax", "delivery")
            if isinstance(adjustment_values.get(key), (int, float))
        )
        row["decomposition"] = {
            "reference_price": reference_price,
            "fx_conversion_pct": 0.0 if row.get("currency") == "USD" else None,
            "carry_adjustment_pct": 0.0 if status == "reference" else adjustment_values.get("carry"),
            "tax_adjustment_pct": 0.0 if status == "reference" else adjustment_values.get("tax"),
            "delivery_adjustment_pct": 0.0 if status == "reference" else adjustment_values.get("delivery"),
            "unexplained_basis_pct": 0.0 if status in {"reference", "reference_only"} else (
                row.get("premium_pct") - known_adjustment_total if row.get("premium_pct") is not None else None
            ),
        }

    liquidity_order = {"Core": 0, "Benchmark": 1, "Regional": 2}
    rows.sort(key=lambda row: (
        row["availability_status"] != "observed",
        liquidity_order.get(row.get("liquidity_tier"), 3),
        -(row.get("normalized_price") or 0.0),
        row["venue"],
    ))

    credible = [row for row in rows if row.get("comparability_status") in {"reference", "comparable", "adjusted"}]
    comparison_ready = len(credible) >= 2
    credible_prices = [row["normalized_price"] for row in credible]
    highest = max(credible, key=lambda row: row["normalized_price"]) if comparison_ready else None
    lowest = min(credible, key=lambda row: row["normalized_price"]) if comparison_ready else None
    median_price = statistics.median(credible_prices) if comparison_ready else None
    dispersion_pct = ((highest["normalized_price"] / lowest["normalized_price"]) - 1.0) * 100.0 if highest and lowest and lowest["normalized_price"] else None

    status_counts = {
        "fresh": sum(row.get("freshness_status") == "fresh" for row in rows),
        "delayed": sum(row.get("freshness_status") == "delayed" for row in rows),
        "stale": sum(row.get("freshness_status") == "stale" for row in rows),
        "unavailable": sum(row.get("availability_status") == "unavailable" for row in rows),
        "session_unverified": sum(row.get("session_status") == "unverified" for row in rows),
    }

    basis_applied = basis if basis == "raw_converted" else "raw_converted"
    limitations = []
    if basis_applied != basis:
        limitations.append("Requested basis is unavailable because tax or delivery adjustments are incomplete")
    if comparison_time_applied != comparison_time:
        limitations.append("Requested time policy is unavailable because common-time observations are incomplete")
    if not comparison_ready:
        limitations.append("At least two matched, normalized observations are required to calculate dispersion")

    reference_label = "Global median" if using_global_median else (reference_row["venue"] if reference_row else "Unavailable")
    return {
        "as_of": now.isoformat(),
        "metal": metal,
        "metal_name": METAL_DEFINITIONS[metal]["name"],
        "canonical_currency": METAL_DEFINITIONS[metal]["canonical_currency"],
        "canonical_unit": METAL_DEFINITIONS[metal]["canonical_unit"],
        "comparison_ready": comparison_ready,
        "controls": {
            "comparison_time_requested": comparison_time,
            "comparison_time_applied": comparison_time_applied,
            "reference_requested": requested_reference,
            "reference_resolution": reference_resolution,
            "basis_requested": basis,
            "basis_applied": basis_applied,
        },
        "reference": {
            "registry_id": "global_median" if using_global_median else (reference_row.get("registry_id") if reference_row else None),
            "label": reference_label,
            "normalized_price": reference_price,
        },
        "summary": {
            "global_median": median_price,
            "highest": {"venue": highest["venue"], "price": highest["normalized_price"]} if highest else None,
            "lowest": {"venue": lowest["venue"], "price": lowest["normalized_price"]} if lowest else None,
            "dispersion_pct": dispersion_pct,
            "registered_venues": len(rows),
            "observed_venues": len(observed),
            "comparable_venues": len(credible),
            "status_counts": status_counts,
        },
        "venues": rows,
        "sources": source_status_list,
        "limitations": limitations,
        "method": {
            "normalization": "Local quote divided by local-currency-per-USD FX, then converted into the declared canonical unit.",
            "premium": "(normalized venue price / normalized reference price - 1) * 100",
            "comparability_rule": "Comparable requires matched market type, delivery month, purity, delivery location, tax basis, and quote times within the applied policy tolerance. Only individually sourced carry, tax, or delivery adjustments can promote an adjusted comparison.",
            "license_rule": "Registry coverage does not imply redistribution rights or a connected feed.",
        },
        "supported_metals": [
            {"metal": code, "name": definition["name"], "canonical_unit": definition["canonical_unit"]}
            for code, definition in METAL_DEFINITIONS.items()
        ],
    }


def build_global_price_history(
    metal: str,
    observations: Iterable[dict[str, Any]],
    *,
    days: int,
    source_statuses: Optional[Iterable[dict[str, Any]]] = None,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Build a continuous daily-return composite plus source-backed venue paths."""
    metal = metal.upper()
    if metal not in METAL_DEFINITIONS:
        raise ValueError(f"Unsupported metal: {metal}")
    if days < 7 or days > 365:
        raise ValueError("History range must be between 7 and 365 days")

    generated_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    registry = {row["registry_id"]: deepcopy(row) for row in EXCHANGE_REGISTRY[metal]}
    status_list = [dict(row) for row in (source_statuses or [])]
    status_by_provider = {row.get("provider_id"): row for row in status_list}
    observation_by_series_date: dict[tuple[str, str], dict[str, Any]] = {}

    for observation in observations:
        registry_id = observation.get("registry_id")
        registry_row = registry.get(registry_id)
        quote_timestamp = str(observation.get("quote_timestamp") or "")
        quote_date = quote_timestamp[:10]
        if registry_row is None or len(quote_date) != 10:
            continue
        try:
            normalized_price = normalize_metal_price(
                metal,
                float(observation["local_price"]),
                str(observation["currency"]),
                str(observation["native_unit"]),
                observation.get("fx_rate_local_per_usd"),
            )
        except (KeyError, TypeError, ValueError):
            continue
        observation_by_series_date[(str(registry_id), quote_date)] = {
            **registry_row,
            **observation,
            "quote_date": quote_date,
            "normalized_price": normalized_price,
        }

    grouped: dict[str, list[dict[str, Any]]] = {}
    for (registry_id, _quote_date), observation in observation_by_series_date.items():
        grouped.setdefault(registry_id, []).append(observation)

    series = []
    return_candidates_by_date: dict[str, list[dict[str, Any]]] = {}
    for registry_id, rows in grouped.items():
        rows.sort(key=lambda row: row["quote_date"])
        if len(rows) < 2:
            continue
        baseline_price = rows[0]["normalized_price"]
        if baseline_price <= 0:
            continue
        sample = rows[-1]
        provider_status = status_by_provider.get(sample.get("provider_id"), {})
        source_tier = provider_status.get("source_tier") or (
            "reference_only" if sample.get("provider_id") == "us_reference" else "unclassified"
        )
        points = []
        previous_row = None
        for row in rows:
            index_value = (row["normalized_price"] / baseline_price) * 100.0
            daily_return_pct = None
            if previous_row is not None:
                previous_date = datetime.fromisoformat(previous_row["quote_date"]).date()
                current_date = datetime.fromisoformat(row["quote_date"]).date()
                gap_days = (current_date - previous_date).days
                if 0 < gap_days <= 4 and previous_row["normalized_price"] > 0:
                    daily_return = (row["normalized_price"] / previous_row["normalized_price"]) - 1.0
                    daily_return_pct = round(daily_return * 100.0, 4)
                    return_candidates_by_date.setdefault(row["quote_date"], []).append({
                        "registry_id": registry_id,
                        "venue": sample["venue"],
                        "product_name": sample["product_name"],
                        "source_tier": source_tier,
                        "return": daily_return,
                    })
            points.append({
                "date": row["quote_date"],
                "quote_timestamp": row.get("quote_timestamp"),
                "normalized_price": row["normalized_price"],
                "index_value": round(index_value, 4),
                "aligned_index_value": round(index_value, 4),
                "change_pct": round(index_value - 100.0, 4),
                "daily_return_pct": daily_return_pct,
                "local_price": row.get("local_price"),
                "currency": row.get("currency"),
                "native_unit": row.get("native_unit"),
                "fx_rate_local_per_usd": row.get("fx_rate_local_per_usd"),
                "fx_timestamp": row.get("fx_timestamp"),
            })
            previous_row = row
        series.append({
            "registry_id": registry_id,
            "provider_id": sample.get("provider_id"),
            "venue": sample["venue"],
            "country": sample["country"],
            "market_type": sample["market_type"],
            "product_name": sample["product_name"],
            "symbol": sample.get("symbol"),
            "source_name": sample.get("source_name") or registry[registry_id]["source_name"],
            "source_status": provider_status.get("status", "live"),
            "source_tier": source_tier,
            "source_url": provider_status.get("source_url"),
            "history_scope": provider_status.get("history_scope") or "Stored daily provider series",
            "canonical_currency": METAL_DEFINITIONS[metal]["canonical_currency"],
            "canonical_unit": METAL_DEFINITIONS[metal]["canonical_unit"],
            "coverage_start": points[0]["date"],
            "coverage_end": points[-1]["date"],
            "observation_count": len(points),
            "baseline_price": baseline_price,
            "latest_price": points[-1]["normalized_price"],
            "change_pct": points[-1]["change_pct"],
            "points": points,
        })

    series.sort(key=lambda row: (
        row["registry_id"] != DEFAULT_REFERENCE_IDS[metal],
        row["venue"],
        row["product_name"],
    ))

    has_official_returns = any(
        candidate["source_tier"] == "official_primary"
        for candidates in return_candidates_by_date.values()
        for candidate in candidates
    )
    composite_series = [
        row
        for row in series
        if not has_official_returns or row["source_tier"] == "official_primary"
    ]

    composite_points = []
    if composite_series:
        baseline_date = min(row["coverage_start"] for row in composite_series)
        composite_index = 100.0
        composite_points.append({
            "date": baseline_date,
            "index_value": 100.0,
            "change_pct": 0.0,
            "daily_return_pct": None,
            "contributor_count": 0,
            "contributors": [],
            "source_quality": "baseline",
        })

        for quote_date in sorted(return_candidates_by_date):
            if quote_date <= baseline_date:
                continue
            candidates = return_candidates_by_date[quote_date]
            selected_candidates = [
                row for row in candidates if row["source_tier"] == "official_primary"
            ] if has_official_returns else candidates
            candidate_by_venue: dict[str, list[dict[str, Any]]] = {}
            for candidate in selected_candidates:
                candidate_by_venue.setdefault(candidate["venue"], []).append(candidate)

            contributors = []
            venue_returns = []
            for venue, venue_candidates in sorted(candidate_by_venue.items()):
                venue_return = statistics.median(row["return"] for row in venue_candidates)
                venue_returns.append(venue_return)
                contributors.append({
                    "venue": venue,
                    "registry_ids": [row["registry_id"] for row in venue_candidates],
                    "return_pct": round(venue_return * 100.0, 4),
                    "source_tier": (
                        "official_primary"
                        if all(row["source_tier"] == "official_primary" for row in venue_candidates)
                        else "fallback"
                    ),
                })

            if not venue_returns:
                continue
            composite_return = statistics.median(venue_returns)
            next_index = composite_index * (1.0 + composite_return)
            if next_index <= 0:
                continue
            composite_index = next_index
            composite_points.append({
                "date": quote_date,
                "index_value": round(composite_index, 4),
                "change_pct": round(composite_index - 100.0, 4),
                "daily_return_pct": round(composite_return * 100.0, 4),
                "contributor_count": len(contributors),
                "contributors": contributors,
                "source_quality": "official_primary" if has_official_returns else "fallback",
            })

    composite = None
    if len(composite_points) >= 2:
        contributor_counts = [row["contributor_count"] for row in composite_points[1:]]
        official_days = sum(row["source_quality"] == "official_primary" for row in composite_points[1:])
        composite = {
            "registry_id": "global_direction",
            "label": f"{METAL_DEFINITIONS[metal]['name']} global trend",
            "coverage_start": composite_points[0]["date"],
            "coverage_end": composite_points[-1]["date"],
            "observation_count": len(composite_points),
            "latest_index_value": composite_points[-1]["index_value"],
            "change_pct": composite_points[-1]["change_pct"],
            "min_contributors": min(contributor_counts),
            "max_contributors": max(contributor_counts),
            "official_primary_days": official_days,
            "fallback_days": len(contributor_counts) - official_days,
            "points": composite_points,
        }

        for venue_series in series:
            first_date = venue_series["coverage_start"]
            anchor_index = 100.0
            for composite_point in composite_points:
                if composite_point["date"] > first_date:
                    break
                anchor_index = composite_point["index_value"]
            for point in venue_series["points"]:
                point["aligned_index_value"] = round(
                    (point["index_value"] / 100.0) * anchor_index,
                    4,
                )
            venue_series["alignment_date"] = first_date
            venue_series["alignment_index_value"] = round(anchor_index, 4)

    series_ids = {row["registry_id"] for row in series}
    return {
        "as_of": generated_at.isoformat(),
        "metal": metal,
        "metal_name": METAL_DEFINITIONS[metal]["name"],
        "days_requested": days,
        "mode": "composite_direction",
        "baseline": 100.0,
        "canonical_currency": METAL_DEFINITIONS[metal]["canonical_currency"],
        "canonical_unit": METAL_DEFINITIONS[metal]["canonical_unit"],
        "composite": composite,
        "series": series,
        "summary": {
            "historical_venues": len(series),
            "registered_venues": len(registry),
            "latest_history_date": max((row["coverage_end"] for row in series), default=None),
            "official_primary_venues": sum(row["source_tier"] == "official_primary" for row in series),
            "composite_min_contributors": composite["min_contributors"] if composite else 0,
            "composite_max_contributors": composite["max_contributors"] if composite else 0,
        },
        "sources": status_list,
        "venues_without_history": [
            {
                "registry_id": row["registry_id"],
                "venue": row["venue"],
                "product_name": row["product_name"],
            }
            for row in registry.values()
            if row["registry_id"] not in series_ids
        ],
        "limitations": [
            "The global trend uses the official-primary venue calendar whenever usable official history exists; labeled fallback series drive it only when the metal has no usable official history.",
            "Multiple products from one venue are collapsed to one venue return so a single market cannot receive extra weight.",
            "Venue paths join the global trend at their first observation; they show direction from entry, not an absolute venue-price spread.",
            "Returns across gaps longer than four calendar days are not joined; venue calendars, sessions, products, and history windows differ.",
            "Only source-backed observations are drawn; venues without defensible history remain latest-quote evidence only.",
        ],
    }
