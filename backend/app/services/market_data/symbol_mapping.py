from __future__ import annotations

IBKR_SYMBOL_ALIASES = {
    "BRK-B": "BRK B",
    "BRK.B": "BRK B",
    "BF-B": "BF B",
    "BF.B": "BF B",
}


def to_ibkr_symbol(symbol: str) -> str:
    raw = (symbol or "").strip().upper()
    return IBKR_SYMBOL_ALIASES.get(raw, raw)


def ibkr_symbol_candidates(symbol: str) -> list[str]:
    raw = (symbol or "").strip().upper()
    mapped = to_ibkr_symbol(raw)
    candidates = [
        mapped,
        raw,
        raw.replace("-", " "),
        raw.replace(".", " "),
        raw.replace("-", "."),
    ]
    seen: set[str] = set()
    out: list[str] = []
    for candidate in candidates:
        candidate = candidate.strip()
        if candidate and candidate not in seen:
            seen.add(candidate)
            out.append(candidate)
    return out
