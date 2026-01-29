"""Indicator constants and weighting defaults."""

MUNI_PUBLIC_SECTOR_COMPONENTS = {
    "SIFMA_INDEX": {
        "weight": 0.30,
        "label": "SIFMA Rate Stability",
        "unit": "percent",
    },
    "MUNI_LONG_SPREAD": {
        "weight": 0.30,
        "label": "Long-end municipal stress (proxy)",
        "unit": "percent",
    },
    "MUNI_REVENUE_PROXY": {
        "weight": 0.25,
        "label": "Revenue Bond Price Proxy (Revdex)",
        "unit": "index",
    },
    "MUNI_CURVE_SLOPE_STABILITY": {
        "weight": 0.15,
        "label": "Muni Curve Slope Stability",
        "unit": "percent",
    },
}

MUNI_PUBLIC_SECTOR_COVERAGE_TOTAL = len(MUNI_PUBLIC_SECTOR_COMPONENTS)

MUNI_PUBLIC_SECTOR_THRESHOLDS = {
    "GREEN": 70,
    "YELLOW": 45,
}

MUNI_PUBLIC_SECTOR_NEAR_THRESHOLD_DELTA = 3

MUNI_PUBLIC_SECTOR_STRESS_CUES = {
    "SIFMA_INDEX": {
        "stress_vol_z": 1.0,
        "severe_vol_z": 2.0,
    },
    "MUNI_CURVE_SLOPE_STABILITY": {
        "stress_z": 1.0,
        "severe_z": 2.0,
    },
    "MUNI_LONG_SPREAD": {
        "stress_z": 1.0,
        "severe_z": 2.0,
        "stress_change_60d": 0.50,
    },
}
