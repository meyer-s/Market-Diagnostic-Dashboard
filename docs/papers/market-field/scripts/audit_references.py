"""Audit paper bibliography metadata against DOI, ISBN, and cited URL records."""

from __future__ import annotations

import csv
import json
import re
import time
import unicodedata
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


PAPER_ROOT = Path(__file__).resolve().parents[1]
BIBLIOGRAPHY = PAPER_ROOT / "references.bib"
OUTPUT = PAPER_ROOT / "results" / "bibliography_audit.csv"
USER_AGENT = "MarketFieldPaperReferenceAudit/1.0 (bibliographic verification)"


def _entries(text: str) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for match in re.finditer(
        r"@(?P<type>[A-Za-z]+)\{(?P<key>[^,]+),(?P<body>.*?)(?=\n\}\n|\n\}\s*$)",
        text,
        flags=re.DOTALL,
    ):
        fields = {
            field.group("name").lower(): field.group("value")
            for field in re.finditer(
                r"^\s*(?P<name>[A-Za-z]+)\s*=\s*\{(?P<value>.*)\}\s*,?\s*$",
                match.group("body"),
                flags=re.MULTILINE,
            )
        }
        entries.append(
            {
                "entry_type": match.group("type").lower(),
                "key": match.group("key").strip(),
                **fields,
            }
        )
    return entries


def _normalize(value: str) -> str:
    simplified = (
        value.replace(r"\ldots", "")
        .replace(r"\&", " and ")
        .replace("{", "")
        .replace("}", "")
        .replace("\\", "")
    )
    decomposed = unicodedata.normalize("NFKD", simplified)
    ascii_value = "".join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]+", " ", ascii_value.lower()).strip()


def _request_json(url: str) -> dict[str, object]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def _url_status(url: str) -> int:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=25) as response:
            return int(response.status)
    except HTTPError as exc:
        return int(exc.code)


def _audit(entry: dict[str, str]) -> dict[str, object]:
    result: dict[str, object] = {
        "key": entry["key"],
        "entry_type": entry["entry_type"],
        "citation_title": entry.get("title", ""),
        "citation_year": entry.get("year", ""),
        "identifier_type": "",
        "identifier": "",
        "record_title": "",
        "record_year": "",
        "title_match": "",
        "year_match": "",
        "reachable": "",
        "status": "needs_manual_review",
        "note": "",
    }
    try:
        if entry.get("doi"):
            doi = entry["doi"]
            payload = _request_json(
                f"https://api.crossref.org/works/{quote(doi, safe='')}"
            )
            message = payload["message"]
            record_title = str((message.get("title") or [""])[0])
            date_parts = (
                message.get("published-print")
                or message.get("published-online")
                or message.get("issued")
                or {}
            ).get("date-parts", [[""]])
            record_year = str(date_parts[0][0]) if date_parts else ""
            title_match = _normalize(entry.get("title", "")) == _normalize(record_title)
            year_match = entry.get("year", "") == record_year
            result.update(
                {
                    "identifier_type": "doi",
                    "identifier": doi,
                    "record_title": record_title,
                    "record_year": record_year,
                    "title_match": title_match,
                    "year_match": year_match,
                    "reachable": True,
                    "status": (
                        "verified"
                        if title_match and year_match
                        else "metadata_discrepancy"
                    ),
                }
            )
        elif entry.get("isbn"):
            isbn = entry["isbn"]
            payload = _request_json(
                "https://openlibrary.org/api/books"
                f"?bibkeys=ISBN:{quote(isbn)}&format=json&jscmd=data"
            )
            record = payload.get(f"ISBN:{isbn}", {})
            record_title = str(record.get("title", ""))
            publish_date = str(record.get("publish_date", ""))
            year_match = entry.get("year", "") in publish_date
            title_match = _normalize(entry.get("title", "")) == _normalize(record_title)
            result.update(
                {
                    "identifier_type": "isbn",
                    "identifier": isbn,
                    "record_title": record_title,
                    "record_year": publish_date,
                    "title_match": title_match,
                    "year_match": year_match,
                    "reachable": bool(record),
                    "status": (
                        "verified"
                        if record and title_match and year_match
                        else "metadata_discrepancy"
                    ),
                }
            )
        elif entry.get("url"):
            url = entry["url"]
            status = _url_status(url)
            result.update(
                {
                    "identifier_type": "url",
                    "identifier": url,
                    "reachable": 200 <= status < 400,
                    "status": "verified_reachable" if 200 <= status < 400 else "unreachable",
                    "note": f"HTTP {status}; title and author still require source-page review.",
                }
            )
        else:
            result["note"] = "No DOI, ISBN, or URL is present."
    except (HTTPError, URLError, TimeoutError, KeyError, TypeError, ValueError) as exc:
        result["status"] = "lookup_error"
        result["note"] = f"{type(exc).__name__}: {exc}"
    return result


def main() -> None:
    rows = []
    for index, entry in enumerate(
        _entries(BIBLIOGRAPHY.read_text(encoding="utf-8"))
    ):
        rows.append(_audit(entry))
        if index:
            time.sleep(0.08)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    counts: dict[str, int] = {}
    for row in rows:
        status = str(row["status"])
        counts[status] = counts.get(status, 0) + 1
    print(json.dumps({"entries": len(rows), "status": counts}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
