"""
Seed Indicators Script
----------------------
Creates or updates indicator metadata rows using the canonical indicator specs.
This script is automatically run on container startup after migrations are applied.
"""

from app.core.db import SessionLocal
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.services.indicator_specs import get_indicator_seed_rows

db = SessionLocal()

INDICATORS = get_indicator_seed_rows()

DEPRECATED_CODES = ["DFF"]

for dep_code in DEPRECATED_CODES:
    dep = db.query(Indicator).filter(Indicator.code == dep_code).first()
    if dep:
        deleted = db.query(IndicatorValue).filter(IndicatorValue.indicator_id == dep.id).delete()
        db.delete(dep)
        print(f"🗑️  Removed deprecated indicator {dep_code} ({deleted} values deleted)")

db.commit()

created = 0
updated = 0
for ind_data in INDICATORS:
    existing = db.query(Indicator).filter(Indicator.code == ind_data["code"]).first()
    if not existing:
        db.add(Indicator(**ind_data))
        print(f"✅ Adding {ind_data['name']}")
        created += 1
        continue

    changed = False
    for field in (
        "weight",
        "name",
        "source",
        "source_symbol",
        "category",
        "direction",
        "lookback_days_for_z",
        "threshold_green_max",
        "threshold_yellow_max",
    ):
        if field in ind_data and getattr(existing, field) != ind_data[field]:
            setattr(existing, field, ind_data[field])
            changed = True
    if changed:
        print(f"🔄 Updated {existing.code}")
        updated += 1

db.commit()
db.close()

print(f"\n✅ Seed complete: {created} created, {updated} updated, {len(DEPRECATED_CODES)} deprecated removed")
