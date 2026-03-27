import asyncio
from app.services.ingestion.sentiment_sources import _scrape_nfib_latest

async def check():
    result = await _scrape_nfib_latest()
    print('NFIB scrape result: ' + str(result))

asyncio.run(check())
