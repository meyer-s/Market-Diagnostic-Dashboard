"""
Crypto and Macro Data Ingestion Service

Fetches crypto prices and macro liquidity data from external APIs.
"""

import requests
import logging
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
            recent_count = self.db.query(CryptoPrice).filter(
                CryptoPrice.date >= date_key - timedelta(days=60)
            ).count()
            if recent_count < 30:
                logger.info("Seeding historical crypto prices for AAP calculations...")
                self.fetch_historical_prices(365)

            # Get BTC and ETH prices
            url = f"{self.COINGECKO_BASE}/simple/price"
            params = {
                "ids": "bitcoin,ethereum",
                "vs_currencies": "usd",
                "include_24hr_vol": "true",
                "include_market_cap": "true"
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            # Get global market data
            global_url = f"{self.COINGECKO_BASE}/global"
            global_response = requests.get(global_url, timeout=10)
            global_response.raise_for_status()
            global_data = global_response.json()["data"]
            
            # Get gold price for BTC/Gold ratio
            gold_price = self._fetch_gold_price()
            
            crypto_price = CryptoPrice(
                date=date_key,
                btc_usd=data["bitcoin"]["usd"],
                eth_usd=data["ethereum"]["usd"],
                total_crypto_mcap=global_data["total_market_cap"]["usd"] / 1_000_000_000,  # Convert to billions
                btc_dominance=global_data["market_cap_percentage"]["btc"],
                btc_gold_ratio=data["bitcoin"]["usd"] / gold_price if gold_price else None,
                btc_volume_24h=data["bitcoin"]["usd_24h_vol"],
                source="CoinGecko"
            )
            
            # Check if today's data already exists
            existing = self.db.query(CryptoPrice).filter(
                CryptoPrice.date == crypto_price.date
            ).first()
            
            if existing:
                # Update existing record
                existing.btc_usd = crypto_price.btc_usd
                existing.eth_usd = crypto_price.eth_usd
                existing.total_crypto_mcap = crypto_price.total_crypto_mcap
                existing.btc_dominance = crypto_price.btc_dominance
                existing.btc_gold_ratio = crypto_price.btc_gold_ratio
                existing.btc_volume_24h = crypto_price.btc_volume_24h
                logger.info(f"Updated crypto prices for {crypto_price.date.date()}")
            else:
                self.db.add(crypto_price)
                logger.info(f"Added new crypto prices for {crypto_price.date.date()}")
            
            self.db.commit()
            return crypto_price
            
        except requests.RequestException as e:
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
                ).first()
                if existing:
                    continue

                btc_price = btc_prices.get(date_obj)
                if btc_price is None:
                    continue

                total_mcap = total_market_caps.get(date_obj)
                btc_mcap = btc_market_caps.get(date_obj)
                btc_dominance = None
                if total_mcap and btc_mcap:
                    btc_dominance = (btc_mcap / total_mcap) * 100

                gold_price = self._fetch_gold_price()

                crypto_price = CryptoPrice(
                    date=date,
                    btc_usd=btc_price,
                    eth_usd=eth_prices.get(date_obj),
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
        data = {}
        for entry in series:
            if not entry or len(entry) < 2:
                continue
            timestamp_ms, value = entry[0], entry[1]
            day = datetime.utcfromtimestamp(timestamp_ms / 1000).date()
            data[day] = value
        return data

    def _fetch_gold_price(self) -> Optional[float]:
        """Helper to fetch current gold price for ratio calculation"""
        try:
            from app.models.precious_metals import MetalPrice
            from sqlalchemy import desc

            gold = self.db.query(MetalPrice).filter(
                MetalPrice.metal == 'AU'
            ).order_by(desc(MetalPrice.date)).first()

            return gold.price_usd_per_oz if gold else None

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
                ).first()

                if existing:
                    existing.hash_rate = values.get("hash_rate", existing.hash_rate)
                    existing.difficulty = values.get("difficulty", existing.difficulty)
                    existing.source = "BLOCKCHAIN"
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
                ).first()
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
                timestamp = entry.get("x")
                value = entry.get("y")
                if timestamp is None or value is None:
                    continue
                date_key = datetime.utcfromtimestamp(timestamp).replace(hour=0, minute=0, second=0, microsecond=0)
                series.append((date_key, float(value)))
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
        try:
            date_key = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            recent_count = self.db.query(CryptoEcosystemMetric).filter(
                CryptoEcosystemMetric.date >= date_key - timedelta(days=180)
            ).count()
            if recent_count < 10:
                logger.info("Seeding historical crypto ecosystem metrics...")
                self._backfill_metrics(180)

            stablecoin_supply = self._fetch_stablecoin_supply()
            defi_tvl = self._fetch_defi_tvl()
            exchange_outflows = self._fetch_exchange_outflows()
            btc_spy_corr = self._calculate_btc_spy_corr(date_key)
            stablecoin_btc_ratio = self._calculate_stablecoin_btc_ratio(date_key, stablecoin_supply)

            existing = self.db.query(CryptoEcosystemMetric).filter(
                CryptoEcosystemMetric.date == date_key
            ).first()

            if existing:
                existing.stablecoin_supply_usd = stablecoin_supply
                existing.defi_tvl_usd = defi_tvl
                existing.exchange_net_outflow_btc = exchange_outflows[0]
                existing.exchange_net_outflow_usd = exchange_outflows[1]
                existing.btc_spy_corr_30d = btc_spy_corr
                existing.stablecoin_btc_ratio = stablecoin_btc_ratio
                existing.source = "MULTI"
                self.db.commit()
                return existing

            metric = CryptoEcosystemMetric(
                date=date_key,
                stablecoin_supply_usd=stablecoin_supply,
                defi_tvl_usd=defi_tvl,
                exchange_net_outflow_btc=exchange_outflows[0],
                exchange_net_outflow_usd=exchange_outflows[1],
                btc_spy_corr_30d=btc_spy_corr,
                stablecoin_btc_ratio=stablecoin_btc_ratio,
                source="MULTI",
            )
            self.db.add(metric)
            self.db.commit()
            return metric
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
                CryptoEcosystemMetric.date == date_key
            ).first()

            stablecoin_supply = stablecoin_series.get(day)
            btc_mcap = btc_mcap_series.get(day)
            stablecoin_btc_ratio = (stablecoin_supply / btc_mcap) if stablecoin_supply and btc_mcap else None

            exchange_outflow = exchange_series.get(day, (None, None))

            if existing:
                existing.stablecoin_supply_usd = stablecoin_supply or existing.stablecoin_supply_usd
                existing.defi_tvl_usd = defi_series.get(day) or existing.defi_tvl_usd
                existing.exchange_net_outflow_btc = exchange_outflow[0] if exchange_outflow[0] is not None else existing.exchange_net_outflow_btc
                existing.exchange_net_outflow_usd = exchange_outflow[1] if exchange_outflow[1] is not None else existing.exchange_net_outflow_usd
                existing.stablecoin_btc_ratio = stablecoin_btc_ratio or existing.stablecoin_btc_ratio
                existing.source = "MULTI"
            else:
                self.db.add(CryptoEcosystemMetric(
                    date=date_key,
                    stablecoin_supply_usd=stablecoin_supply,
                    defi_tvl_usd=defi_series.get(day),
                    exchange_net_outflow_btc=exchange_outflow[0],
                    exchange_net_outflow_usd=exchange_outflow[1],
                    stablecoin_btc_ratio=stablecoin_btc_ratio,
                    source="MULTI"
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
                if day < cutoff:
                    continue
                series[day] = float(pegged_usd)
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
                if day < cutoff:
                    continue
                series[day] = float(tvl)
            return series
        except Exception as e:
            logger.warning(f"DeFi TVL series fetch failed: {e}")
            return {}

    def _fetch_exchange_outflows(self) -> Tuple[Optional[float], Optional[float]]:
        params = {
            "assets": "btc",
            "metrics": "FlowOutExNtv,FlowOutExUSD,FlowInExNtv,FlowInExUSD",
            "frequency": "1d",
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
            out_ntv = float(latest.get("FlowOutExNtv") or 0.0)
            out_usd = float(latest.get("FlowOutExUSD") or 0.0)
            in_ntv = float(latest.get("FlowInExNtv") or 0.0)
            in_usd = float(latest.get("FlowInExUSD") or 0.0)
            return (out_ntv - in_ntv, out_usd - in_usd)
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
                out_ntv = float(entry.get("FlowOutExNtv") or 0.0)
                out_usd = float(entry.get("FlowOutExUSD") or 0.0)
                in_ntv = float(entry.get("FlowInExNtv") or 0.0)
                in_usd = float(entry.get("FlowInExUSD") or 0.0)
                series[day] = (out_ntv - in_ntv, out_usd - in_usd)
            return series
        except Exception as e:
            logger.warning(f"Exchange flow series fetch failed: {e}")
            return {}

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
        data = {}
        for entry in series:
            if not entry or len(entry) < 2:
                continue
            timestamp_ms, value = entry[0], entry[1]
            day = datetime.utcfromtimestamp(timestamp_ms / 1000).date()
            data[day] = value
        return data

    def _calculate_btc_spy_corr(self, date_key: datetime) -> Optional[float]:
        btc_prices = self.db.query(CryptoPrice).filter(
            CryptoPrice.date <= date_key,
            CryptoPrice.date >= date_key - timedelta(days=45)
        ).order_by(CryptoPrice.date).all()

        spy_prices = self.db.query(EquityPrice).filter(
            EquityPrice.symbol == "SPY",
            EquityPrice.date <= date_key,
            EquityPrice.date >= date_key - timedelta(days=45)
        ).order_by(EquityPrice.date).all()

        if len(btc_prices) < 30 or len(spy_prices) < 30:
            return None

        btc_series = {p.date.date(): p.btc_usd for p in btc_prices if p.btc_usd}
        spy_series = {p.date.date(): p.close for p in spy_prices if p.close}

        common_dates = sorted(set(btc_series.keys()) & set(spy_series.keys()))
        if len(common_dates) < 30:
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
        elif crypto_price and crypto_price.btc_usd:
            btc_mcap = crypto_price.btc_usd * 19_500_000

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

                for date_idx, row in data.iterrows():
                    date_key = date_idx.to_pydatetime().replace(hour=0, minute=0, second=0, microsecond=0)
                    existing = self.db.query(EquityPrice).filter(
                        EquityPrice.symbol == symbol,
                        EquityPrice.date == date_key
                    ).first()
                    if existing:
                        existing.close = float(row["Close"])
                        continue

                    self.db.add(EquityPrice(
                        symbol=symbol,
                        date=date_key,
                        close=float(row["Close"]),
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
            
            # Global M2 aggregate (sum of major economies converted to USD trillions)
            # Note: FRED series have different units - need to normalize carefully
            
            m2_trillions_usd = []
            
            # US M2: Billions USD -> Trillions USD
            us_m2_billions = self._fetch_fred_series("WM2NS")  # Billions USD
            if us_m2_billions:
                us_m2_trillions = us_m2_billions / 1000.0
                m2_trillions_usd.append(us_m2_trillions)
                logger.debug(f"US M2: ${us_m2_trillions:.2f}T")
            
            # Eurozone M2: Millions EUR -> Trillions USD (1 EUR ≈ 1.1 USD)
            eurozone_m2_millions_eur = self._fetch_fred_series("MABMM301EZM189S")
            if eurozone_m2_millions_eur:
                eurozone_m2_trillions_usd = (eurozone_m2_millions_eur / 1_000_000) * 1.1
                m2_trillions_usd.append(eurozone_m2_trillions_usd)
                logger.debug(f"Eurozone M2: ${eurozone_m2_trillions_usd:.2f}T")
            
            # Japan M2: Millions JPY -> Trillions USD (1 USD ≈ 140 JPY)
            japan_m2_millions_jpy = self._fetch_fred_series("MABMM301JPM189S")
            if japan_m2_millions_jpy:
                japan_m2_trillions_usd = (japan_m2_millions_jpy / 1_000_000) / 140
                m2_trillions_usd.append(japan_m2_trillions_usd)
                logger.debug(f"Japan M2: ${japan_m2_trillions_usd:.2f}T")
            
            # UK M2: Millions GBP -> Trillions USD (1 GBP ≈ 1.27 USD)
            uk_m2_millions_gbp = self._fetch_fred_series("MABMM301GBM189S")
            if uk_m2_millions_gbp:
                uk_m2_trillions_usd = (uk_m2_millions_gbp / 1_000_000) * 1.27
                m2_trillions_usd.append(uk_m2_trillions_usd)
                logger.debug(f"UK M2: ${uk_m2_trillions_usd:.2f}T")
            
            # Calculate global M2 (already in trillions)
            global_m2 = None
            if len(m2_trillions_usd) >= 3:  # Need at least 3 major economies
                global_m2 = sum(m2_trillions_usd)
                logger.info(f"Global M2 calculated: ${global_m2:.2f}T from {len(m2_trillions_usd)} economies")
            else:
                logger.warning(f"Insufficient M2 data: only {len(m2_trillions_usd)} economies available")
            
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
                MacroLiquidityData.date == macro_data.date
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
    
    def seed_estimated_global_m2(self, days: int = 365):
        """
        Backfill historical global M2 data from FRED.
        
        Args:
            days: Number of days of historical data to fetch
        """
        if not self.fred_api_key or self.fred_api_key == "YOUR_FRED_API_KEY":
            logger.warning("FRED API key not configured. Cannot backfill M2 data.")
            return
        
        try:
            logger.info(f"Backfilling {days} days of global M2 data...")
            
            # Fetch historical data for all M2 components
            end_date = datetime.utcnow().date()
            start_date = end_date - timedelta(days=days)
            
            # FRED series IDs
            series_map = {
                'us_m2': 'WM2NS',
                'china_m2': 'MYAGM2CNM189S',
                'eurozone_m2': 'MABMM301EZM189S',
                'japan_m2': 'MABMM301JPM189S',
                'uk_m2': 'MABMM301GBM189S'
            }
            
            # Fetch all series
            series_data = {}
            for name, series_id in series_map.items():
                data = self._fetch_fred_series_historical(series_id, start_date, end_date)
                if data:
                    series_data[name] = data
                    logger.info(f"Fetched {len(data)} observations for {name}")
            
            if not series_data:
                logger.error("No M2 data could be fetched")
                return
            
            # Aggregate by date
            all_dates = set()
            for data in series_data.values():
                all_dates.update(data.keys())
            
            logger.info(f"Processing {len(all_dates)} unique dates...")
            
            added = 0
            updated = 0
            
            for date in sorted(all_dates):
                # Collect available M2 values for this date
                m2_values = []
                for series_name, data in series_data.items():
                    if date in data:
                        m2_values.append(data[date])
                
                # Need at least 3 major economies
                if len(m2_values) < 3:
                    continue
                
                # Calculate global M2 in trillions
                global_m2 = sum(m2_values) / 1000.0
                
                # Check if record exists
                date_dt = datetime.combine(date, datetime.min.time())
                existing = self.db.query(MacroLiquidityData).filter(
                    MacroLiquidityData.date == date_dt
                ).first()
                
                if existing:
                    if existing.global_m2 is None:
                        existing.global_m2 = global_m2
                        updated += 1
                else:
                    # Create new record with just M2 data
                    new_record = MacroLiquidityData(
                        date=date_dt,
                        global_m2=global_m2,
                        source="FRED"
                    )
                    self.db.add(new_record)
                    added += 1
            
            self.db.commit()
            logger.info(f"Global M2 backfill complete: {added} added, {updated} updated")
            
        except Exception as e:
            logger.error(f"Error backfilling M2 data: {e}", exc_info=True)
            self.db.rollback()
    
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
        logger.info("Starting daily AAP data ingestion...")
        
        # Fetch crypto data
        crypto_ingest = CryptoDataIngestion(db)
        crypto_result = crypto_ingest.fetch_current_prices()
        
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
            logger.info(f"Macro data updated: Fed BS=${macro_result.fed_balance_sheet:.0f}B, Global M2=${macro_result.global_m2:.2f}T")
        else:
            logger.info("Macro data not available - FRED API key may not be configured")

        # Fetch crypto ecosystem metrics (stablecoins, DeFi, flows, correlation)
        ecosystem_ingest = CryptoEcosystemIngestion(db)
        ecosystem_result = ecosystem_ingest.fetch_current_metrics()
        if ecosystem_result:
            logger.info("Crypto ecosystem metrics updated")
        else:
            logger.warning("Crypto ecosystem metrics not available")
        
        logger.info("Daily AAP data ingestion completed")
        
    except Exception as e:
        logger.error(f"Error in daily ingestion: {e}", exc_info=True)
    finally:
        db.close()


if __name__ == "__main__":
    # For testing
    logging.basicConfig(level=logging.INFO)
    run_daily_ingestion()
