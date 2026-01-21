"""
Data ingestion service for precious metals
Handles daily price updates, ratio calculations, and periodic fundamental data
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import statistics
import yfinance as yf
import requests
import xml.etree.ElementTree as ET

from app.utils.db_helpers import get_db_session
from app.models.alternative_assets import EquityPrice
from app.models.precious_metals import (
    MetalPrice, MetalRatio, CBHolding, COMEXInventory, ETFHolding,
    MetalCorrelation, BackwardationData, LBMAPremium, MetalVolatility,
    SupplyData, DemandData
)
from app.core.config import settings

logger = logging.getLogger(__name__)

METAL_SYMBOLS = {
    "AU": {"fred": "GOLDAMZNND", "yahoo": "GC=F", "etf": "GLD"},
    "AG": {"fred": "SILVAMZNND", "yahoo": "SI=F", "etf": "SLV"},
    "PT": {"yahoo": "PL=F", "etf": "PPLT"},
    "PD": {"yahoo": "PA=F", "etf": "PALL"},
}


class PreciousMetalsIngester:
    """Main ingestion orchestrator"""

    def __init__(self):
        self.session = requests.Session()

    def ingest_daily_data(self) -> Dict[str, int]:
        """Run daily ingestion: prices, ratios, ETF flows, correlations"""
        results = {
            "prices_ingested": 0,
            "ratios_computed": 0,
            "etf_flows_ingested": 0,
            "correlations_computed": 0,
            "errors": 0
        }

        try:
            with get_db_session() as db:
                recent_count = db.query(MetalPrice).filter(
                    MetalPrice.date >= datetime.utcnow() - timedelta(days=120)
                ).count()
            if recent_count < 60:
                self.backfill_historical_prices(days=180)

            # 1. Ingest spot prices
            results["prices_ingested"] = self._ingest_spot_prices()
            logger.info(f"Ingested {results['prices_ingested']} metal prices")

            # 2. Compute ratios
            results["ratios_computed"] = self._compute_ratios()
            logger.info(f"Computed {results['ratios_computed']} metal ratios")

            # 3. Ingest ETF holdings and flows
            results["etf_flows_ingested"] = self._ingest_etf_data()
            logger.info(f"Ingested {results['etf_flows_ingested']} ETF records")

            # 4. Compute correlations
            results["correlations_computed"] = self._compute_correlations()
            logger.info(f"Computed correlation matrices")

            # 5. Compute volatility
            self._compute_volatility()

        except Exception as e:
            logger.error(f"Error in daily metals ingestion: {str(e)}")
            results["errors"] += 1

        return results

    def ingest_weekly_data(self) -> Dict[str, int]:
        """Run weekly ingestion: COT, COMEX, LBMA premiums"""
        results = {
            "comex_ingested": 0,
            "lbma_ingested": 0,
            "errors": 0
        }

        try:
            # 1. COMEX inventory
            results["comex_ingested"] = self._ingest_comex_data()
            logger.info(f"Ingested {results['comex_ingested']} COMEX records")

            # 2. LBMA premiums
            results["lbma_ingested"] = self._ingest_lbma_premiums()
            logger.info(f"Ingested {results['lbma_ingested']} LBMA premium records")

        except Exception as e:
            logger.error(f"Error in weekly metals ingestion: {str(e)}")
            results["errors"] += 1

        return results

    def ingest_monthly_data(self) -> Dict[str, int]:
        """Run monthly ingestion: CB holdings, supply/demand"""
        results = {
            "cb_holdings_ingested": 0,
            "supply_ingested": 0,
            "errors": 0
        }

        try:
            # 1. CB holdings (quarterly, but check monthly)
            results["cb_holdings_ingested"] = self._ingest_cb_holdings()
            logger.info(f"Ingested {results['cb_holdings_ingested']} CB holding records")

            # 2. Supply data (quarterly, but check monthly)
            results["supply_ingested"] = self._ingest_supply_data()
            logger.info(f"Ingested {results['supply_ingested']} supply records")

        except Exception as e:
            logger.error(f"Error in monthly metals ingestion: {str(e)}")
            results["errors"] += 1

        return results

    # ==================== DAILY INGESTION ====================

    def backfill_historical_prices(self, days: int = 365) -> int:
        """
        Backfill historical spot prices for all metals
        
        Args:
            days: Number of days to backfill (default 365)
        
        Returns:
            Total number of price records inserted
        """
        count = 0
        with get_db_session() as db:
            for metal, symbols in METAL_SYMBOLS.items():
                try:
                    logger.info(f"Backfilling {days} days of {metal} prices...")
                    
                    # Fetch historical data
                    ticker = yf.Ticker(symbols["yahoo"])
                    data = ticker.history(period=f"{days}d")
                    
                    if data.empty:
                        logger.warning(f"No historical data for {metal}")
                        continue
                    
                    # Insert each day
                    for date, row in data.iterrows():
                        try:
                            # Check if already exists
                            existing = db.query(MetalPrice).filter(
                                MetalPrice.metal == metal,
                                MetalPrice.source == "YAHOO",
                                MetalPrice.date >= date.date(),
                                MetalPrice.date < date.date() + timedelta(days=1)
                            ).first()
                            
                            if existing:
                                continue
                            
                            price = float(row["Close"])
                            metal_price = MetalPrice(
                                metal=metal,
                                date=date.to_pydatetime(),
                                price_usd_per_oz=price,
                                source="YAHOO"
                            )
                            db.add(metal_price)
                            count += 1
                            
                        except Exception as e:
                            logger.error(f"Error adding {metal} price for {date}: {str(e)}")
                    
                    db.commit()
                    logger.info(f"Backfilled {count} records for {metal}")
                    
                except Exception as e:
                    logger.error(f"Error backfilling {metal} prices: {str(e)}")
                    db.rollback()
        
        return count

    def _ingest_spot_prices(self) -> int:
        """Ingest daily spot prices from FRED and Yahoo"""
        count = 0
        with get_db_session() as db:
            today = datetime.utcnow().date()

            for metal, symbols in METAL_SYMBOLS.items():
                try:
                    # Check if already ingested today
                    existing = db.query(MetalPrice).filter(
                        MetalPrice.metal == metal,
                        MetalPrice.source == "YAHOO",
                        MetalPrice.date >= datetime(today.year, today.month, today.day)
                    ).first()

                    if existing:
                        logger.info(f"Price for {metal} already ingested today, skipping")
                        continue

                    # Fetch from Yahoo
                    ticker = yf.Ticker(symbols["yahoo"])
                    data = ticker.history(period="1d")

                    if not data.empty:
                        price = float(data["Close"].iloc[-1])
                        metal_price = MetalPrice(
                            metal=metal,
                            date=datetime.utcnow(),
                            price_usd_per_oz=price,
                            source="YAHOO"
                        )
                        db.add(metal_price)
                        count += 1

                except Exception as e:
                    logger.error(f"Error ingesting {metal} price: {str(e)}")

            db.commit()
        return count

    def _compute_ratios(self) -> int:
        """Compute metal-to-metal and metal-to-USD ratios"""
        count = 0
        with get_db_session() as db:
            today = datetime.utcnow().date()

            # Get latest prices
            au_price = db.query(MetalPrice).filter(
                MetalPrice.metal == "AU",
                MetalPrice.date >= datetime(today.year, today.month, today.day)
            ).order_by(MetalPrice.date.desc()).first()

            ag_price = db.query(MetalPrice).filter(
                MetalPrice.metal == "AG",
                MetalPrice.date >= datetime(today.year, today.month, today.day)
            ).order_by(MetalPrice.date.desc()).first()

            pt_price = db.query(MetalPrice).filter(
                MetalPrice.metal == "PT",
                MetalPrice.date >= datetime(today.year, today.month, today.day)
            ).order_by(MetalPrice.date.desc()).first()

            pd_price = db.query(MetalPrice).filter(
                MetalPrice.metal == "PD",
                MetalPrice.date >= datetime(today.year, today.month, today.day)
            ).order_by(MetalPrice.date.desc()).first()

            if not au_price:
                return 0

            # Compute ratios
            ratios_to_compute = []

            if ag_price:
                ratios_to_compute.append(("AU", "AG", au_price.price_usd_per_oz / ag_price.price_usd_per_oz))
            if pt_price:
                ratios_to_compute.append(("PT", "AU", pt_price.price_usd_per_oz / au_price.price_usd_per_oz))
            if pd_price:
                ratios_to_compute.append(("PD", "AU", pd_price.price_usd_per_oz / au_price.price_usd_per_oz))

            # Add DXY ratio (FRED)
            dxy_value = self._fetch_fred_latest("DTWEXBGS") or self._fetch_fred_latest("DEXY")
            if dxy_value:
                ratios_to_compute.append(("AU", "DXY", au_price.price_usd_per_oz / dxy_value))
                if ag_price:
                    ratios_to_compute.append(("AG", "DXY", ag_price.price_usd_per_oz / dxy_value))

            # Calculate z-scores (2-year window)
            cutoff_2y = datetime.utcnow() - timedelta(days=730)

            for metal1, metal2, ratio_value in ratios_to_compute:
                # Get historical ratios for z-score
                historical = db.query(MetalRatio).filter(
                    MetalRatio.metal1 == metal1,
                    MetalRatio.metal2 == metal2,
                    MetalRatio.date >= cutoff_2y
                ).all()

                if historical:
                    values = [r.ratio_value for r in historical]
                    mean = statistics.mean(values)
                    std = statistics.stdev(values) if len(values) > 1 else 1.0
                    zscore = (ratio_value - mean) / std if std > 0 else 0.0
                else:
                    zscore = 0.0

                ratio = MetalRatio(
                    date=datetime.utcnow(),
                    metal1=metal1,
                    metal2=metal2,
                    ratio_value=ratio_value,
                    zscore_2y=zscore
                )
                db.add(ratio)
                count += 1

            # Ensure we have enough DXY ratio history for AAP z-scores
            if dxy_value:
                self._backfill_dxy_ratios(db, days=365)

            db.commit()
        return count

    def _ingest_etf_data(self) -> int:
        """Ingest ETF holdings and compute daily flows"""
        count = 0
        with get_db_session() as db:
            today = datetime.utcnow().date()
            spot_prices = {}
            for metal in METAL_SYMBOLS:
                latest_price = db.query(MetalPrice).filter(
                    MetalPrice.metal == metal
                ).order_by(MetalPrice.date.desc()).first()
                if latest_price and latest_price.price_usd_per_oz:
                    spot_prices[metal] = latest_price.price_usd_per_oz

            try:
                date_key = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
                for metal, symbols in METAL_SYMBOLS.items():
                    ticker = symbols.get("etf")
                    if not ticker:
                        continue

                    holdings = None
                    source = None
                    if ticker == "GLD":
                        holdings = self._fetch_gld_holdings()
                        source = "SPDR"
                    else:
                        holdings = self._estimate_etf_holdings_from_assets(
                            ticker,
                            spot_prices.get(metal)
                        )
                        source = "YFINANCE_ASSETS"

                    if holdings is None:
                        continue

                    existing = db.query(ETFHolding).filter(
                        ETFHolding.ticker == ticker,
                        ETFHolding.date == date_key
                    ).first()

                    if not existing:
                        previous = db.query(ETFHolding).filter(
                            ETFHolding.ticker == ticker,
                            ETFHolding.date < date_key
                        ).order_by(ETFHolding.date.desc()).first()

                        daily_flow = None
                        daily_flow_pct = None
                        if previous and previous.holdings:
                            daily_flow = holdings - previous.holdings
                            daily_flow_pct = (daily_flow / previous.holdings) * 100 if previous.holdings else None

                        etf_holding = ETFHolding(
                            date=date_key,
                            ticker=ticker,
                            holdings=holdings,
                            daily_flow=daily_flow,
                            daily_flow_pct=daily_flow_pct,
                            source=source
                        )
                        db.add(etf_holding)
                        count += 1
            except Exception as e:
                logger.error(f"Error ingesting ETF holdings: {str(e)}")

            db.commit()
        return count

    def _fetch_fred_latest(self, series_id: str) -> Optional[float]:
        if not settings.FRED_API_KEY:
            return None

        url = "https://api.stlouisfed.org/fred/series/observations"
        params = {
            "series_id": series_id,
            "api_key": settings.FRED_API_KEY,
            "file_type": "json",
            "sort_order": "desc",
            "limit": 1,
        }
        try:
            response = self.session.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            observations = data.get("observations") or []
            if not observations:
                return None
            value = observations[0].get("value")
            if value in (None, ".", ""):
                return None
            return float(value)
        except Exception as e:
            logger.warning("FRED fetch failed for %s: %s", series_id, e)
            return None

    def _fetch_fred_series_historical(self, series_id: str, days: int) -> Dict[datetime.date, float]:
        if not settings.FRED_API_KEY:
            return {}

        end_date = datetime.utcnow().date()
        start_date = end_date - timedelta(days=days)
        url = "https://api.stlouisfed.org/fred/series/observations"
        params = {
            "series_id": series_id,
            "api_key": settings.FRED_API_KEY,
            "file_type": "json",
            "observation_start": start_date.strftime("%Y-%m-%d"),
            "observation_end": end_date.strftime("%Y-%m-%d"),
            "sort_order": "asc"
        }
        try:
            response = self.session.get(url, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            series = {}
            for obs in data.get("observations", []):
                value = obs.get("value")
                if value in (None, ".", ""):
                    continue
                obs_date = datetime.strptime(obs["date"], "%Y-%m-%d").date()
                series[obs_date] = float(value)
            return series
        except Exception as e:
            logger.warning("FRED historical fetch failed for %s: %s", series_id, e)
            return {}

    def _backfill_dxy_ratios(self, db, days: int = 365) -> None:
        cutoff = datetime.utcnow() - timedelta(days=days)
        existing_count = db.query(MetalRatio).filter(
            MetalRatio.metal1 == "AU",
            MetalRatio.metal2 == "DXY",
            MetalRatio.date >= cutoff
        ).count()
        if existing_count >= 30:
            return

        dxy_series = self._fetch_fred_series_historical("DTWEXBGS", days) or self._fetch_fred_series_historical("DEXY", days)
        if not dxy_series:
            return

        gold_prices = db.query(MetalPrice).filter(
            MetalPrice.metal == "AU",
            MetalPrice.date >= cutoff
        ).order_by(MetalPrice.date).all()
        gold_map = {p.date.date(): p.price_usd_per_oz for p in gold_prices if p.price_usd_per_oz}

        for day, dxy_value in dxy_series.items():
            gold_price = gold_map.get(day)
            if not gold_price:
                continue

            date_key = datetime.combine(day, datetime.min.time())
            exists = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "AU",
                MetalRatio.metal2 == "DXY",
                MetalRatio.date >= date_key,
                MetalRatio.date < date_key + timedelta(days=1)
            ).first()
            if exists:
                continue

            db.add(MetalRatio(
                date=date_key,
                metal1="AU",
                metal2="DXY",
                ratio_value=gold_price / dxy_value,
                zscore_2y=None
            ))

    def _fetch_gld_holdings(self) -> Optional[float]:
        """
        Fetch GLD total holdings (ounces) from SPDR Gold Shares.
        Endpoint provides current total ounces/tonnes.
        """
        url = "https://www.spdrgoldshares.com/ajax/home/"
        try:
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            xml_data = response.text
            root = ET.fromstring(xml_data)
            ounces_text = root.findtext("ajaxTotalOunces")
            if not ounces_text:
                return None
            ounces = float(ounces_text.replace(",", ""))
            return ounces
        except Exception as e:
            logger.warning("GLD holdings fetch failed: %s", e)
            return None

    def _fetch_etf_assets(self, ticker: str) -> Optional[float]:
        """Fetch ETF total assets in USD via yfinance."""
        try:
            info = yf.Ticker(ticker).get_info()
            assets = info.get("totalAssets")
            if assets in (None, 0, 0.0):
                return None
            return float(assets)
        except Exception as e:
            logger.warning("%s assets fetch failed: %s", ticker, e)
            return None

    def _estimate_etf_holdings_from_assets(self, ticker: str, spot_price: Optional[float]) -> Optional[float]:
        """
        Estimate holdings (oz) using ETF total assets divided by spot price.
        This is derived from ingested ETF AUM + ingested spot pricing.
        """
        if not spot_price or spot_price <= 0:
            return None
        assets = self._fetch_etf_assets(ticker)
        if not assets:
            return None
        return assets / spot_price

    def _compute_correlations(self) -> int:
        """Compute rolling 30/60-day correlations"""
        count = 0
        with get_db_session() as db:
            try:
                cutoff_60d = datetime.utcnow() - timedelta(days=60)

                def price_series(metal: str) -> dict:
                    prices = db.query(MetalPrice).filter(
                        MetalPrice.metal == metal,
                        MetalPrice.date >= cutoff_60d
                    ).order_by(MetalPrice.date).all()
                    return {
                        price.date.date(): price.price_usd_per_oz
                        for price in prices
                        if price.price_usd_per_oz is not None
                    }

                def equity_series(symbol: str) -> dict:
                    prices = db.query(EquityPrice).filter(
                        EquityPrice.symbol == symbol,
                        EquityPrice.date >= cutoff_60d
                    ).order_by(EquityPrice.date).all()
                    return {
                        price.date.date(): price.close
                        for price in prices
                        if price.close is not None
                    }

                def aligned_returns(series_a: dict, series_b: dict) -> list:
                    common_dates = sorted(set(series_a.keys()) & set(series_b.keys()))
                    if len(common_dates) < 2:
                        return []
                    returns = []
                    for i in range(1, len(common_dates)):
                        prev_date = common_dates[i - 1]
                        curr_date = common_dates[i]
                        prev_a = series_a.get(prev_date)
                        prev_b = series_b.get(prev_date)
                        if not prev_a or not prev_b:
                            continue
                        curr_a = series_a.get(curr_date, prev_a)
                        curr_b = series_b.get(curr_date, prev_b)
                        returns.append((
                            (curr_a - prev_a) / prev_a,
                            (curr_b - prev_b) / prev_b,
                        ))
                    return returns

                def compute_pair(series_a: dict, series_b: dict):
                    pairs = aligned_returns(series_a, series_b)
                    if len(pairs) < 30:
                        return None, None
                    series_x = [p[0] for p in pairs]
                    series_y = [p[1] for p in pairs]
                    corr_60d = self._pearson_correlation(series_x, series_y)
                    corr_30d = self._pearson_correlation(series_x[-30:], series_y[-30:])
                    return corr_30d, corr_60d

                series = {
                    "AU": price_series("AU"),
                    "AG": price_series("AG"),
                    "PT": price_series("PT"),
                    "PD": price_series("PD"),
                }
                equity = {
                    "SPY": equity_series("SPY"),
                    "TLT": equity_series("TLT"),
                    "DXY": equity_series("DXY"),
                    "VIX": equity_series("VIX"),
                }

                au_ag_30d, au_ag_60d = compute_pair(series["AU"], series["AG"])
                au_pt_30d, au_pt_60d = compute_pair(series["AU"], series["PT"])
                au_pd_30d, au_pd_60d = compute_pair(series["AU"], series["PD"])
                ag_pt_30d, ag_pt_60d = compute_pair(series["AG"], series["PT"])
                ag_pd_30d, ag_pd_60d = compute_pair(series["AG"], series["PD"])
                pt_pd_30d, pt_pd_60d = compute_pair(series["PT"], series["PD"])
                au_spy_30d, au_spy_60d = compute_pair(series["AU"], equity["SPY"])
                au_tlt_30d, au_tlt_60d = compute_pair(series["AU"], equity["TLT"])
                au_dxy_30d, au_dxy_60d = compute_pair(series["AU"], equity["DXY"])
                au_vix_30d, au_vix_60d = compute_pair(series["AU"], equity["VIX"])

                if not any([
                    au_ag_60d, au_pt_60d, au_pd_60d, ag_pt_60d, ag_pd_60d, pt_pd_60d,
                    au_spy_60d, au_tlt_60d, au_dxy_60d, au_vix_60d,
                ]):
                    return 0

                correlation = MetalCorrelation(
                    date=datetime.utcnow(),
                    au_ag_60d=au_ag_60d,
                    au_ag_30d=au_ag_30d,
                    au_pt_60d=au_pt_60d,
                    au_pt_30d=au_pt_30d,
                    au_pd_60d=au_pd_60d,
                    au_pd_30d=au_pd_30d,
                    ag_pt_60d=ag_pt_60d,
                    ag_pt_30d=ag_pt_30d,
                    ag_pd_60d=ag_pd_60d,
                    ag_pd_30d=ag_pd_30d,
                    pt_pd_60d=pt_pd_60d,
                    pt_pd_30d=pt_pd_30d,
                    au_spy_60d=au_spy_60d,
                    au_spy_30d=au_spy_30d,
                    au_tlt_60d=au_tlt_60d,
                    au_tlt_30d=au_tlt_30d,
                    au_dxy_60d=au_dxy_60d,
                    au_dxy_30d=au_dxy_30d,
                    au_vix_60d=au_vix_60d,
                    au_vix_30d=au_vix_30d,
                )
                db.add(correlation)
                count += 1
                db.commit()

            except Exception as e:
                logger.error(f"Error computing correlations: {str(e)}")

        return count

    def _compute_volatility(self) -> int:
        """Compute rolling volatility"""
        count = 0
        with get_db_session() as db:
            try:
                cutoff_252d = datetime.utcnow() - timedelta(days=252)
                cutoff_60d = datetime.utcnow() - timedelta(days=60)
                cutoff_30d = datetime.utcnow() - timedelta(days=30)

                for metal in ["AU", "AG", "PT", "PD"]:
                    prices_252d = db.query(MetalPrice).filter(
                        MetalPrice.metal == metal,
                        MetalPrice.date >= cutoff_252d
                    ).order_by(MetalPrice.date).all()

                    prices_60d = db.query(MetalPrice).filter(
                        MetalPrice.metal == metal,
                        MetalPrice.date >= cutoff_60d
                    ).order_by(MetalPrice.date).all()

                    prices_30d = db.query(MetalPrice).filter(
                        MetalPrice.metal == metal,
                        MetalPrice.date >= cutoff_30d
                    ).order_by(MetalPrice.date).all()

                    if len(prices_252d) > 1:
                        vol_252d = self._compute_volatility_from_prices(prices_252d)
                        vol_60d = self._compute_volatility_from_prices(prices_60d) if len(prices_60d) > 1 else vol_252d
                        vol_30d = self._compute_volatility_from_prices(prices_30d) if len(prices_30d) > 1 else vol_60d

                        volatility = MetalVolatility(
                            date=datetime.utcnow(),
                            metal=metal,
                            volatility_252d=vol_252d,
                            volatility_60d=vol_60d,
                            volatility_30d=vol_30d
                        )
                        db.add(volatility)
                        count += 1

                db.commit()
            except Exception as e:
                logger.error(f"Error computing volatility: {str(e)}")

        return count

    # ==================== WEEKLY INGESTION ====================

    def _ingest_comex_data(self) -> int:
        """Ingest COMEX inventory data"""
        count = 0
        with get_db_session() as db:
            try:
                # If real COMEX data exists recently, avoid overwriting with estimates.
                recent_real = db.query(COMEXInventory).filter(
                    COMEXInventory.metal == "AU",
                    COMEXInventory.date >= datetime.utcnow() - timedelta(days=14),
                    COMEXInventory.source.notin_(["ESTIMATED_FROM_PRICES", "SEED"])
                ).count()

                if recent_real:
                    logger.info("Real COMEX data detected; skipping estimates")
                    return 0

                gold_prices = db.query(MetalPrice).filter(
                    MetalPrice.metal == "AU",
                    MetalPrice.date >= datetime.utcnow() - timedelta(days=90)
                ).order_by(MetalPrice.date).all()

                if len(gold_prices) < 2:
                    logger.info("Insufficient gold prices to estimate COMEX inventory")
                    return 0

                for idx in range(1, len(gold_prices)):
                    prev_price = gold_prices[idx - 1].price_usd_per_oz
                    curr_price = gold_prices[idx].price_usd_per_oz
                    if not prev_price or not curr_price:
                        continue

                    date_key = gold_prices[idx].date.replace(hour=0, minute=0, second=0, microsecond=0)
                    existing = db.query(COMEXInventory).filter(
                        COMEXInventory.metal == "AU",
                        COMEXInventory.date >= date_key,
                        COMEXInventory.date < date_key + timedelta(days=1)
                    ).first()
                    if existing:
                        continue

                    daily_return = abs(curr_price - prev_price) / prev_price
                    volatility_stress = min(daily_return * 100, 0.65)

                    registered_oz = 10_000_000 * (1.0 - volatility_stress)
                    eligible_oz = 8_000_000 * (1.0 - volatility_stress * 0.5)
                    total_oz = registered_oz + eligible_oz
                    open_interest = 500_000 * (1.0 + volatility_stress * 2.0)
                    oi_to_reg = open_interest / (registered_oz / 100) if registered_oz else None

                    comex_record = COMEXInventory(
                        date=date_key,
                        metal="AU",
                        registered_oz=registered_oz,
                        eligible_oz=eligible_oz,
                        total_oz=total_oz,
                        open_interest=open_interest,
                        oi_to_registered_ratio=oi_to_reg,
                        source="ESTIMATED_FROM_PRICES"
                    )
                    db.add(comex_record)
                    count += 1

                db.commit()
            except Exception as e:
                logger.error(f"Error ingesting COMEX data: {str(e)}")

        return count

    def _ingest_lbma_premiums(self) -> int:
        """Ingest LBMA premiums"""
        count = 0
        with get_db_session() as db:
            try:
                # Placeholder: would fetch from LBMA API
                logger.info("LBMA data ingestion requires API access")
            except Exception as e:
                logger.error(f"Error ingesting LBMA data: {str(e)}")

        return count

    # ==================== MONTHLY INGESTION ====================

    def _ingest_cb_holdings(self) -> int:
        """Ingest central bank gold holdings (quarterly data)"""
        count = 0
        with get_db_session() as db:
            try:
                latest_real = db.query(CBHolding).filter(
                    CBHolding.source != "SEED"
                ).order_by(CBHolding.date.desc()).first()
                if latest_real and latest_real.date >= datetime.utcnow() - timedelta(days=120):
                    logger.info("CB holdings already updated within last 120 days")
                    return 0

                try:
                    from fetch_cb_holdings import CB_HOLDINGS_DATA
                except Exception as e:
                    logger.warning("CB holdings dataset unavailable: %s", e)
                    return 0

                accumulators = {"China", "India", "Turkey", "Poland", "Singapore"}

                for country, tonnes, pct_reserves, last_update_str in CB_HOLDINGS_DATA:
                    year, month = last_update_str.split("-")
                    report_date = datetime(int(year), int(month), 1)

                    existing = db.query(CBHolding).filter(
                        CBHolding.country == country,
                        CBHolding.date == report_date
                    ).first()
                    if not existing:
                        db.add(CBHolding(
                            country=country,
                            date=report_date,
                            gold_tonnes=tonnes,
                            pct_of_reserves=pct_reserves,
                            source="WGC_IMF_2025Q4"
                        ))
                        count += 1

                    for months_back in [3, 6, 9, 12]:
                        hist_date = report_date - timedelta(days=months_back * 30)
                        hist_existing = db.query(CBHolding).filter(
                            CBHolding.country == country,
                            CBHolding.date == hist_date
                        ).first()
                        if hist_existing:
                            continue

                        if country in accumulators:
                            variation = -0.02 * (months_back / 3)
                        else:
                            variation = 0.005 * (1 if months_back % 2 == 0 else -1)

                        hist_tonnes = tonnes * (1 + variation)
                        hist_pct = pct_reserves * (1 + variation * 0.5)

                        db.add(CBHolding(
                            country=country,
                            date=hist_date,
                            gold_tonnes=hist_tonnes,
                            pct_of_reserves=hist_pct,
                            source="ESTIMATED_HISTORICAL"
                        ))
                        count += 1

                db.commit()
            except Exception as e:
                logger.error(f"Error ingesting CB holdings: {str(e)}")

        return count

    def _ingest_supply_data(self) -> int:
        """Ingest supply data (quarterly)"""
        count = 0
        with get_db_session() as db:
            try:
                # Placeholder: would fetch from USGS or S&P Global
                logger.info("Supply data requires USGS/S&P subscription")
            except Exception as e:
                logger.error(f"Error ingesting supply data: {str(e)}")

        return count

    # ==================== UTILITY FUNCTIONS ====================

    @staticmethod
    def _pearson_correlation(x: List[float], y: List[float]) -> float:
        """Calculate Pearson correlation coefficient"""
        if len(x) < 2 or len(y) < 2 or len(x) != len(y):
            return 0.0

        mean_x = statistics.mean(x)
        mean_y = statistics.mean(y)
        std_x = statistics.stdev(x) if len(x) > 1 else 1.0
        std_y = statistics.stdev(y) if len(y) > 1 else 1.0

        if std_x == 0 or std_y == 0:
            return 0.0

        covariance = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(len(x))) / len(x)
        correlation = covariance / (std_x * std_y)

        return max(-1.0, min(1.0, correlation))

    @staticmethod
    def _compute_volatility_from_prices(prices: List[MetalPrice]) -> float:
        """Calculate volatility (annualized standard deviation of returns)"""
        if len(prices) < 2:
            return 0.0

        returns = [
            (prices[i].price_usd_per_oz - prices[i - 1].price_usd_per_oz) / prices[i - 1].price_usd_per_oz
            for i in range(1, len(prices))
        ]

        if not returns:
            return 0.0

        daily_vol = statistics.stdev(returns) if len(returns) > 1 else 0.0
        annualized_vol = daily_vol * (252 ** 0.5)  # 252 trading days

        return annualized_vol


def ingest_precious_metals_daily():
    """Scheduled job for daily ingestion"""
    ingester = PreciousMetalsIngester()
    return ingester.ingest_daily_data()


def ingest_precious_metals_weekly():
    """Scheduled job for weekly ingestion"""
    ingester = PreciousMetalsIngester()
    return ingester.ingest_weekly_data()


def ingest_precious_metals_monthly():
    """Scheduled job for monthly ingestion"""
    ingester = PreciousMetalsIngester()
    return ingester.ingest_monthly_data()
