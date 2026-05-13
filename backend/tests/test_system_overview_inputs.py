from app.services import system_overview_inputs


def test_page_input_statuses_include_latest_page_scores(monkeypatch):
    monkeypatch.setattr(
        system_overview_inputs,
        "calculate_composite_index",
        lambda days=365: {"stability_score": 62.5, "as_of": "2026-05-13T10:00:00Z", "component_history": []},
    )
    monkeypatch.setattr(
        system_overview_inputs,
        "calculate_energy_index",
        lambda days=365: {"composite_score": 71.2, "as_of": "2026-05-13T10:00:00Z", "composite_history": []},
    )
    monkeypatch.setattr(
        system_overview_inputs,
        "calculate_real_estate_index",
        lambda days=365: {"composite_score": 35.0, "as_of": "2026-05-13T10:00:00Z", "composite_history": []},
    )

    statuses = {entry["code"]: entry for entry in system_overview_inputs.get_page_input_statuses()}

    assert statuses["AGRICULTURE_STABILITY"]["score"] == 62.5
    assert statuses["AGRICULTURE_STABILITY"]["weight"] == 0.6
    assert statuses["ENERGY_STABILITY"]["score"] == 71.2
    assert statuses["ENERGY_STABILITY"]["weight"] == 0.8
    assert statuses["ENERGY_STABILITY"]["state"] == "GREEN"
    assert statuses["REAL_ESTATE_STABILITY"]["score"] == 65.0
    assert statuses["REAL_ESTATE_STABILITY"]["weight"] == 1.0
    assert statuses["REAL_ESTATE_STABILITY"]["state"] == "YELLOW"


def test_page_input_history_uses_stability_series(monkeypatch):
    monkeypatch.setattr(
        system_overview_inputs,
        "calculate_composite_index",
        lambda days=365: {
            "component_history": [
                {"date": "2026-05-11", "stability_score": 58.0},
                {"date": "2026-05-12", "stability_score": 60.0},
            ]
        },
    )
    monkeypatch.setattr(
        system_overview_inputs,
        "calculate_energy_index",
        lambda days=365: {
            "composite_history": [
                {"date": "2026-05-11", "value": 54.0},
                {"date": "2026-05-12", "value": 56.0},
            ]
        },
    )
    monkeypatch.setattr(
        system_overview_inputs,
        "calculate_real_estate_index",
        lambda days=365: {
            "composite_history": [
                {"date": "2026-05-11", "value": 48.0},
                {"date": "2026-05-12", "value": 40.0},
            ]
        },
    )

    agriculture_history = system_overview_inputs.get_page_input_history("AGRICULTURE_STABILITY", 365)
    energy_history = system_overview_inputs.get_page_input_history("ENERGY_STABILITY", 365)
    real_estate_history = system_overview_inputs.get_page_input_history("REAL_ESTATE_STABILITY", 365)

    assert agriculture_history[-1]["score"] == 60.0
    assert energy_history[-1]["score"] == 56.0
    assert real_estate_history[0]["score"] == 52.0
    assert real_estate_history[-1]["score"] == 60.0