"""Indicator constants and weighting defaults."""

MUNI_PUBLIC_SECTOR_COMPONENTS = {
    "MUNI_LONG_SPREAD": {
        "weight": 0.40,
        "label": "Muni–Treasury Long Spread",
        "unit": "percent",
    },
    "SIFMA_INDEX": {
        "weight": 0.25,
        "label": "SIFMA Municipal Swap Index",
        "unit": "percent",
    },
    "MUNI_CURVE_SLOPE_STABILITY": {
        "weight": 0.20,
        "label": "Muni Curve Slope Stability",
        "unit": "percent",
    },
    "MUNI_LEVEL_STRESS": {
        "weight": 0.15,
        "label": "Muni Level Stress (Revdex proxy)",
        "unit": "index",
    },
}

MUNI_PUBLIC_SECTOR_COVERAGE_TOTAL = len(MUNI_PUBLIC_SECTOR_COMPONENTS)

MUNI_PUBLIC_SECTOR_THRESHOLDS = {
    "GREEN": 67,
    "YELLOW": 40,
}

MUNI_PUBLIC_SECTOR_NEAR_THRESHOLD_DELTA = 3

MUNI_PUBLIC_SECTOR_STRESS_CUES = {
    "MUNI_LONG_SPREAD": {
        "stress_z": 1.0,
        "severe_z": 2.0,
        "stress_change_30d": 0.50,
    },
    "SIFMA_INDEX": {
        "stress_percentile": 80,
        "severe_percentile": 90,
    },
    "MUNI_CURVE_SLOPE_STABILITY": {
        "stress_z": 1.0,
        "severe_z": 2.0,
    },
    "MUNI_LEVEL_STRESS": {
        "stress_drawdown": -10.0,
        "stress_vol_z": 1.0,
    },
}
