from __future__ import annotations

from app.services.indicator_specs import iter_indicator_specs


def test_every_indicator_spec_has_required_fields() -> None:
    specs = iter_indicator_specs()

    assert specs
    assert len({spec.code for spec in specs}) == len(specs)
    assert all(spec.formula_version for spec in specs)
    assert all(spec.freshness_horizon_days > 0 for spec in specs)
    assert all(spec.threshold_yellow_max > spec.threshold_green_max for spec in specs)
