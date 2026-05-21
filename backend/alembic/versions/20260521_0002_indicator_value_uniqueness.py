from __future__ import annotations

from alembic import op
from sqlalchemy import inspect, text


revision = "20260521_0002"
down_revision = "20260521_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())

    if "indicator" in existing_tables:
        aas_row = connection.execute(
            text("SELECT id FROM indicator WHERE code = 'AAS' LIMIT 1")
        ).fetchone()
        legacy_rows = connection.execute(
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
            connection.execute(
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
            aas_row = connection.execute(text("SELECT id FROM indicator WHERE code = 'AAS' LIMIT 1")).fetchone()

        if aas_row:
            connection.execute(
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
                connection.execute(
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
                connection.execute(
                    text(
                        """
                        UPDATE indicator_value
                        SET indicator_id = :aas_id
                        WHERE indicator_id = :legacy_id
                        """
                    ),
                    {"legacy_id": legacy_row.id, "aas_id": aas_row.id},
                )
                connection.execute(text("DELETE FROM indicator WHERE id = :legacy_id"), {"legacy_id": legacy_row.id})

    patches = {
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
    for table_name, columns in patches.items():
        if table_name not in existing_tables:
            continue
        existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
        for column_name, column_type in columns:
            if column_name not in existing_columns:
                connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))

    if "indicator_value" in existing_tables:
        connection.execute(
            text(
                """
                DELETE FROM indicator_value
                WHERE id NOT IN (
                    SELECT MAX(id)
                    FROM indicator_value
                    GROUP BY indicator_id, timestamp
                )
                """
            )
        )
        existing_indexes = {index["name"] for index in inspector.get_indexes("indicator_value")}
        if "uq_indicator_value_indicator_timestamp" not in existing_indexes:
            op.create_index(
                "uq_indicator_value_indicator_timestamp",
                "indicator_value",
                ["indicator_id", "timestamp"],
                unique=True,
            )


def downgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    if "indicator_value" in set(inspector.get_table_names()):
        existing_indexes = {index["name"] for index in inspector.get_indexes("indicator_value")}
        if "uq_indicator_value_indicator_timestamp" in existing_indexes:
            op.drop_index("uq_indicator_value_indicator_timestamp", table_name="indicator_value")
