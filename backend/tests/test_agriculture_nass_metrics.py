from app.services.agriculture_nass_metrics import parse_nass_release_metrics


def _by_id(metrics: list[dict]) -> dict[str, dict]:
    return {metric["id"]: metric for metric in metrics}


def test_crop_production_extracts_level_yield_and_year_ago_comparison() -> None:
    text = """
    Corn production for grain is forecast at 16.0 billion bushels, down 6 percent
    from 2025. The average yield is forecast at 180.7 bushels per acre, down
    5.8 bushels from last.
    """

    metrics = _by_id(parse_nass_release_metrics("crop_production", text)["ZC"])

    assert metrics["production"]["value"] == 16000
    assert metrics["production"]["unit"] == "Million bushels"
    assert metrics["production_yoy_pct"]["value"] == -6
    assert metrics["production_year_ago"]["value"] == 17000
    assert metrics["production_year_ago"]["comparison_quality"] == "implied_from_published_rounded_percent"
    assert metrics["yield"]["value"] == 180.7


def test_crop_production_keeps_record_wording_attached_to_the_right_commodity() -> None:
    text = """
    Soybean production for beans is forecast at a record 4.45 billion bushels,
    up 5 percent from 2020. All cotton production is forecast at 18.0 million
    480-pound bales, up 23 percent from 2020.
    """

    metrics = _by_id(parse_nass_release_metrics("crop_production", text)["ZS"])

    assert metrics["production"]["value"] == 4450
    assert metrics["production_yoy_pct"]["value"] == 5


def test_crop_progress_preserves_published_week_and_average_benchmarks() -> None:
    text = """
    Corn Dough - Selected States: Week Ending August 9, 2026
    18 States ......:     56            43            61            55
    ------------------------------------------------------------------
    Corn Condition - Selected States: Week Ending August 9, 2026
    18 States ......:      4            10            25            48            13
    Previous week ..:      4            10            25            48            13
    Previous year ..:      2             5            21            52            20
    """

    metrics = _by_id(parse_nass_release_metrics("crop_progress", text)["ZC"])

    assert metrics["progress_dough"] == {
        "id": "progress_dough",
        "label": "Dough",
        "value": 61,
        "unit": "Percent",
        "previous_year": 56,
        "previous_week": 43,
        "five_year_average": 55,
        "chart_group": "progress",
    }
    assert metrics["condition_good_excellent"]["value"] == 61
    assert metrics["condition_good_excellent"]["previous_week"] == 61
    assert metrics["condition_good_excellent"]["previous_year"] == 72


def test_grain_stocks_extracts_inventory_composition_and_year_ago_level() -> None:
    text = """
    Corn stocks in all positions on June 1, 2026 totaled 5.29 billion bushels,
    up 14 percent from June 1, 2025. Of the total stocks, 2.96 billion bushels
    are stored on farms, up 16 percent from a year earlier. Off-farm stocks, at
    2.34 billion bushels, are up 12 percent from a year ago.
    """

    metrics = _by_id(parse_nass_release_metrics("grain_stocks", text)["ZC"])

    assert metrics["total_stocks"]["value"] == 5290
    assert metrics["total_stocks_yoy_pct"]["value"] == 14
    assert metrics["on_farm_stocks"]["value"] == 2960
    assert metrics["off_farm_stocks"]["value"] == 2340


def test_acreage_extracts_current_and_prior_year_footprint() -> None:
    text = """
    Rice: Area planted to rice in 2026 is estimated at 2.02 million acres, down
    28 percent from 2025. Area for harvest is forecast at 1.98 million acres,
    down 28 percent from last year.
    """

    metrics = _by_id(parse_nass_release_metrics("acreage", text)["ZR"])

    assert metrics["planted_area"]["value"] == 2.02
    assert metrics["planted_area_yoy_pct"]["value"] == -28
    assert metrics["harvested_area"]["value"] == 1.98
