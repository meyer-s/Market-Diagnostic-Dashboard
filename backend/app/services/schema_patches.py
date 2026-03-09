from __future__ import annotations

import logging
from typing import Dict, List, Tuple

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def ensure_signal_attribution_columns(engine: Engine) -> None:
    """
    Add attribution columns for options-tracker linkage on existing databases.
    Safe to run repeatedly; only missing columns are added.
    """
    patches: Dict[str, List[Tuple[str, str]]] = {
        "option_position": [
            ("source_event_id", "INTEGER"),
            ("source_triggered_at", "DATETIME"),
            ("source_match_method", "VARCHAR"),
            ("source_match_confidence", "FLOAT"),
            ("source_match_notes", "VARCHAR"),
        ],
        "closed_position": [
            ("source_event_id", "INTEGER"),
            ("source_triggered_at", "DATETIME"),
            ("source_match_method", "VARCHAR"),
            ("source_match_confidence", "FLOAT"),
            ("source_match_notes", "VARCHAR"),
        ],
    }

    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())

        for table_name, columns in patches.items():
            if table_name not in existing_tables:
                continue

            existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
            for column_name, column_type in columns:
                if column_name in existing_columns:
                    continue
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))
                logger.info("Added schema patch column %s.%s", table_name, column_name)
