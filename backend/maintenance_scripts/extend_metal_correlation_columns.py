from sqlalchemy import inspect, text

from app.core.db import engine


COLUMNS = {
    "ag_pt_30d": "DOUBLE PRECISION",
    "ag_pt_60d": "DOUBLE PRECISION",
    "ag_pd_30d": "DOUBLE PRECISION",
    "ag_pd_60d": "DOUBLE PRECISION",
    "pt_pd_30d": "DOUBLE PRECISION",
    "pt_pd_60d": "DOUBLE PRECISION",
}


def main() -> None:
    inspector = inspect(engine)
    if "metal_correlation" not in inspector.get_table_names():
        print("metal_correlation table not found. Run migrations after initial create.")
        return
    existing = {col["name"] for col in inspector.get_columns("metal_correlation")}
    missing = [name for name in COLUMNS.keys() if name not in existing]

    if not missing:
        print("metal_correlation already has extended columns.")
        return

    with engine.begin() as conn:
        for name in missing:
            col_type = COLUMNS[name]
            conn.execute(text(f"ALTER TABLE metal_correlation ADD COLUMN {name} {col_type}"))
            print(f"Added {name} to metal_correlation.")


if __name__ == "__main__":
    main()
