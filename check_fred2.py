import asyncio
from app.services.ingestion.fred_client import FredClient

async def check():
    c = FredClient()
    for sid in ['NAPMNOI','CSCICP03USM665S','MICH','T5YIE','ACDGNO']:
        try:
            data = await c.fetch_series(sid, start_date='2025-10-01')
            dates = [d['date'] for d in data if d.get('value') is not None]
            vals = [d['value'] for d in data if d.get('value') is not None]
            last = dates[-1] if dates else 'NONE'
            lastv = str(vals[-1]) if vals else 'N/A'
            print(sid + ': ' + str(len(dates)) + ' pts, latest=' + last + ' val=' + lastv)
        except Exception as e:
            print(sid + ': ERROR ' + str(e))

asyncio.run(check())
