import re
import numpy as np
from typing import Dict, List, Optional

# NFIB Small Business Optimism Index long-run parameters (52-year history per NFIB).
# Used to translate the OECD proxy history to NFIB scale so that the scraped current
# NFIB value can be grafted on cleanly without a series-scale mismatch.
_NFIB_MEAN = 98.0
_NFIB_STD = 6.5

_MONTH_MAP = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
}


def _series_to_dict(series: List[dict]) -> Dict[str, float]:
    return {item["date"]: item["value"] for item in series if item.get("value") is not None}


def _average_forward_filled_series(*series_list: List[dict]) -> List[dict]:
    dicts = [_series_to_dict(series) for series in series_list if series]
    if not dicts:
        return []

    all_dates = sorted({date for series_dict in dicts for date in series_dict})
    last_values = [None] * len(dicts)
    result: List[dict] = []

    for date in all_dates:
        active_values = []
        for index, series_dict in enumerate(dicts):
            if date in series_dict:
                last_values[index] = series_dict[date]
            if last_values[index] is not None:
                active_values.append(last_values[index])

        if active_values:
            result.append({"date": date, "value": sum(active_values) / len(active_values)})

    return result


def _calibrate_to_nfib_scale(series: List[dict]) -> List[dict]:
    """Convert an OECD business-confidence series to approximate NFIB Optimism Index scale.

    The OECD proxy (BSCICP02USM460S) is a balance statistic centered near 0, while the
    NFIB Optimism Index has a 52-year mean of ~98 and std of ~6.5.  This function
    z-scores the OECD history then re-scales it to NFIB units so that scraped NFIB
    current values can be grafted on without distorting the z-score computation.
    """
    if not series or len(series) < 3:
        return series
    values = np.array([d["value"] for d in series], dtype=float)
    oecd_mean = float(np.mean(values))
    oecd_std = float(np.std(values)) or 1.0
    calibrated = []
    for d in series:
        z = (d["value"] - oecd_mean) / oecd_std
        synthetic = _NFIB_MEAN + z * _NFIB_STD
        calibrated.append({"date": d["date"], "value": round(float(synthetic), 3)})
    return calibrated


async def _scrape_nfib_latest() -> Optional[dict]:
    """Scrape the NFIB SBET survey page for the latest Small Business Optimism reading.

    Returns {"date": "YYYY-MM-01", "value": float} on success, None on any failure.
    The page text typically contains: "Optimism Index ... in February to 98.8"
    """
    import httpx as _httpx
    from datetime import datetime as _dt
    try:
        async with _httpx.AsyncClient(timeout=12, follow_redirects=True) as _c:
            r = await _c.get(
                "https://www.nfib.com/research-foundation/surveys/sbet/",
                headers={"User-Agent": "Mozilla/5.0 (compatible; MarketDashboard/1.0)"},
            )
        if r.status_code != 200:
            return None
        text = r.text
        # Primary pattern: "... in February to 98.8 ..."
        m = re.search(
            r"in\s+(January|February|March|April|May|June|July|August|September|October|November|December)"
            r"[^<]{0,60}?to\s+(\d{2,3}\.?\d?)",
            text[text.find("Optimism") : text.find("Optimism") + 600] if "Optimism" in text else "",
        )
        if not m:
            # Fallback: broader search
            m = re.search(
                r"Optimism Index[^<]{5,400}?"
                r"(January|February|March|April|May|June|July|August|September|October|November|December)"
                r"[^<]{0,60}?(\d{2,3}\.?\d?)",
                text,
            )
            if not m:
                return None
            month_name, value_str = m.group(1), m.group(2)
        else:
            month_name, value_str = m.group(1), m.group(2)

        month_num = _MONTH_MAP[month_name]
        now = _dt.utcnow()
        year = now.year if month_num <= now.month else now.year - 1
        return {"date": f"{year}-{month_num:02d}-01", "value": float(value_str)}
    except Exception:
        return None


async def fetch_sentiment_component_series(client, start_date: str) -> Dict[str, List[dict]]:
    # --- Consumer sentiment ---
    # USACSCICP02STSAM (OECD US Consumer Confidence) is updated ~1 month sooner
    # than UMCSENT on FRED and tracks it very closely in direction and scale.
    umich_series = await client.fetch_series("USACSCICP02STSAM", start_date=start_date)

    # --- Business confidence ---
    # Fetch OECD proxy, translate it to NFIB Optimism Index scale, then try to
    # replace/append the latest month with a directly scraped NFIB value so that
    # the live NFIB reading is always current without needing a full stored history.
    business_confidence_series: List[dict] = []
    try:
        oecd_series = await client.fetch_series("BSCICP02USM460S", start_date=start_date)
        business_confidence_series = _calibrate_to_nfib_scale(oecd_series)

        nfib_latest = await _scrape_nfib_latest()
        if nfib_latest and business_confidence_series:
            existing_dates = {d["date"] for d in business_confidence_series}
            if nfib_latest["date"] in existing_dates:
                # Replace the OECD-synthetic value with the real NFIB reading
                business_confidence_series = [
                    nfib_latest if d["date"] == nfib_latest["date"] else d
                    for d in business_confidence_series
                ]
            elif nfib_latest["date"] > business_confidence_series[-1]["date"]:
                business_confidence_series.append(nfib_latest)
    except Exception:
        pass

    # --- Regional new orders proxy (3 Fed districts) ---
    ny_new_orders_series: List[dict] = []
    try:
        ny_new_orders_series = await client.fetch_series("NOCDISA066MSFRBNY", start_date=start_date)
    except Exception:
        pass

    texas_new_orders_series: List[dict] = []
    try:
        texas_new_orders_series = await client.fetch_series("VNWOSAMFRBDAL", start_date=start_date)
    except Exception:
        pass

    philly_new_orders_series: List[dict] = []
    try:
        philly_new_orders_series = await client.fetch_series("NOCDFSA066MSFRBPHI", start_date=start_date)
    except Exception:
        pass

    # Average NY + Texas + Philadelphia for a broader multi-district signal
    regional_new_orders_series = _average_forward_filled_series(
        ny_new_orders_series,
        texas_new_orders_series,
        philly_new_orders_series,
    )

    # --- CapEx proxy ---
    capex_series: List[dict] = []
    try:
        capex_series = await client.fetch_series("NEWORDER", start_date=start_date)
    except Exception:
        pass

    return {
        "umich_series": umich_series,
        "business_confidence_series": business_confidence_series,
        "regional_new_orders_series": regional_new_orders_series,
        "capex_series": capex_series,
    }