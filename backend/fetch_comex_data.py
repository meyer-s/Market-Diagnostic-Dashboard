"""
Fetch COMEX inventory data from configured sources.

Set one of:
- COMEX_INVENTORY_URL (CSV/JSON)
- COMEX_INVENTORY_PATH (local CSV/JSON)

Optional:
- COMEX_OPEN_INTEREST_URL / COMEX_OPEN_INTEREST_PATH
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
