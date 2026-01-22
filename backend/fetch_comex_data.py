"""
Fetch COMEX inventory data from configured sources.

Set one or more inventory sources:
- COMEX_INVENTORY_URL / COMEX_INVENTORY_PATH (CSV/JSON)
- COMEX_INVENTORY_GOLD_URL / COMEX_INVENTORY_GOLD_PATH
- COMEX_INVENTORY_SILVER_URL / COMEX_INVENTORY_SILVER_PATH
- COMEX_INVENTORY_COPPER_URL / COMEX_INVENTORY_COPPER_PATH
- COMEX_INVENTORY_PLAT_PALL_URL / COMEX_INVENTORY_PLAT_PALL_PATH
- COMEX_INVENTORY_PLATINUM_URL / COMEX_INVENTORY_PLATINUM_PATH
- COMEX_INVENTORY_PALLADIUM_URL / COMEX_INVENTORY_PALLADIUM_PATH

Optional:
- COMEX_OPEN_INTEREST_URL / COMEX_OPEN_INTEREST_PATH (CSV/JSON)
"""
from app.services.ingestion.precious_metals_ingester import PreciousMetalsIngester


def main() -> None:
    print("\n" + "=" * 60)
    print("COMEX Inventory Data Fetcher")
    print("=" * 60 + "\n")

    ingester = PreciousMetalsIngester()
    count = ingester._ingest_comex_data()

    if count:
        print(f"✅ Inserted {count} COMEX inventory records")
    else:
        print("⚠️  No COMEX records inserted")
        print("   Configure COMEX_INVENTORY_URL or COMEX_INVENTORY_PATH to ingest real data.")


if __name__ == "__main__":
    main()
