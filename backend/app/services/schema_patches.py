from __future__ import annotations

import logging
from typing import Dict, List, Tuple

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

def ensure_aas_indicator_code(engine: Engine) -> None:
    """
    Normalize the alternative-asset indicator definition to AAS on existing databases.
    Safe to run repeatedly.
    """
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())

        if "indicator" not in existing_tables:
            return

        aas_row = conn.execute(
            text("SELECT id FROM indicator WHERE code = 'AAS' LIMIT 1")
        ).fetchone()
        legacy_rows = conn.execute(
            text(
                """
                SELECT id, code FROM indicator
                WHERE code != 'AAS'
                  AND category = 'alternative_assets'
                  AND source = 'DERIVED'
                ORDER BY id ASC
                """
            )
        ).fetchall()

        if legacy_rows and not aas_row:
            legacy_row = legacy_rows[0]
            conn.execute(
                text(
                    """
                    UPDATE indicator
                    SET code = 'AAS',
                        name = 'Alternative Asset Stability',
                        source_symbol = 'AAS_COMPOSITE'
                    WHERE id = :indicator_id
                    """
                ),
                {"indicator_id": legacy_row.id},
            )
            logger.info("Normalized alternative-assets indicator code to AAS")

            aas_row = conn.execute(
                text("SELECT id FROM indicator WHERE code = 'AAS' LIMIT 1")
            ).fetchone()

        if aas_row:
            conn.execute(
                text(
                    """
                    UPDATE indicator
                    SET name = 'Alternative Asset Stability',
                        source_symbol = 'AAS_COMPOSITE'
                    WHERE code = 'AAS'
                    """
                )
            )

            for legacy_row in legacy_rows:
                if legacy_row.id == aas_row.id:
                    continue

                conn.execute(
                    text(
                        """
                        DELETE FROM indicator_value AS legacy
                        WHERE legacy.indicator_id = :legacy_id
                          AND EXISTS (
                              SELECT 1
                              FROM indicator_value AS canonical
                              WHERE canonical.indicator_id = :aas_id
                                AND canonical.timestamp = legacy.timestamp
                          )
                        """
                    ),
                    {"legacy_id": legacy_row.id, "aas_id": aas_row.id},
                )
                conn.execute(
                    text(
                        """
                        UPDATE indicator_value
                        SET indicator_id = :aas_id
                        WHERE indicator_id = :legacy_id
                        """
                    ),
                    {"legacy_id": legacy_row.id, "aas_id": aas_row.id},
                )
                conn.execute(
                    text("DELETE FROM indicator WHERE id = :legacy_id"),
                    {"legacy_id": legacy_row.id},
                )
                logger.info(
                    "Merged legacy alternative-assets indicator %s into AAS",
                    legacy_row.code,
                )

def ensure_signal_attribution_columns(engine: Engine) -> None:
    """
    Add attribution columns for options-tracker linkage on existing databases.
    Safe to run repeatedly; only missing columns are added.
    """
    patches: Dict[str, List[Tuple[str, str]]] = {
        "option_position": [
            ("source_event_id", "INTEGER"),
            ("source_triggered_at", "TIMESTAMP"),
            ("source_match_method", "VARCHAR"),
            ("source_match_confidence", "FLOAT"),
            ("source_match_notes", "VARCHAR"),
        ],
        "closed_position": [
            ("source_event_id", "INTEGER"),
            ("source_triggered_at", "TIMESTAMP"),
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
