"""
Yahoo Finance Client
Atlas → Agent A

Lightweight wrapper for fetching time series from Yahoo Finance using
yfinance or direct Yahoo endpoints.
"""

import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional, List


class YahooClientError(Exception):
    pass


class YahooClient:
    def fetch_series(
        self,
        ticker: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        interval: str = "1d"
    ) -> List[dict]:
        """Fetch OHLC/close series from Yahoo Finance."""
        
        df = yf.download(
            ticker,
            start=start_date,
            end=end_date,
            interval=interval,
            progress=False,
            auto_adjust=True
        )

        if df is None or len(df) == 0:
            raise YahooClientError(f"No data returned for ticker {ticker}")

        # Handle potential multi-index columns
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        
        df = df.reset_index()

        clean = []
        for idx, row in df.iterrows():
            # Get date from index or Date column
            if 'Date' in row.index:
                date_obj = row["Date"]
            elif hasattr(df.index[idx], 'strftime'):
                date_obj = df.index[idx]
            else:
                continue
            
            # Format date string
            if hasattr(date_obj, 'strftime'):
                date_str = date_obj.strftime("%Y-%m-%d")
            else:
                date_str = str(date_obj)[:10]
            
            # Get close value
            if 'Close' in row.index:
                close_val = row["Close"]
            else:
                continue
            
            clean.append({
                "date": date_str,
                "value": float(close_val) if not pd.isna(close_val) else None,
            })

        return clean