from __future__ import annotations

from typing import Dict, Optional, Tuple


def compute_weighted_composite(
    scores_by_code: Dict[str, Optional[float]],
    weights_by_code: Dict[str, float],
) -> Tuple[Optional[float], Dict[str, float]]:
    available_scores = {
        code: score for code, score in scores_by_code.items() if score is not None
    }
    if not available_scores:
        return None, {}

    total_weight = sum(weights_by_code.get(code, 0.0) for code in available_scores)
    if total_weight == 0:
        return None, {}

    weights_used = {
        code: weights_by_code.get(code, 0.0) / total_weight
        for code in available_scores
    }
    composite = sum(available_scores[code] * weights_used[code] for code in available_scores)
    return composite, weights_used
