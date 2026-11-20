"""
Crypto and Macro Data Ingestion Service

Fetches crypto prices and macro liquidity data from external APIs.
"""

import requests
import logging
import math
from datetime import datetime, timedelta, date
from typing import Optional, Dict, List, Tuple
from sqlalchemy.orm import Session
import numpy as np
import yfinance as yf

from app.models.alternative_assets import (
    CryptoPrice,
    MacroLiquidityData,
    BitcoinNetworkMetric,
    CryptoEcosystemMetric,
    EquityPrice,
)
from app.core.db import SessionLocal

logger = logging.getLogger(__name__)

# Fixed, comparable broad-money proxy; static FX assumptions are intentionally
# explicit. Discontinued foreign series cannot be treated as current money.
M2_PANEL_SOURCE = "FRED_FIXED_FOUR_BROAD_MONEY_APPROX_FX_V1"
M2_PANEL_SERIES = {"us_m2": "WM2NS", "eurozone_m2": "MABMM301EZM189S", "japan_m2": "MABMM301JPM189S", "uk_m2": "MABMM301GBM189S"}


# Yahoo daily history is a separate basis from the current CoinGecko snapshot.
_YAHOO_CRYPTO_TICKERS: Dict[str, str] = {
    "SOL": "SOL-USD",
    "XRP": "XRP-USD",
}


def _finite_number(value, *, positive=False):
    try:
        number = float(value)
        return number if math.isfinite(number) and (number > 0 if positive else True) else None
    except (ValueError, TypeError, OverflowError):
        return None


def _dated_point_map(series):
    """Provider UTC days only; ignore malformed/nonfinite/nonpositive points."""
    result = {}
    for entry in series:
        try:
            if not isinstance(entry, (list, tuple)) or len(entry) < 2:
                continue
            timestamp, value = entry[:2]
            timestamp = _finite_number(timestamp, positive=True)
            value = _finite_number(value, positive=True)
            if timestamp is None or value is None:
                continue
            day = datetime.utcfromtimestamp(timestamp / 1000).date()
            if day <= datetime.utcnow().date():
                result[day] = value
        except (ValueError, TypeError, OverflowError, OSError):
            continue
    return result


class CryptoDataIngestion:
    """
    Fetches crypto market data from public APIs.
    
    Free data sources:
    - CoinGecko API (no key required, rate limited)
    - Alternative: CoinCap, CryptoCompare (may require keys)
    """
    
    COINGECKO_BASE = "https://api.coingecko.com/api/v3"
    
    def __init__(self, db: Session):
        self.db = db
    
    def fetch_current_prices(self) -> Optional[CryptoPrice]:
        """
        Fetch current crypto prices and market data.
        """
        try:
            date_key = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            # Get BTC and ETH prices
            url = f"{self.COINGECKO_BASE}/simple/price"
            params = {
                "ids": "bitcoin,ethereum,solana,ripple",
                "vs_currencies": "usd",
                "include_24hr_vol": "true",
                "include_market_cap": "true",
                "include_last_updated_at": "true",
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            now = datetime.utcnow()
            observed = []
            for coin in ("bitcoin", "ethereum", "solana", "ripple"):
                item = data.get(coin, {})
                timestamp = _finite_number(item.get("last_updated_at"), positive=True)
                price = _finite_number(item.get("usd"), positive=True)
                if timestamp is None or price is None:
                    raise ValueError(f"Missing valid {coin} price/time")
                observation = datetime.utcfromtimestamp(timestamp)
                if not -300 <= (now - observation).total_seconds() <= 1200:
                    raise ValueError(f"Stale/future {coin} quote")
                observed.append(observation)
            
            # Get global market data
            global_url = f"{self.COINGECKO_BASE}/global"
            global_response = requests.get(global_url, timeout=10)
            global_response.raise_for_status()
            global_data = global_response.json()["data"]
            global_time = datetime.utcfromtimestamp(float(global_data["updated_at"]))
            if not -300 <= (now - global_time).total_seconds() <= 1200:
                raise ValueError("Stale/future CoinGecko global snapshot")
            total_cap = _finite_number(global_data.get("total_market_cap", {}).get("usd"), positive=True)
            dominance = _finite_number(global_data.get("market_cap_percentage", {}).get("btc"), positive=True)
            if total_cap is None or dominance is None or dominance > 100:
                raise ValueError("Invalid global capitalization or dominance")
            
            # Get gold price for BTC/Gold ratio
            gold_price = self._fetch_gold_price()
            
            crypto_price = CryptoPrice(
                date=date_key,
                btc_usd=data["bitcoin"]["usd"],
                eth_usd=data["ethereum"]["usd"],
                total_crypto_mcap=total_cap / 1_000_000_000,  # Convert to billions
                btc_dominance=dominance,
                btc_gold_ratio=data["bitcoin"]["usd"] / gold_price if gold_price else None,
                btc_volume_24h=_finite_number(data["bitcoin"].get("usd_24h_vol"), positive=True),
                source="COINGECKO_LIVE|" + min(observed + [global_time]).isoformat(),
                created_at=now,
            )

            # Keep all current asset quotes on the same timestamped provider basis.
            crypto_price.sol_usd = data["solana"]["usd"]
            crypto_price.xrp_usd = data["ripple"]["usd"]
            
            # Check if today's data already exists
            existing = self.db.query(CryptoPrice).filter(
                CryptoPrice.date == crypto_price.date
            ).order_by(CryptoPrice.id.desc()).first()
            
            if existing:
                # Update existing record
                existing.btc_usd = crypto_price.btc_usd
                existing.eth_usd = crypto_price.eth_usd
                existing.sol_usd = crypto_price.sol_usd
                existing.xrp_usd = crypto_price.xrp_usd
                existing.total_crypto_mcap = crypto_price.total_crypto_mcap
                existing.btc_dominance = crypto_price.btc_dominance
                existing.btc_gold_ratio = crypto_price.btc_gold_ratio
                existing.btc_volume_24h = crypto_price.btc_volume_24h
                existing.source = crypto_price.source
                existing.created_at = now
                logger.info(f"Updated crypto prices for {crypto_price.date.date()}")
            else:
                self.db.add(crypto_price)
                logger.info(f"Added new crypto prices for {crypto_price.date.date()}")
            
            self.db.commit()
            return existing or crypto_price
            
        except Exception as e:
            logger.error(f"Error fetching crypto prices: {e}")
            self.db.rollback()
            return None

    def fetch_historical_prices(self, days: int = 90) -> bool:
        """
        Backfill historical crypto prices.

        Note: Uses CoinGecko market chart data for daily history.
        """
        try:
            btc_chart = self._fetch_market_chart("bitcoin", days)
            eth_chart = self._fetch_market_chart("ethereum", days)
            global_chart = self._fetch_global_market_chart(days)

            if not btc_chart or "prices" not in btc_chart:
                logger.error("No BTC market chart data returned from CoinGecko")
                return False

            btc_prices = self._series_to_date_map(btc_chart.get("prices", []))
            btc_market_caps = self._series_to_date_map(btc_chart.get("market_caps", []))
            btc_volumes = self._series_to_date_map(btc_chart.get("total_volumes", []))
            eth_prices = self._series_to_date_map(eth_chart.get("prices", [])) if eth_chart else {}

            # Fetch SOL and XRP historical prices from Yahoo Finance
            sol_prices = self._fetch_yahoo_crypto_history("SOL", days)
            xrp_prices = self._fetch_yahoo_crypto_history("XRP", days)

            total_market_caps = {}
            if global_chart:
                total_market_caps = self._series_to_date_map(
                    global_chart.get("market_cap", []) or global_chart.get("market_caps", [])
                )

            all_dates = sorted(set(btc_prices.keys()) | set(eth_prices.keys()))

            added = 0
            for date_obj in all_dates:
                date = datetime.combine(date_obj, datetime.min.time())

                existing = self.db.query(CryptoPrice).filter(
                    CryptoPrice.date == date
                ).order_by(CryptoPrice.id.desc()).first()
                if existing:
                    # Update SOL/XRP on existing rows if they're still null
                    if existing.sol_usd is None and sol_prices.get(date_obj) is not None:
                        existing.sol_usd = sol_prices.get(date_obj)
                    if existing.xrp_usd is None and xrp_prices.get(date_obj) is not None:
                        existing.xrp_usd = xrp_prices.get(date_obj)
                    continue

                btc_price = btc_prices.get(date_obj)
                if btc_price is None:
                    continue

                total_mcap = total_market_caps.get(date_obj)
                btc_mcap = btc_market_caps.get(date_obj)
                btc_dominance = None
                if total_mcap and btc_mcap:
                    btc_dominance = (btc_mcap / total_mcap) * 100

                gold_price = self._fetch_gold_price(date)

                crypto_price = CryptoPrice(
                    date=date,
                    btc_usd=btc_price,
                    eth_usd=eth_prices.get(date_obj),
                    sol_usd=sol_prices.get(date_obj),
                    xrp_usd=xrp_prices.get(date_obj),
                    total_crypto_mcap=(total_mcap / 1_000_000_000) if total_mcap else None,
                    btc_dominance=btc_dominance,
                    btc_gold_ratio=btc_price / gold_price if gold_price else None,
                    btc_volume_24h=btc_volumes.get(date_obj),
                    source="CoinGecko"
                )
                self.db.add(crypto_price)
                added += 1

            self.db.commit()
            logger.info(f"Backfilled {added} days of crypto historical data")
            return True

        except Exception as e:
            logger.error(f"Error fetching historical crypto data: {e}", exc_info=True)
            self.db.rollback()
            return False

    def _fetch_market_chart(self, coin_id: str, days: int) -> Optional[Dict[str, List[List[float]]]]:
        url = f"{self.COINGECKO_BASE}/coins/{coin_id}/market_chart"
        params = {
            "vs_currency": "usd",
            "days": days,
            "interval": "daily"
        }
        try:
            response = requests.get(url, params=params, timeout=15)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.warning(f"Error fetching {coin_id} market chart: {e}")
            return None

    def _fetch_global_market_chart(self, days: int) -> Optional[Dict[str, List[List[float]]]]:
        url = f"{self.COINGECKO_BASE}/global/market_cap_chart"
        params = {
            "vs_currency": "usd",
            "days": days
        }
        try:
            response = requests.get(url, params=params, timeout=15)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.warning(f"Error fetching global market cap chart: {e}")
            return None

    def _series_to_date_map(self, series: List[List[float]]) -> Dict[date, float]:
        return _dated_point_map(series)

    def _fetch_yahoo_crypto_prices(self) -> Dict[str, Optional[float]]:
        """Fetch current prices for extended crypto assets (SOL, XRP) via Yahoo Finance."""
        result: Dict[str, Optional[float]] = {}
        for symbol, ticker in _YAHOO_CRYPTO_TICKERS.items():
            try:
                data = yf.download(ticker, period="2d", interval="1d", progress=False)
                if data.empty:
                    result[symbol] = None
                    continue
                close = data["Close"].squeeze().dropna()
                result[symbol] = float(close.iloc[-1]) if not close.empty else None
            except Exception as e:
                logger.warning(f"Yahoo Finance error for {symbol} ({ticker}): {e}")
                result[symbol] = None
        return result

    def _fetch_yahoo_crypto_history(self, symbol: str, days: int) -> Dict[date, float]:
        """Fetch historical daily prices for a crypto asset via Yahoo Finance."""
        ticker = _YAHOO_CRYPTO_TICKERS.get(symbol)
        if not ticker:
            return {}
        try:
            start = (datetime.utcnow() - timedelta(days=days + 5)).strftime("%Y-%m-%d")
            data = yf.download(ticker, start=start, interval="1d", progress=False)
            if data.empty:
                return {}
            close = data["Close"].squeeze().dropna()
            result = {}
            for idx, val in close.items():
                # idx may be a Timestamp or a string depending on yfinance version
                if hasattr(idx, "date"):
                    d = idx.date()
                else:
                    import pandas as pd
                    d = pd.Timestamp(idx).date()
                result[d] = float(val)
            return result
        except Exception as e:
            logger.warning(f"Yahoo Finance history error for {symbol}: {e}")
            return {}

    def _fetch_gold_price(self, as_of: Optional[datetime] = None) -> Optional[float]:
        """Use a prior available gold session; never divide past BTC by today's gold."""
        try:
            from app.models.precious_metals import MetalPrice
            from sqlalchemy import desc

            as_of = as_of or datetime.utcnow()
            candidates = self.db.query(MetalPrice).filter(
                MetalPrice.metal == 'AU',
                MetalPrice.source == 'YAHOO_FINANCE',
                MetalPrice.date <= as_of,
                MetalPrice.date >= as_of - timedelta(days=4),
            ).order_by(desc(MetalPrice.date), desc(MetalPrice.id)).all()
            gold = next((row for row in candidates if row.date == row.date.replace(hour=0, minute=0, second=0, microsecond=0)), None)
            return _finite_number(gold.price_usd_per_oz, positive=True) if gold else None

        except Exception:
            return None
        except Exception as e:
            logger.error(f"Unexpected error in crypto ingestion: {e}", exc_info=True)
            self.db.rollback()
            return None


class BitcoinNetworkIngestion:
    """
    Fetches Bitcoin network metrics from free APIs.
    Uses blockchain.com charts for hash rate and difficulty.
    """

    BLOCKCHAIN_CHARTS = "https://api.blockchain.info/charts"

    def __init__(self, db: Session):
        self.db = db

    def fetch_current_metrics(self) -> Optional[BitcoinNetworkMetric]:
        try:
            hash_series = self._fetch_chart_series("hash-rate")
            diff_series = self._fetch_chart_series("difficulty")

            if not hash_series and not diff_series:
                return None

            combined = {}
            for date_key, value in hash_series:
                combined.setdefault(date_key, {})["hash_rate"] = value
            for date_key, value in diff_series:
                combined.setdefault(date_key, {})["difficulty"] = value

            latest_date = None
            for date_key in sorted(combined.keys()):
                values = combined[date_key]
                existing = self.db.query(BitcoinNetworkMetric).filter(
                    BitcoinNetworkMetric.date == date_key
                ).order_by(BitcoinNetworkMetric.id.desc()).first()

                if existing:
                    existing.hash_rate = values.get("hash_rate", existing.hash_rate)
                    existing.difficulty = values.get("difficulty", existing.difficulty)
                    existing.source = "BLOCKCHAIN"
                    existing.created_at = datetime.utcnow()
                else:
                    self.db.add(BitcoinNetworkMetric(
                        date=date_key,
                        hash_rate=values.get("hash_rate"),
                        difficulty=values.get("difficulty"),
                        source="BLOCKCHAIN"
                    ))
                latest_date = date_key

            self.db.commit()
            if latest_date:
                return self.db.query(BitcoinNetworkMetric).filter(
                    BitcoinNetworkMetric.date == latest_date
                ).order_by(BitcoinNetworkMetric.id.desc()).first()
            return None
        except Exception as e:
            logger.error(f"Error fetching Bitcoin network metrics: {e}", exc_info=True)
            self.db.rollback()
            return None

    def _fetch_chart_series(self, chart: str) -> List[Tuple[datetime, float]]:
        params = {
            "timespan": "365days",
            "format": "json"
        }
        try:
            response = requests.get(f"{self.BLOCKCHAIN_CHARTS}/{chart}", params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            values = data.get("values", [])
            series = []
            for entry in values:
                timestamp = _finite_number(entry.get("x"), positive=True)
                value = entry.get("y")
                value = _finite_number(value, positive=True)
                if timestamp is None or value is None:
                    continue
                date_key = datetime.utcfromtimestamp(timestamp).replace(hour=0, minute=0, second=0, microsecond=0)
                if datetime.utcnow() - timedelta(days=370) <= date_key <= datetime.utcnow():
                    series.append((date_key, value))
            return series
        except Exception as e:
            logger.warning(f"Failed to fetch blockchain chart {chart}: {e}")
            return []


class CryptoEcosystemIngestion:
    """
    Fetches stablecoin supply, DeFi TVL, exchange flows, and BTC/SPY correlation.
    Uses free APIs with a preference for existing sources.
    """

    COINGECKO_BASE = "https://api.coingecko.com/api/v3"
    DEFILLAMA_BASE = "https://api.llama.fi"
    COINMETRICS_BASE = "https://community-api.coinmetrics.io/v4"

    def __init__(self, db: Session):
        self.db = db

    def fetch_current_metrics(self) -> Optional[CryptoEcosystemMetric]:
        """Refresh daily source observations at their actual dates, not retrieval day."""
        try:
            date_key = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            self._backfill_metrics(7)
            btc_spy_corr = self._calculate_btc_spy_corr(date_key)
            existing = self.db.query(CryptoEcosystemMetric).filter(
                CryptoEcosystemMetric.date == date_key,
                CryptoEcosystemMetric.source == "MULTI_V2",
            ).order_by(CryptoEcosystemMetric.id.desc()).first()
            if btc_spy_corr is not None:
                if existing is None:
                    existing = CryptoEcosystemMetric(date=date_key, source="MULTI_V2")
                    self.db.add(existing)
                existing.btc_spy_corr_30d = btc_spy_corr
                existing.created_at = datetime.utcnow()
                self.db.commit()
            return self.db.query(CryptoEcosystemMetric).filter(
                CryptoEcosystemMetric.source == "MULTI_V2"
            ).order_by(CryptoEcosystemMetric.date.desc()).first()
        except Exception as e:
            logger.error(f"Error fetching crypto ecosystem metrics: {e}", exc_info=True)
            self.db.rollback()
            return None

    def _backfill_metrics(self, days: int = 180) -> None:
        stablecoin_series = self._fetch_stablecoin_supply_series(days)
        defi_series = self._fetch_defi_tvl_series(days)
        exchange_series = self._fetch_exchange_outflows_series(days)
        btc_mcap_series = self._fetch_btc_market_cap_series(days)

        all_dates = sorted(set(stablecoin_series.keys()) | set(defi_series.keys()) | set(exchange_series.keys()))
        if not all_dates:
            return

        for day in all_dates:
            date_key = datetime.combine(day, datetime.min.time())
            existing = self.db.query(CryptoEcosystemMetric).filter(
                CryptoEcosystemMetric.date == date_key,
                CryptoEcosystemMetric.source == "MULTI_V2",
            ).order_by(CryptoEcosystemMetric.id.desc()).first()

            stablecoin_supply = stablecoin_series.get(day)
            btc_mcap = btc_mcap_series.get(day)
            stablecoin_btc_ratio = (stablecoin_supply / btc_mcap) if stablecoin_supply and btc_mcap else None

            exchange_outflow = exchange_series.get(day, (None, None))

            if existing:
                existing.stablecoin_supply_usd = stablecoin_supply if stablecoin_supply is not None else existing.stablecoin_supply_usd
                existing.defi_tvl_usd = defi_series.get(day) if defi_series.get(day) is not None else existing.defi_tvl_usd
                existing.exchange_net_outflow_btc = exchange_outflow[0] if exchange_outflow[0] is not None else existing.exchange_net_outflow_btc
                existing.exchange_net_outflow_usd = exchange_outflow[1] if exchange_outflow[1] is not None else existing.exchange_net_outflow_usd
                existing.stablecoin_btc_ratio = stablecoin_btc_ratio if stablecoin_btc_ratio is not None else existing.stablecoin_btc_ratio
                existing.source = "MULTI_V2"
                existing.created_at = datetime.utcnow()
            else:
                self.db.add(CryptoEcosystemMetric(
                    date=date_key,
                    stablecoin_supply_usd=stablecoin_supply,
                    defi_tvl_usd=defi_series.get(day),
                    exchange_net_outflow_btc=exchange_outflow[0],
                    exchange_net_outflow_usd=exchange_outflow[1],
                    stablecoin_btc_ratio=stablecoin_btc_ratio,
                    source="MULTI_V2"
                ))

        self.db.commit()

    def _fetch_stablecoin_supply(self) -> Optional[float]:
        try:
            url = "https://stablecoins.llama.fi/stablecoincharts/all"
            response = requests.get(url, timeout=15)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, list) or not data:
                return None
            latest = data[-1]
            totals = latest.get("totalCirculatingUSD", {})
            pegged_usd = totals.get("peggedUSD")
            return float(pegged_usd) if pegged_usd is not None else None
        except Exception as e:
            logger.warning(f"Stablecoin supply fetch failed: {e}")
            return None

    def _fetch_stablecoin_supply_series(self, days: int) -> Dict[date, float]:
        try:
            url = "https://stablecoins.llama.fi/stablecoincharts/all"
            response = requests.get(url, timeout=20)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, list):
                return {}

            cutoff = datetime.utcnow().date() - timedelta(days=days)
            series = {}
            for entry in data:
                timestamp = entry.get("date")
                totals = entry.get("totalCirculatingUSD", {})
                pegged_usd = totals.get("peggedUSD")
                if timestamp is None or pegged_usd is None:
                    continue
                day = datetime.utcfromtimestamp(int(timestamp)).date()
                if day < cutoff or day > datetime.utcnow().date():
                    continue
                value = _finite_number(pegged_usd, positive=True)
                if value is not None:
                    series[day] = value
            return series
        except Exception as e:
            logger.warning(f"Stablecoin supply series fetch failed: {e}")
            return {}

    def _fetch_defi_tvl(self) -> Optional[float]:
        try:
            url = f"{self.DEFILLAMA_BASE}/v2/historicalChainTvl"
            response = requests.get(url, timeout=20)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, list) or not data:
                return None
            latest = data[-1]
            return float(latest.get("tvl")) if latest.get("tvl") is not None else None
        except Exception as e:
            logger.warning(f"DeFi TVL fetch failed: {e}")
            return None

    def _fetch_defi_tvl_series(self, days: int) -> Dict[date, float]:
        try:
            url = f"{self.DEFILLAMA_BASE}/v2/historicalChainTvl"
            response = requests.get(url, timeout=20)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, list):
                return {}

            cutoff = datetime.utcnow().date() - timedelta(days=days)
            series = {}
            for entry in data:
                timestamp = entry.get("date")
                tvl = entry.get("tvl")
                if timestamp is None or tvl is None:
                    continue
                day = datetime.utcfromtimestamp(int(timestamp)).date()
                if day < cutoff or day > datetime.utcnow().date():
                    continue
                value = _finite_number(tvl, positive=True)
                if value is not None:
                    series[day] = value
            return series
        except Exception as e:
            logger.warning(f"DeFi TVL series fetch failed: {e}")
            return {}

    def _fetch_exchange_outflows(self) -> Tuple[Optional[float], Optional[float]]:
        params = {
            "assets": "btc",
            "metrics": "FlowOutExNtv,FlowOutExUSD,FlowInExNtv,FlowInExUSD",
            "frequency": "1d",
            "page_size": 1,
            "paging_from": "end",
        }
        try:
            response = requests.get(
                f"{self.COINMETRICS_BASE}/timeseries/asset-metrics",
                params=params,
                timeout=20
            )
            response.raise_for_status()
            data = response.json().get("data", [])
            if not data:
                return (None, None)
            latest = data[-1]
            return self._parse_exchange_flow(latest)
        except Exception as e:
            logger.warning(f"Exchange flow fetch failed: {e}")
            return (None, None)

    def _fetch_exchange_outflows_series(self, days: int) -> Dict[date, Tuple[Optional[float], Optional[float]]]:
        start_date = datetime.utcnow() - timedelta(days=days)
        params = {
            "assets": "btc",
            "metrics": "FlowOutExNtv,FlowOutExUSD,FlowInExNtv,FlowInExUSD",
            "frequency": "1d",
            "start_time": start_date.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "page_size": min(10000, max(10, days + 5)),
            "paging_from": "end",
        }
        try:
            response = requests.get(
                f"{self.COINMETRICS_BASE}/timeseries/asset-metrics",
                params=params,
                timeout=20
            )
            response.raise_for_status()
            data = response.json().get("data", [])
            series = {}
            for entry in data:
                time_str = entry.get("time")
                if not time_str:
                    continue
                clean_time = time_str.replace("Z", "")
                if "." in clean_time:
                    clean_time = clean_time.split(".")[0]
                day = datetime.fromisoformat(clean_time).date()
                if start_date.date() <= day <= datetime.utcnow().date():
                    pair = self._parse_exchange_flow(entry)
                    if pair != (None, None):
                        series[day] = pair
            return series
        except Exception as e:
            logger.warning(f"Exchange flow series fetch failed: {e}")
            return {}

    @staticmethod
    def _parse_exchange_flow(entry):
        """Missing one side is unknown, never a fabricated zero flow."""
        out = []
        for unit in ("Ntv", "USD"):
            sent = _finite_number(entry.get("FlowOutEx" + unit))
            received = _finite_number(entry.get("FlowInEx" + unit))
            out.append(sent - received if sent is not None and received is not None and sent >= 0 and received >= 0 else None)
        return tuple(out)

    def _fetch_btc_market_cap_series(self, days: int) -> Dict[date, float]:
        btc_chart = self._fetch_market_chart("bitcoin", days)
        if not btc_chart:
            return {}
        return self._series_to_date_map(btc_chart.get("market_caps", []))

    def _fetch_market_chart(self, coin_id: str, days: int) -> Optional[Dict[str, List[List[float]]]]:
        url = f"{self.COINGECKO_BASE}/coins/{coin_id}/market_chart"
        params = {
            "vs_currency": "usd",
            "days": days,
            "interval": "daily"
        }
        try:
            response = requests.get(url, params=params, timeout=20)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.warning(f"Error fetching {coin_id} market chart: {e}")
            return None

    def _series_to_date_map(self, series: List[List[float]]) -> Dict[date, float]:
        return _dated_point_map(series)

    def _calculate_btc_spy_corr(self, date_key: datetime) -> Optional[float]:
        btc_prices = self.db.query(CryptoPrice).filter(
            CryptoPrice.date < date_key,
            CryptoPrice.date >= date_key - timedelta(days=31)
        ).order_by(CryptoPrice.date, CryptoPrice.id).all()

        spy_prices = self.db.query(EquityPrice).filter(
            EquityPrice.symbol == "SPY",
            EquityPrice.date < date_key,
            EquityPrice.date >= date_key - timedelta(days=31)
        ).order_by(EquityPrice.date, EquityPrice.id).all()

        if len(btc_prices) < 21 or len(spy_prices) < 21:
            return None

        btc_series = {p.date.date(): p.btc_usd for p in btc_prices if _finite_number(p.btc_usd, positive=True) is not None}
        spy_series = {p.date.date(): p.close for p in spy_prices if _finite_number(p.close, positive=True) is not None}

        common_dates = sorted(set(btc_series.keys()) & set(spy_series.keys()))
        if len(common_dates) < 21 or (date_key.date() - common_dates[-1]).days > 4:
            return None

        btc_returns = []
        spy_returns = []
        for idx in range(1, len(common_dates)):
            d_prev = common_dates[idx - 1]
            d_curr = common_dates[idx]
            btc_prev = btc_series[d_prev]
            btc_curr = btc_series[d_curr]
            spy_prev = spy_series[d_prev]
            spy_curr = spy_series[d_curr]
            if btc_prev and spy_prev:
                btc_returns.append((btc_curr - btc_prev) / btc_prev)
                spy_returns.append((spy_curr - spy_prev) / spy_prev)

        if len(btc_returns) < 20:
            return None

        corr = np.corrcoef(btc_returns, spy_returns)[0, 1]
        return float(corr) if not np.isnan(corr) else None

    def _calculate_stablecoin_btc_ratio(self, date_key: datetime, stablecoin_supply: Optional[float]) -> Optional[float]:
        if not stablecoin_supply:
            return None

        crypto_price = self.db.query(CryptoPrice).filter(
            CryptoPrice.date <= date_key
        ).order_by(CryptoPrice.date.desc()).first()

        btc_mcap = None
        if crypto_price and crypto_price.total_crypto_mcap and crypto_price.btc_dominance:
            btc_mcap = crypto_price.total_crypto_mcap * 1_000_000_000 * (crypto_price.btc_dominance / 100)

        if not btc_mcap or btc_mcap == 0:
            return None

        return stablecoin_supply / btc_mcap


class EquityPriceIngestion:
    """Fetch daily equity prices (SPY, GDX, GLD, TLT, VIX, DXY) via yfinance."""

    def __init__(self, db: Session):
        self.db = db

    def fetch_daily_prices(self) -> int:
        count = 0
        try:
            symbol_map = {
                "SPY": "SPY",
                "GDX": "GDX",
                "GLD": "GLD",
                "TLT": "TLT",
                "VIX": "^VIX",
                "DXY": "DX-Y.NYB",
            }
            for symbol, ticker in symbol_map.items():
                data = yf.download(ticker, period="120d", progress=False, auto_adjust=True)
                if data.empty:
                    continue
                close_series = data["Close"]
                if hasattr(close_series, "columns"):
                    close_series = close_series.iloc[:, 0]

                for date_idx, close_value in close_series.items():
                    date_key = date_idx.to_pydatetime().replace(hour=0, minute=0, second=0, microsecond=0)
                    existing = self.db.query(EquityPrice).filter(
                        EquityPrice.symbol == symbol,
                        EquityPrice.date == date_key
                    ).first()
                    if existing:
                        existing.close = float(close_value)
                        continue

                    self.db.add(EquityPrice(
                        symbol=symbol,
                        date=date_key,
                        close=float(close_value),
                        source="YAHOO"
                    ))
                    count += 1

            self.db.commit()
            return count
        except Exception as e:
            logger.error(f"Error fetching equity prices: {e}")
            self.db.rollback()
            return 0


class MacroDataIngestion:
    """
    Fetches macro liquidity data (Fed balance sheet, rates, etc.)
    
    Data sources:
    - FRED API (Federal Reserve Economic Data) - free with API key
    - Alternative: Manual CSV updates, or scraping
    """
    
    FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
    
    def __init__(self, db: Session, fred_api_key: Optional[str] = None):
        self.db = db
        self.fred_api_key = fred_api_key or "YOUR_FRED_API_KEY"  # Should be in env config

    @staticmethod
    def _convert_m2_to_usd_trillions(series_name: str, value: float) -> Optional[float]:
        """Normalize configured broad-money currency levels into approximate USD trillions."""
        converters = {
            "us_m2": lambda raw: raw / 1_000.0,  # USD billions
            "china_m2": lambda raw: (raw / 1_000_000_000_000.0) / 7.2,
            "eurozone_m2": lambda raw: (raw / 1_000_000_000_000.0) * 1.1,
            "japan_m2": lambda raw: (raw / 1_000_000_000_000.0) / 140.0,
            "uk_m2": lambda raw: (raw / 1_000_000_000_000.0) * 1.27,
        }
        converter = converters.get(series_name)
        if converter is None:
            return None
        converted = converter(float(value))
        return converted if 0 < converted < 100 else None
    
    @staticmethod
    def _m2_panel_snapshot(series_data: dict, as_of: date, max_age_days: int = 62) -> Optional[dict]:
        components = {}
        dates = []
        for name in M2_PANEL_SERIES:
            observations = series_data.get(name) or {}
            eligible = [day for day in observations if day <= as_of and (as_of - day).days <= max_age_days]
            if not eligible:
                return None
            observed = max(eligible)
            try:
                value = MacroDataIngestion._convert_m2_to_usd_trillions(name, observations[observed])
            except (ValueError, TypeError, OverflowError):
                return None
            if value is None:
                return None
            components[name] = value
            dates.append(observed)
        total = sum(components.values())
        if not 10 <= total <= 500:
            return None
        return {"value": total, "date": max(dates), "components": components}

    def _store_m2_panel_snapshot(self, snapshot: dict):
        observed = datetime.combine(snapshot["date"], datetime.min.time())
        row = self.db.query(MacroLiquidityData).filter(
            MacroLiquidityData.date == observed, MacroLiquidityData.source == M2_PANEL_SOURCE,
        ).first()
        if row is None:
            row = MacroLiquidityData(date=observed, source=M2_PANEL_SOURCE)
            self.db.add(row)
        row.global_m2 = snapshot["value"]
        row.created_at = datetime.utcnow()
        return row

    def fetch_current_macro_data(self) -> Optional[MacroLiquidityData]:
        """
        Fetch latest macro liquidity indicators.
        """
        if not self.fred_api_key or self.fred_api_key == "YOUR_FRED_API_KEY":
            logger.warning("FRED API key not configured. Using placeholder macro data.")
            # Return None instead of fake data - calculation will handle missing components
            return None
        
        try:
            # Fed balance sheet
            fed_bs = self._fetch_fred_series("WALCL")  # Weekly balance sheet
            
            # Federal funds rate
            fed_rate = self._fetch_fred_series("DFF")  # Daily fed rate
            
            # 10Y Treasury yield
            treasury_10y = self._fetch_fred_series("DGS10")
            
            # CPI (for real rate calculation)
            cpi_yoy = self._fetch_fred_series("CPIAUCSL", units="pc1")  # Year-over-year % change
            
            # Four fixed component series, actual observation dates, bounded
            # carry-forward. A source that stopped in2023 cannot support2026 M2.
            today = datetime.utcnow().date()
            panel = {name: self._fetch_fred_series_historical(series, today - timedelta(days=90), today) for name, series in M2_PANEL_SERIES.items()}
            snapshot = self._m2_panel_snapshot(panel, today)
            if snapshot is not None:
                self._store_m2_panel_snapshot(snapshot)
            else:
                logger.warning("Current broad-money proxy unavailable: fixed four-country source coverage is stale or incomplete")
            # Current rate observations and the dated money aggregate have
            # distinct source clocks and must not share a retrieval-date label.
            global_m2 = None

            if not fed_bs:
                logger.warning("Could not fetch Fed balance sheet data")
                return None
            
            # Calculate real rate
            real_rate = None
            if treasury_10y and cpi_yoy:
                real_rate = treasury_10y - cpi_yoy
            
            macro_data = MacroLiquidityData(
                date=datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0),
                fed_balance_sheet=fed_bs,
                fed_rate=fed_rate,
                real_rate_10y=real_rate,
                global_m2=global_m2,
                source="FRED"
            )
            
            # Check if today's data exists
            existing = self.db.query(MacroLiquidityData).filter(
                MacroLiquidityData.date == macro_data.date,
                MacroLiquidityData.source == "FRED",
            ).first()
            
            if existing:
                existing.fed_balance_sheet = macro_data.fed_balance_sheet
                existing.fed_rate = macro_data.fed_rate
                existing.real_rate_10y = macro_data.real_rate_10y
                existing.global_m2 = macro_data.global_m2
                logger.info(f"Updated macro data for {macro_data.date.date()}")
            else:
                self.db.add(macro_data)
                logger.info(f"Added new macro data for {macro_data.date.date()}")
            
            self.db.commit()
            return macro_data
            
        except Exception as e:
            logger.error(f"Error fetching macro data: {e}", exc_info=True)
            self.db.rollback()
            return None
    
    def _fetch_fred_series(
        self, series_id: str, units: str = "lin"
    ) -> Optional[float]:
        """
        Fetch most recent value from a FRED series.
        
        Args:
            series_id: FRED series ID (e.g., "WALCL")
            units: Data transformation (lin=levels, pc1=percent change)
        """
        try:
            params = {
                "series_id": series_id,
                "api_key": self.fred_api_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 1,
                "units": units
            }
            
            response = requests.get(self.FRED_BASE, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if data.get("observations"):
                value = data["observations"][0]["value"]
                if value != ".":  # FRED uses "." for missing data
                    return float(value)
            
            return None
            
        except Exception as e:
            logger.error(f"Error fetching FRED series {series_id}: {e}")
            return None
    
    def seed_estimated_global_m2(self, days: int = 730):
        """Backfill only a fixed, date-aligned four-economy money proxy.

        Missing/discontinued component coverage is not replaced with zero,
        future observations, a changing country basket, or unlimited forwards.
        """
        if not self.fred_api_key or self.fred_api_key == "YOUR_FRED_API_KEY":
            return 0
        end_date = datetime.utcnow().date()
        start_date = end_date - timedelta(days=days)
        try:
            panel = {name: self._fetch_fred_series_historical(series, start_date - timedelta(days=62), end_date) for name, series in M2_PANEL_SERIES.items()}
            dates = sorted({day for observations in panel.values() for day in observations if start_date <= day <= end_date})
            snapshots = {}
            for observed in dates:
                snapshot = self._m2_panel_snapshot(panel, observed)
                if snapshot is not None:
                    snapshots[snapshot["date"]] = snapshot
            for snapshot in snapshots.values():
                self._store_m2_panel_snapshot(snapshot)
            self.db.commit()
            return len(snapshots)
        except Exception:
            logger.exception("Verified broad-money historical refresh failed")
            self.db.rollback()
            return 0

    def _fetch_fred_series_historical(
        self, series_id: str, start_date: date, end_date: date
    ) -> Dict[date, float]:
        """
        Fetch historical data for a FRED series.
        
        Returns:
            Dictionary mapping date -> value
        """
        try:
            params = {
                "series_id": series_id,
                "api_key": self.fred_api_key,
                "file_type": "json",
                "observation_start": start_date.strftime("%Y-%m-%d"),
                "observation_end": end_date.strftime("%Y-%m-%d"),
                "sort_order": "asc"
            }
            
            response = requests.get(self.FRED_BASE, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            result = {}
            if data.get("observations"):
                for obs in data["observations"]:
                    if obs["value"] != ".":
                        obs_date = datetime.strptime(obs["date"], "%Y-%m-%d").date()
                        result[obs_date] = float(obs["value"])
            
            return result
            
        except Exception as e:
            logger.error(f"Error fetching historical FRED series {series_id}: {e}")
            return {}


def run_daily_ingestion():
    """
    Main function to run daily data ingestion.
    Should be called by scheduler.
    """
    db = SessionLocal()
    
    try:
        logger.info("Starting daily AAS data ingestion...")
        
        # Fetch crypto data
        crypto_ingest = CryptoDataIngestion(db)
        from app.services.scheduler_lock import scheduler_job_lock
        with scheduler_job_lock("crypto_market_ingestion") as acquired:
            crypto_result = crypto_ingest.fetch_current_prices() if acquired else None
        
        if crypto_result:
            logger.info(f"Crypto data updated: BTC=${crypto_result.btc_usd:.2f}")
        else:
            logger.warning("Crypto data fetch failed - check CoinGecko API availability")

        # Fetch BTC network metrics
        network_ingest = BitcoinNetworkIngestion(db)
        network_result = network_ingest.fetch_current_metrics()
        if network_result:
            logger.info("Bitcoin network metrics updated")
        else:
            logger.warning("Bitcoin network metrics not available")

        # Fetch market prices for correlation calculations
        equity_ingest = EquityPriceIngestion(db)
        equity_updates = equity_ingest.fetch_daily_prices()
        logger.info("Equity prices updated: %s rows", equity_updates)
        
        # Fetch macro data (requires FRED API key)
        from app.core.config import settings
        macro_ingest = MacroDataIngestion(db, fred_api_key=getattr(settings, 'FRED_API_KEY', None))
        macro_result = macro_ingest.fetch_current_macro_data()
        
        if macro_result:
            logger.info("Macro data updated: Fed BS=%s; verified money proxy=%s", macro_result.fed_balance_sheet, macro_result.global_m2)
        else:
            logger.info("Macro data not available - FRED API key may not be configured")

        # Fetch crypto ecosystem metrics (stablecoins, DeFi, flows, correlation)
        ecosystem_ingest = CryptoEcosystemIngestion(db)
        ecosystem_result = ecosystem_ingest.fetch_current_metrics()
        if ecosystem_result:
            logger.info("Crypto ecosystem metrics updated")
        else:
            logger.warning("Crypto ecosystem metrics not available")
        
        logger.info("Daily AAS data ingestion completed")
        
    except Exception as e:
        logger.error(f"Error in daily ingestion: {e}", exc_info=True)
    finally:
        db.close()


if __name__ == "__main__":
    # For testing
    logging.basicConfig(level=logging.INFO)
    run_daily_ingestion()
