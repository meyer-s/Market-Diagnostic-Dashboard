from typing import Dict, List


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


async def fetch_sentiment_component_series(client, start_date: str) -> Dict[str, List[dict]]:
    umich_series = await client.fetch_series("UMCSENT", start_date=start_date)

    business_confidence_series = []
    try:
        business_confidence_series = await client.fetch_series("BSCICP02USM460S", start_date=start_date)
    except Exception:
        pass

    ny_new_orders_series = []
    try:
        ny_new_orders_series = await client.fetch_series("NOCDISA066MSFRBNY", start_date=start_date)
    except Exception:
        pass

    texas_new_orders_series = []
    try:
        texas_new_orders_series = await client.fetch_series("VNWOSAMFRBDAL", start_date=start_date)
    except Exception:
        pass

    regional_new_orders_series = _average_forward_filled_series(
        ny_new_orders_series,
        texas_new_orders_series,
    )

    capex_series = []
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