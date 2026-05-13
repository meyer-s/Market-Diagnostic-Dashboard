"""
ETL Runner
Atlas → Agent A

Pulls indicator data from FRED or Yahoo, normalizes, scores, and stores into DB.
This is the backbone of the daily ingestion cycle.

Supports:
- ingest_indicator(code)
- ingest_all_indicators()
"""

import logging

from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.models.system_status import SystemStatus

from app.services.ingestion.fred_client import FredClient
from app.services.ingestion.yahoo_client import YahooClient
from app.services.ingestion.breadth_utils import (
    compute_breadth_composite,
    compute_sector_breadth_series,
    SECTOR_TICKERS,
)
from app.services.ingestion.sentiment_sources import fetch_sentiment_component_series
from app.services.sector_divergence import compute_alignment_score, split_defensive_cyclical_scores
from app.services.system_overview_inputs import get_page_input_history, get_page_input_statuses, is_page_input
from app.utils.system_scoring import compute_weighted_composite

logger = logging.getLogger(__name__)

# Agent C — clean stubs (will be replaced in Ticket C1)
from app.services.analytics_stub import (
    classify_series,
    normalize_series,
    compute_score,
    compute_state,
    score_series,
    direction_adjusted
)


class ETLRunner:
    """Main data ingestion engine."""

    def __init__(self):
        self.fred = FredClient()
        self.yahoo = YahooClient()

    async def ingest_indicator(self, code: str, backfill_days: int = 0):
        """
        Fetches raw series, computes derived fields, stores data.
        
        Args:
            code: Indicator code
            backfill_days: If > 0, store last N days of history. If 0, store only latest.
        """
        db: Session = SessionLocal()

        ind: Indicator = (
            db.query(Indicator)
            .filter(Indicator.code == code)
            .first()
        )

        if not ind:
            db.close()
            raise ValueError(f"Indicator {code} not found in DB")

        if code == "AAS":
            db.close()
            return await self._ingest_aas(backfill_days)

        if is_page_input(code):
            db.close()
            return await self._ingest_page_input(code, backfill_days)

        # Temporarily disabled: heavy FRED fetching slows down the ETL run
        if code == "BOND_MARKET_STABILITY":
            db.close()
            return {"code": code, "status": "skipped", "reason": "temporarily disabled"}

        # Pull enough data for normalization + backfill
        lookback_days = max(800, backfill_days + ind.lookback_days_for_z)
        start_date = (datetime.utcnow() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

        # --- Fetch raw series ---
        source_upper = ind.source.upper() if ind.source else ""
        
        if source_upper == "DERIVED":
            # Handle derived indicators that combine multiple data sources
            if code == "CONSUMER_HEALTH":
                # Fetch PCE, CPI, and PI data
                pce_series = await self.fred.fetch_series("PCE", start_date=start_date)
                cpi_series = await self.fred.fetch_series("CPIAUCSL", start_date=start_date)
                pi_series = await self.fred.fetch_series("PI", start_date=start_date)

                # Fetch XLY (Consumer Discretionary) and XLP (Consumer Staples) for
                # wants-vs-needs divergence signal
                xly_series = self.yahoo.fetch_series("XLY", start_date=start_date)
                xlp_series = self.yahoo.fetch_series("XLP", start_date=start_date)
                xly_price_dict = {x["date"]: x["value"] for x in xly_series if x["value"] is not None}
                xlp_price_dict = {x["date"]: x["value"] for x in xlp_series if x["value"] is not None}
                xly_dates_sorted = sorted(xly_price_dict.keys())
                xlp_dates_sorted = sorted(xlp_price_dict.keys())

                # Create dictionaries for forward-filling
                pce_dict = {x["date"]: x["value"] for x in pce_series if x["value"] is not None}
                cpi_dict = {x["date"]: x["value"] for x in cpi_series if x["value"] is not None}
                pi_dict = {x["date"]: x["value"] for x in pi_series if x["value"] is not None}

                # Use union of all dates to capture all available data
                all_dates = sorted(set(pce_dict.keys()) | set(cpi_dict.keys()) | set(pi_dict.keys()))

                # Forward-fill: build lists with last known values
                pce_raw = []
                cpi_raw = []
                pi_raw = []
                last_pce = None
                last_cpi = None
                last_pi = None

                common_dates = []
                for date in all_dates:
                    if date in pce_dict:
                        last_pce = pce_dict[date]
                    if date in cpi_dict:
                        last_cpi = cpi_dict[date]
                    if date in pi_dict:
                        last_pi = pi_dict[date]

                    # Only add if we have at least one value for each series
                    if last_pce is not None and last_cpi is not None and last_pi is not None:
                        common_dates.append(date)
                        pce_raw.append(last_pce)
                        cpi_raw.append(last_cpi)
                        pi_raw.append(last_pi)

                # Build aligned series
                series = [{"date": date, "value": 0.0} for date in common_dates]
            elif code == "BOND_MARKET_STABILITY":
                # This indicator fetches its data in the processing section below
                # Just create placeholder series for now
                series = [{"date": start_date, "value": 0.0}]
            elif code == "LIQUIDITY_PROXY":
                # This indicator fetches its data in the processing section below
                # Just create placeholder series for now
                series = [{"date": start_date, "value": 0.0}]
            elif code == "ANALYST_ANXIETY":
                # This indicator fetches its data in the processing section below
                # Just create placeholder series for now
                series = [{"date": start_date, "value": 0.0}]
            elif code == "SENTIMENT_COMPOSITE":
                # This indicator fetches its data in the processing section below
                # Just create placeholder series for now
                series = [{"date": start_date, "value": 0.0}]
            elif code == "SECTOR_REGIME_ALIGNMENT":
                # This indicator fetches its data in the processing section below
                # Just create placeholder series for now
                series = [{"date": start_date, "value": 0.0}]
            elif code == "BREADTH_HEALTH":
                # This indicator fetches its data in the processing section below
                # Just create placeholder series for now
                series = [{"date": start_date, "value": 0.0}]
            else:
                db.close()
                raise ValueError(f"Unknown derived indicator: {code}")
        elif source_upper == "FRED":
            series = await self.fred.fetch_series(ind.source_symbol, start_date=start_date)

        elif source_upper == "YAHOO":
            series = self.yahoo.fetch_series(ind.source_symbol, start_date=start_date)

        else:
            db.close()
            raise ValueError(f"Unknown source type: {ind.source}")

        # Remove missing/null values
        clean_values = [x for x in series if x["value"] is not None]

        if len(clean_values) == 0:
            db.close()
            raise ValueError(f"No valid data points returned for {code}")

        # Extract the raw numeric list for normalization/scoring
        raw_series = [x["value"] for x in clean_values]

        # --- Check if this indicator should use rate-of-change ---
        # For derived indicators, calculate the derived metric
        if code == "CONSUMER_HEALTH":
            import bisect

            # Calculate MoM% for PCE, CPI, and PI
            pce_mom = [0.0]
            cpi_mom = [0.0]
            pi_mom = [0.0]

            for i in range(1, len(pce_raw)):
                pce_pct = ((pce_raw[i] - pce_raw[i-1]) / pce_raw[i-1]) * 100 if pce_raw[i-1] != 0 else 0.0
                cpi_pct = ((cpi_raw[i] - cpi_raw[i-1]) / cpi_raw[i-1]) * 100 if cpi_raw[i-1] != 0 else 0.0
                pi_pct = ((pi_raw[i] - pi_raw[i-1]) / pi_raw[i-1]) * 100 if pi_raw[i-1] != 0 else 0.0

                pce_mom.append(pce_pct)
                cpi_mom.append(cpi_pct)
                pi_mom.append(pi_pct)

            # PCE/CPI/PI composite: [(PCE-CPI) + (PI-CPI)] / 2
            consumer_health = []
            for i in range(len(pce_mom)):
                pce_spread = pce_mom[i] - cpi_mom[i]
                pi_spread = pi_mom[i] - cpi_mom[i]
                consumer_health.append((pce_spread + pi_spread) / 2)

            raw_series = consumer_health

            # --- XLY/XLP ratio: discretionary vs staples (wants vs needs) ---
            # For each macro date, look up the nearest prior XLY and XLP price
            xly_xlp_ratios = []
            for date in common_dates:
                xi = bisect.bisect_right(xly_dates_sorted, date) - 1
                li = bisect.bisect_right(xlp_dates_sorted, date) - 1
                if xi >= 0 and li >= 0:
                    xly_v = xly_price_dict[xly_dates_sorted[xi]]
                    xlp_v = xlp_price_dict[xlp_dates_sorted[li]]
                    xly_xlp_ratios.append(xly_v / xlp_v if xlp_v else None)
                else:
                    xly_xlp_ratios.append(None)

            # Forward-fill any missing ratio values
            last_valid_ratio = None
            clean_ratios = []
            for v in xly_xlp_ratios:
                if v is not None:
                    last_valid_ratio = v
                clean_ratios.append(last_valid_ratio)

            # Normalize each component separately, then blend 85% macro + 15% XLY/XLP
            macro_norm = normalize_series(consumer_health, direction=ind.direction, lookback=ind.lookback_days_for_z)

            if any(v is not None for v in clean_ratios):
                filled_ratios = [v if v is not None else 1.0 for v in clean_ratios]
                xly_xlp_norm = normalize_series(filled_ratios, direction=ind.direction, lookback=ind.lookback_days_for_z)
                normalized_series = [
                    0.85 * macro_norm[i] + 0.15 * xly_xlp_norm[i]
                    for i in range(len(macro_norm))
                ]
            else:
                normalized_series = macro_norm
        elif code == "BOND_MARKET_STABILITY":
            import numpy as np
            
            # Fetch all sub-indicators
            # A. Credit Spread Stress (40%)
            hy_oas_series = await self.fred.fetch_series("BAMLH0A0HYM2", start_date=start_date)  # HY OAS
            ig_oas_series = await self.fred.fetch_series("BAMLC0A0CM", start_date=start_date)    # IG OAS
            
            # B. Yield Curve Health (20%)
            dgs10_series = await self.fred.fetch_series("DGS10", start_date=start_date)
            dgs2_series = await self.fred.fetch_series("DGS2", start_date=start_date)
            dgs3mo_series = await self.fred.fetch_series("DGS3MO", start_date=start_date)
            dgs30_series = await self.fred.fetch_series("DGS30", start_date=start_date)
            dgs5_series = await self.fred.fetch_series("DGS5", start_date=start_date)
            
            # C. Rates Momentum - already have DGS2 and DGS10
            
            # D. Treasury Volatility - Calculate from 10Y yield changes (better data availability than MOVE)
            # Instead of MOVE Index, we'll calculate realized volatility from DGS10
            # This will be computed later from dgs10 data
            
            # E. Term Premium (optional - may not be available)
            term_premium_series = []
            try:
                term_premium_series = await self.fred.fetch_series("ACMTP10", start_date=start_date)
            except Exception:
                print("Warning: Term Premium (ACMTP10) not available, using 4-component model")
            
            # Align all series by date
            def series_to_dict(s):
                return {x["date"]: x["value"] for x in s if x["value"] is not None}
            
            hy_oas = series_to_dict(hy_oas_series)
            ig_oas = series_to_dict(ig_oas_series)
            dgs10 = series_to_dict(dgs10_series)
            dgs2 = series_to_dict(dgs2_series)
            dgs3mo = series_to_dict(dgs3mo_series)
            dgs30 = series_to_dict(dgs30_series)
            dgs5 = series_to_dict(dgs5_series)
            term_premium = series_to_dict(term_premium_series) if term_premium_series else {}
            
            # Find common dates (intersection of required data - no MOVE needed, we'll calculate volatility)
            # Term premium is optional
            required_dates = set(hy_oas.keys()) & set(ig_oas.keys()) & set(dgs10.keys()) & set(dgs2.keys()) & \
                           set(dgs3mo.keys())
            common_dates = sorted(required_dates)
            
            if len(common_dates) < 30:
                db.close()
                raise ValueError(f"Insufficient overlapping data for {code}: only {len(common_dates)} common dates")
            
            # Build series for each component
            series = [{"date": date, "value": 0.0} for date in common_dates]
            
            # Extract aligned raw values
            hy_oas_vals = np.array([hy_oas[d] for d in common_dates])
            ig_oas_vals = np.array([ig_oas[d] for d in common_dates])
            dgs10_vals = np.array([dgs10[d] for d in common_dates])
            dgs2_vals = np.array([dgs2[d] for d in common_dates])
            dgs3mo_vals = np.array([dgs3mo[d] for d in common_dates])
            # Only extract dgs30/dgs5 if they have data for all required dates
            dgs30_vals = np.array([dgs30[d] for d in common_dates]) if (dgs30 and all(d in dgs30 for d in common_dates)) else None
            dgs5_vals = np.array([dgs5[d] for d in common_dates]) if (dgs5 and all(d in dgs5 for d in common_dates)) else None
            
            # Helper function to compute z-score and map to 0-100
            def z_score_to_100(vals, invert=False):
                """Convert to z-scores, then map to 0-100 scale. Higher = more stress."""
                mean = np.mean(vals)
                std = np.std(vals)
                if std == 0:
                    return np.full_like(vals, 50.0)
                z_scores = (vals - mean) / std
                if invert:
                    z_scores = -z_scores
                # Map z-score to 0-100: z=-2 → 0, z=0 → 50, z=2 → 100
                scores = 50 + (z_scores * 25)
                return np.clip(scores, 0, 100)
            
            # A. Credit Spread Stress (40%) - higher spreads = more stress
            hy_stress = z_score_to_100(hy_oas_vals, invert=False)
            ig_stress = z_score_to_100(ig_oas_vals, invert=False)
            credit_stress = (hy_stress + ig_stress) / 2
            
            # B. Yield Curve Health (20%) - higher slope = healthier, invert for stress
            curve_10y2y = dgs10_vals - dgs2_vals
            curve_10y3m = dgs10_vals - dgs3mo_vals
            
            # Check if 30Y and 5Y data is available for all common dates
            has_30y_5y = (len(dgs30) > 0 and len(dgs5) > 0 and 
                         all(d in dgs30 for d in common_dates) and 
                         all(d in dgs5 for d in common_dates))
            
            curve_scores = []
            if has_30y_5y:
                dgs30_vals = np.array([dgs30[d] for d in common_dates])
                dgs5_vals = np.array([dgs5[d] for d in common_dates])
                curve_30y5y = dgs30_vals - dgs5_vals
                # Average all three curves
                for i in range(len(common_dates)):
                    curves = [curve_10y2y[i], curve_10y3m[i], curve_30y5y[i]]
                    curve_scores.append(np.mean(curves))
            else:
                # Average just 10Y-2Y and 10Y-3M (most reliable)
                for i in range(len(common_dates)):
                    curves = [curve_10y2y[i], curve_10y3m[i]]
                    curve_scores.append(np.mean(curves))
            
            curve_health = z_score_to_100(np.array(curve_scores), invert=True)  # Invert: steep curve = low stress
            
            # C. Rates Momentum (15%) - 3-month ROC, large upward spikes = stress
            def compute_roc(vals, periods=63):  # ~3 months of trading days
                roc = np.zeros_like(vals)
                for i in range(periods, len(vals)):
                    roc[i] = vals[i] - vals[i - periods]
                return roc
            
            roc_2y = compute_roc(dgs2_vals)
            roc_10y = compute_roc(dgs10_vals)
            avg_roc = (roc_2y + roc_10y) / 2
            rates_momentum_stress = z_score_to_100(avg_roc, invert=False)  # Large increases = stress
            
            # D. Treasury Volatility (15%) - Calculate realized volatility from 10Y yield changes
            # Use 20-day rolling standard deviation of daily yield changes as volatility proxy
            dgs10_changes = np.zeros_like(dgs10_vals)
            for i in range(1, len(dgs10_vals)):
                dgs10_changes[i] = abs(dgs10_vals[i] - dgs10_vals[i-1])
            
            # Calculate rolling volatility (20-period window)
            rolling_vol = np.zeros_like(dgs10_changes)
            window = 20
            for i in range(window, len(dgs10_changes)):
                rolling_vol[i] = np.std(dgs10_changes[i-window:i])
            
            # For initial values (before full window), use expanding window
            for i in range(1, min(window, len(dgs10_changes))):
                rolling_vol[i] = np.std(dgs10_changes[:i+1]) if i > 0 else 0
            
            treasury_volatility_stress = z_score_to_100(rolling_vol, invert=False)  # Higher volatility = stress
            
            # E. Term Premium (10%) - high term premium = stress (optional)
            has_term_premium = len(term_premium) > 0 and all(d in term_premium for d in common_dates)
            
            # Compute weighted composite: lower = better (stable), higher = stress
            # If term premium unavailable, redistribute weight proportionally
            if has_term_premium:
                term_premium_vals = np.array([term_premium[d] for d in common_dates])
                term_premium_stress = z_score_to_100(term_premium_vals, invert=False)
                weights = {
                    'credit': 0.40,
                    'curve': 0.20,
                    'momentum': 0.15,
                    'volatility': 0.15,
                    'premium': 0.10
                }
                composite_stress = (
                    credit_stress * weights['credit'] +
                    curve_health * weights['curve'] +
                    rates_momentum_stress * weights['momentum'] +
                    treasury_volatility_stress * weights['volatility'] +
                    term_premium_stress * weights['premium']
                )
            else:
                # Without term premium: redistribute 10% across other components
                weights = {
                    'credit': 0.44,  # 40% + 4%
                    'curve': 0.23,   # 20% + 3%
                    'momentum': 0.17,  # 15% + 2%
                    'volatility': 0.16     # 15% + 1%
                }
                composite_stress = (
                    credit_stress * weights['credit'] +
                    curve_health * weights['curve'] +
                    rates_momentum_stress * weights['momentum'] +
                    treasury_volatility_stress * weights['volatility']
                )
            
            # Store composite stress score (0-100, where higher = more stress)
            # direction=-1 in the indicator config will invert this during normalization
            # so that high stress → low final score (RED) and low stress → high final score (GREEN)
            
            # Update series with actual dates and values
            series = [{"date": common_dates[i], "value": composite_stress[i]} for i in range(len(common_dates))]
            clean_values = series  # All values are valid
            raw_series = composite_stress.tolist()

            # Composite stress is already on a 0-100 scale. Convert to z-space
            # (inverse of map_z_to_score) to avoid double-normalization.
            score_to_z = lambda score: (score / 100.0) * 4 - 2
            normalized_series = direction_adjusted(
                [score_to_z(val) for val in raw_series],
                ind.direction,
            )
        elif code == "LIQUIDITY_PROXY":
            import numpy as np
            
            # Fetch liquidity components
            # 1. M2 Money Supply (M2SL)
            m2_series = await self.fred.fetch_series("M2SL", start_date=start_date)
            
            # 2. Fed Balance Sheet Total Assets (WALCL)
            fed_bs_series = await self.fred.fetch_series("WALCL", start_date=start_date)
            
            # 3. Overnight Reverse Repo (RRPONTSYD)
            rrp_series = await self.fred.fetch_series("RRPONTSYD", start_date=start_date)
            
            # Convert to dicts
            def series_to_dict(s):
                return {x["date"]: x["value"] for x in s if x["value"] is not None}
            
            m2_dict = series_to_dict(m2_series)
            fed_bs_dict = series_to_dict(fed_bs_series)
            rrp_dict = series_to_dict(rrp_series)
            
            # These series have different update frequencies (M2 is monthly, RRP is daily, etc.)
            # Use union of dates and forward-fill missing values
            all_dates = sorted(set(m2_dict.keys()) | set(fed_bs_dict.keys()) | set(rrp_dict.keys()))
            
            if len(all_dates) < 30:
                db.close()
                raise ValueError(f"Insufficient data for {code}: only {len(all_dates)} total dates")
            
            # Forward fill: use last known value for each series
            def forward_fill(data_dict, all_dates):
                result = {}
                last_value = None
                for date in all_dates:
                    if date in data_dict:
                        last_value = data_dict[date]
                    if last_value is not None:
                        result[date] = last_value
                return result
            
            m2_filled = forward_fill(m2_dict, all_dates)
            fed_bs_filled = forward_fill(fed_bs_dict, all_dates)
            rrp_filled = forward_fill(rrp_dict, all_dates)
            
            # Only use dates where all three have values
            common_dates = [d for d in all_dates if d in m2_filled and d in fed_bs_filled and d in rrp_filled]
            
            if len(common_dates) < 30:
                db.close()
                raise ValueError(f"Insufficient overlapping data for {code}: only {len(common_dates)} common dates after forward fill")
            
            series = [{"date": date, "value": 0.0} for date in common_dates]
            
            # Extract aligned values (using forward-filled data)
            m2_vals = np.array([m2_filled[d] for d in common_dates])
            fed_bs_vals = np.array([fed_bs_filled[d] for d in common_dates])
            rrp_vals = np.array([rrp_filled[d] for d in common_dates])
            
            # Calculate M2 YoY% change using calendar lookback (handles daily forward-fill).
            import bisect

            common_date_objs = [datetime.strptime(d, "%Y-%m-%d") for d in common_dates]
            m2_yoy = np.zeros_like(m2_vals)
            for i, current_date in enumerate(common_date_objs):
                target_date = current_date - timedelta(days=365)
                j = bisect.bisect_left(common_date_objs, target_date)
                if j < i and m2_vals[j] != 0:
                    m2_yoy[i] = ((m2_vals[i] - m2_vals[j]) / m2_vals[j]) * 100
            
            # Calculate Fed Balance Sheet change (delta)
            fed_bs_delta = np.zeros_like(fed_bs_vals)
            for i in range(1, len(fed_bs_vals)):
                fed_bs_delta[i] = fed_bs_vals[i] - fed_bs_vals[i-1]
            
            # Helper: compute z-score
            def compute_z_score(vals):
                mean = np.mean(vals)
                std = np.std(vals)
                if std == 0:
                    return np.zeros_like(vals)
                return (vals - mean) / std
            
            # Compute z-scores for each component
            z_m2_yoy = compute_z_score(m2_yoy)
            z_fed_delta = compute_z_score(fed_bs_delta)
            z_rrp = compute_z_score(rrp_vals)
            
            # Formula: Liquidity = z(M2_YoY) + z(Delta_FedBS) - z(RRP_level)
            # Higher RRP = lower liquidity (subtract it)
            # Higher M2 growth and Fed balance sheet = higher liquidity
            liquidity_proxy = z_m2_yoy + z_fed_delta - z_rrp
            
            # Apply 30-day smoothing to reduce noise from mixed data frequencies
            # Liquidity is structural and shouldn't flip daily
            window = 30
            smoothed_liquidity = np.convolve(liquidity_proxy, np.ones(window)/window, mode='same')
            
            # Store the composite liquidity z-score (positive = more liquid = good)
            # direction=-1 will keep positive values positive (high liquidity = high score = GREEN)
            # negative values stay negative (low liquidity = low score = RED)
            
            # Update series with actual dates and values
            series = [{"date": common_dates[i], "value": smoothed_liquidity[i]} for i in range(len(common_dates))]
            clean_values = series  # All values are valid
            raw_series = smoothed_liquidity.tolist()
            
            # smoothed_liquidity already lives in z-space; avoid double-normalizing.
            normalized_series = direction_adjusted(raw_series, ind.direction)
        elif code == "ANALYST_ANXIETY":
            import numpy as np
            
            # Fetch components for Analyst Confidence composite
            # A. VIX from Yahoo - Weight 0.40
            vix_series = self.yahoo.fetch_series("^VIX", start_date=start_date)
            
            # B. MOVE from Yahoo - Weight 0.25  
            move_series = []
            try:
                move_series = self.yahoo.fetch_series("^MOVE", start_date=start_date)
            except Exception:
                print("Warning: MOVE (^MOVE) not available from Yahoo, using reduced component model")
            
            # C. High Yield OAS from FRED - Weight 0.25
            hy_oas_series = await self.fred.fetch_series("BAMLH0A0HYM2", start_date=start_date)
            
            # D. ERP Proxy (10Y - BBB) - Weight 0.10
            # Use BBB Corporate Yield minus 10Y Treasury as risk premium proxy
            dgs10_series = await self.fred.fetch_series("DGS10", start_date=start_date)
            
            # Try to get BBB corporate yield (BAMLC0A4CBBB)
            bbb_series = []
            try:
                bbb_series = await self.fred.fetch_series("BAMLC0A4CBBB", start_date=start_date)
            except Exception:
                print("Warning: BBB Corporate Yield not available, using reduced component model")
            
            # Convert to dicts for alignment
            def series_to_dict(s):
                return {x["date"]: x["value"] for x in s if x["value"] is not None}
            
            vix_dict = series_to_dict(vix_series)
            move_dict = series_to_dict(move_series) if move_series else {}
            hy_oas_dict = series_to_dict(hy_oas_series)
            dgs10_dict = series_to_dict(dgs10_series)
            bbb_dict = series_to_dict(bbb_series) if bbb_series else {}
            
            # Find dates where core components exist (VIX, HY OAS, DGS10 are required)
            required_dates = set(vix_dict.keys()) & set(hy_oas_dict.keys()) & set(dgs10_dict.keys())
            
            if len(required_dates) < 30:
                db.close()
                raise ValueError(f"Insufficient overlapping data for {code}: only {len(required_dates)} common dates")
            
            # Sort dates
            common_dates = sorted(required_dates)
            
            # Forward fill MOVE and BBB data to align with common dates
            def forward_fill_to_dates(data_dict, target_dates):
                result = {}
                last_value = None
                for date in target_dates:
                    if date in data_dict:
                        last_value = data_dict[date]
                    if last_value is not None:
                        result[date] = last_value
                return result
            
            move_filled = forward_fill_to_dates(move_dict, common_dates) if move_dict else {}
            bbb_filled = forward_fill_to_dates(bbb_dict, common_dates) if bbb_dict else {}
            
            # Extract aligned values
            vix_vals = np.array([vix_dict[d] for d in common_dates])
            hy_oas_vals = np.array([hy_oas_dict[d] for d in common_dates])
            dgs10_vals = np.array([dgs10_dict[d] for d in common_dates])
            
            # Check which optional components are available
            has_move = len(move_filled) == len(common_dates) and all(d in move_filled for d in common_dates)
            has_bbb = len(bbb_filled) == len(common_dates) and all(d in bbb_filled for d in common_dates)
            
            move_vals = np.array([move_filled[d] for d in common_dates]) if has_move else None
            bbb_vals = np.array([bbb_filled[d] for d in common_dates]) if has_bbb else None
            
            # Helper function to compute normalized stress scores with momentum
            def compute_stress_score(vals, use_momentum=True):
                """
                Convert raw values to 0-100 stress scores using z-score normalization.
                Higher values = higher stress.
                Includes momentum component for sensitivity to rapid changes.
                """
                # Compute baseline z-score (lookback 520 days as per spec)
                lookback = min(520, len(vals))
                window = vals[-lookback:]
                mean = np.mean(window)
                std = np.std(window)
                if std == 0:
                    std = 1
                
                z_base = (vals - mean) / std
                
                # Compute momentum z-score (10-day ROC)
                if use_momentum and len(vals) > 10:
                    roc_10d = np.zeros_like(vals)
                    for i in range(10, len(vals)):
                        roc_10d[i] = vals[i] - vals[i-10]
                    
                    roc_mean = np.mean(roc_10d[-lookback:])
                    roc_std = np.std(roc_10d[-lookback:])
                    if roc_std == 0:
                        roc_std = 1
                    z_momentum = (roc_10d - roc_mean) / roc_std
                    
                    # Blend: 75% base, 25% momentum
                    z_blended = 0.75 * z_base + 0.25 * z_momentum
                else:
                    z_blended = z_base
                
                # Clamp to [-3, +3] to avoid outliers
                z_clamped = np.clip(z_blended, -3, 3)
                
                # Map to 0-100 stress scale
                stress = ((z_clamped + 3) / 6) * 100
                
                return stress
            
            # Compute stress scores for each component
            vix_stress = compute_stress_score(vix_vals)
            hy_oas_stress = compute_stress_score(hy_oas_vals)
            
            # Determine weights based on available components
            if has_move and has_bbb:
                # All 4 components available
                move_stress = compute_stress_score(move_vals)
                
                # Compute ERP proxy stress (BBB - 10Y)
                erp_vals = bbb_vals - dgs10_vals
                erp_stress = compute_stress_score(erp_vals)
                
                # Original weights
                weights = {
                    'vix': 0.40,
                    'move': 0.25,
                    'hy_oas': 0.25,
                    'erp': 0.10
                }
                
                composite_stress = (
                    vix_stress * weights['vix'] +
                    move_stress * weights['move'] +
                    hy_oas_stress * weights['hy_oas'] +
                    erp_stress * weights['erp']
                )
            elif has_move:
                # VIX + MOVE + HY OAS (no ERP)
                move_stress = compute_stress_score(move_vals)
                
                # Redistribute 0.10 ERP weight
                weights = {
                    'vix': 0.44,  # 0.40 + 0.04
                    'move': 0.28,  # 0.25 + 0.03
                    'hy_oas': 0.28  # 0.25 + 0.03
                }
                
                composite_stress = (
                    vix_stress * weights['vix'] +
                    move_stress * weights['move'] +
                    hy_oas_stress * weights['hy_oas']
                )
            elif has_bbb:
                # VIX + HY OAS + ERP (no MOVE)
                erp_vals = bbb_vals - dgs10_vals
                erp_stress = compute_stress_score(erp_vals)
                
                # Redistribute 0.25 MOVE weight
                weights = {
                    'vix': 0.55,  # 0.40 + 0.15
                    'hy_oas': 0.35,  # 0.25 + 0.10
                    'erp': 0.10
                }
                
                composite_stress = (
                    vix_stress * weights['vix'] +
                    hy_oas_stress * weights['hy_oas'] +
                    erp_stress * weights['erp']
                )
            else:
                # Only VIX + HY OAS (minimum viable)
                # Redistribute weights
                weights = {
                    'vix': 0.60,  # 0.40 + 0.20
                    'hy_oas': 0.40  # 0.25 + 0.15
                }
                
                composite_stress = (
                    vix_stress * weights['vix'] +
                    hy_oas_stress * weights['hy_oas']
                )
            
            # Convert stress scores (0-100, higher = more anxious) to stability scores
            # Stability = 100 - stress
            composite_stability = 100 - composite_stress
            
            # Store composite stability score
            # With direction=-1 in config, this will be inverted during normalization
            # so that low stability → low final score (RED) and high stability → high final score (GREEN)
            
            # Update series with actual dates and values
            series = [{"date": common_dates[i], "value": composite_stability[i]} for i in range(len(common_dates))]
            clean_values = series
            raw_series = composite_stability.tolist()

            # Composite stability already on 0-100 scale; convert to z-space to avoid re-normalizing.
            score_to_z = lambda score: (score / 100.0) * 4 - 2
            normalized_series = direction_adjusted(
                [score_to_z(val) for val in raw_series],
                ind.direction,
            )
        elif code == "SENTIMENT_COMPOSITE":
            import numpy as np
            from app.services.ingestion.sentiment_sources import compute_staleness_weights
            
            sentiment_sources = await fetch_sentiment_component_series(self.fred, start_date)
            umich_series = sentiment_sources["umich_series"]
            nfib_series = sentiment_sources["business_confidence_series"]
            ism_mfg_series = sentiment_sources["regional_new_orders_series"]
            capex_series = sentiment_sources["capex_series"]
            ism_pmi_series = sentiment_sources.get("ism_pmi_series", [])
            
            # Convert to dicts for alignment
            def series_to_dict(s):
                return {x["date"]: x["value"] for x in s if x["value"] is not None}
            
            umich_dict = series_to_dict(umich_series)
            nfib_dict = series_to_dict(nfib_series) if nfib_series else {}
            ism_dict = series_to_dict(ism_mfg_series) if ism_mfg_series else {}
            capex_dict = series_to_dict(capex_series) if capex_series else {}

            # If ISM PMI New Orders is available and more recent than NEWORDER,
            # use it as a capex supplement.  We normalise the ISM diffusion value
            # into NEWORDER-scale using z-scores of each series, so the graft
            # doesn't introduce a level shift.
            if ism_pmi_series and capex_dict:
                capex_latest = max(capex_dict.keys()) if capex_dict else "1900-01-01"
                for pt in ism_pmi_series:
                    if pt["date"] > capex_latest and pt["value"] is not None:
                        # Convert ISM diffusion → approximate NEWORDER level
                        # ISM range ~30-65, NEWORDER typically ~60k-80k
                        # Use the z-score of ISM mapped to NEWORDER mean/std
                        capex_vals_list = list(capex_dict.values())
                        if capex_vals_list:
                            cap_mean = sum(capex_vals_list) / len(capex_vals_list)
                            cap_std = (sum((v - cap_mean)**2 for v in capex_vals_list) / len(capex_vals_list)) ** 0.5 or 1.0
                            # ISM New Orders long-run mean ~52, std ~6
                            ism_z = (pt["value"] - 52.0) / 6.0
                            synthetic = cap_mean + ism_z * cap_std
                            capex_dict[pt["date"]] = synthetic
                            logger.info(
                                "Grafted ISM PMI New Orders (%.1f → %.0f) onto NEWORDER at %s",
                                pt["value"], synthetic, pt["date"],
                            )

            # Require a solid Michigan history, but build the composite on the
            # union of component release dates so delayed Michigan updates do not
            # block fresher NFIB / orders releases.
            if len(umich_dict) < 12:
                db.close()
                raise ValueError(f"Insufficient Michigan Consumer Sentiment data for {code}")

            common_dates = sorted(
                set(umich_dict.keys())
                | set(nfib_dict.keys())
                | set(ism_dict.keys())
                | set(capex_dict.keys())
            )
            
            # Forward fill optional components
            def forward_fill_to_dates(data_dict, target_dates):
                result = {}
                last_value = None
                for date in target_dates:
                    if date in data_dict:
                        last_value = data_dict[date]
                    if last_value is not None:
                        result[date] = last_value
                return result
            
            umich_filled = forward_fill_to_dates(umich_dict, common_dates)
            nfib_filled = forward_fill_to_dates(nfib_dict, common_dates) if nfib_dict else {}
            ism_filled = forward_fill_to_dates(ism_dict, common_dates) if ism_dict else {}
            capex_filled = forward_fill_to_dates(capex_dict, common_dates) if capex_dict else {}

            common_dates = [date for date in common_dates if date in umich_filled]
            
            # Extract values
            umich_vals = np.array([umich_filled[d] for d in common_dates])
            
            # Check which optional components are available
            has_nfib = len(nfib_filled) == len(common_dates) and all(d in nfib_filled for d in common_dates)
            has_ism = len(ism_filled) == len(common_dates) and all(d in ism_filled for d in common_dates)
            has_capex = len(capex_filled) == len(common_dates) and all(d in capex_filled for d in common_dates)
            
            nfib_vals = np.array([nfib_filled[d] for d in common_dates]) if has_nfib else None
            ism_vals = np.array([ism_filled[d] for d in common_dates]) if has_ism else None
            capex_vals = np.array([capex_filled[d] for d in common_dates]) if has_capex else None
            
            # Helper function to compute confidence scores (higher values = better sentiment)
            def compute_confidence_score(vals):
                """Convert raw values to 0-100 confidence scores using z-score normalization."""
                lookback = min(520, len(vals))
                window = vals[-lookback:]
                mean = np.mean(window)
                std = np.std(window)
                if std == 0:
                    std = 1
                z_vals = (vals - mean) / std
                z_clamped = np.clip(z_vals, -3, 3)
                confidence = ((z_clamped + 3) / 6) * 100
                return confidence
            
            # Compute confidence scores for each component
            umich_conf = compute_confidence_score(umich_vals)
            nfib_conf = compute_confidence_score(nfib_vals) if has_nfib else None
            ism_conf = compute_confidence_score(ism_vals) if has_ism else None
            capex_conf = compute_confidence_score(capex_vals) if has_capex else None
            
            # --- Staleness-aware weighting ---
            # Determine the freshest real observation date for each component
            # (before forward fill) to detect stale data.
            component_latest = {
                "umich": max(umich_dict.keys()) if umich_dict else None,
                "nfib": max(nfib_dict.keys()) if nfib_dict else None,
                "ism": max(ism_dict.keys()) if ism_dict else None,
                "capex": max(capex_dict.keys()) if capex_dict else None,
            }

            # Nominal weights (all-components case)
            nominal = {}
            if has_nfib and has_ism and has_capex:
                nominal = {"umich": 0.30, "nfib": 0.30, "ism": 0.25, "capex": 0.15}
            elif has_nfib and has_ism:
                nominal = {"umich": 0.33, "nfib": 0.33, "ism": 0.34, "capex": 0.0}
            elif has_nfib:
                nominal = {"umich": 0.50, "nfib": 0.50, "ism": 0.0, "capex": 0.0}
            else:
                nominal = {"umich": 1.0, "nfib": 0.0, "ism": 0.0, "capex": 0.0}

            # Compute staleness-adjusted weights using today as reference
            today_key = datetime.utcnow().strftime("%Y-%m-%d")
            weights = compute_staleness_weights(component_latest, nominal, as_of=today_key)
            
            for comp, w in weights.items():
                if w != nominal.get(comp, 0):
                    logger.info(
                        "Sentiment %s weight adjusted: %.2f → %.2f (latest data: %s)",
                        comp, nominal.get(comp, 0), w, component_latest.get(comp),
                    )
            
            # Build composite using adjusted weights
            composite_conf = umich_conf * weights["umich"]
            if has_nfib:
                composite_conf = composite_conf + nfib_conf * weights["nfib"]
            if has_ism:
                composite_conf = composite_conf + ism_conf * weights["ism"]
            if has_capex:
                composite_conf = composite_conf + capex_conf * weights["capex"]
            
            # Store composite confidence score (0-100, higher = better sentiment)
            # With direction=-1 in config, this will be properly normalized
            # High confidence -> high final score (GREEN), low confidence -> low final score (RED)

            # Update series with actual dates and values
            series = [{"date": common_dates[i], "value": composite_conf[i]} for i in range(len(common_dates))]
            clean_values = series
            raw_series = composite_conf.tolist()

            # Composite confidence already on 0-100 scale; convert to z-space to avoid re-normalizing.
            score_to_z = lambda score: (score / 100.0) * 4 - 2
            normalized_series = direction_adjusted(
                [score_to_z(val) for val in raw_series],
                ind.direction,
            )
        elif code == "BREADTH_HEALTH":
            # 3-component breadth composite:
            #   35% RSP/SPY ratio (equal-weight vs cap-weight)
            #   40% sector participation (% of 11 SPDR ETFs above 50-day MA)
            #   25% sector return breadth (% of sectors with positive 20-day return)
            rsp_series = self.yahoo.fetch_series("RSP", start_date=start_date)
            spy_series = self.yahoo.fetch_series("SPY", start_date=start_date)

            def series_to_dict(s):
                return {x["date"]: x["value"] for x in s if x["value"] is not None}

            rsp_dict = series_to_dict(rsp_series)
            spy_dict = series_to_dict(spy_series)
            common_dates = sorted(set(rsp_dict.keys()) & set(spy_dict.keys()))

            if len(common_dates) < 30:
                db.close()
                raise ValueError(f"Insufficient overlapping data for {code}: only {len(common_dates)} common dates")

            ratio_vals = []
            for date in common_dates:
                spy_val = spy_dict.get(date)
                rsp_val = rsp_dict.get(date)
                if spy_val in (None, 0) or rsp_val is None:
                    ratio_vals.append(None)
                else:
                    ratio_vals.append(rsp_val / spy_val)

            series = []
            clean_ratio_vals = []
            clean_dates = []
            for date, ratio in zip(common_dates, ratio_vals):
                if ratio is None:
                    continue
                series.append({"date": date, "value": ratio})
                clean_ratio_vals.append(ratio)
                clean_dates.append(date)

            if len(clean_ratio_vals) < 30:
                db.close()
                raise ValueError(f"Insufficient clean ratio data for {code}: only {len(clean_ratio_vals)} points")

            # Fetch all 11 SPDR sector ETFs for breadth metrics
            sector_price_dicts = {}
            for ticker in SECTOR_TICKERS:
                try:
                    raw = self.yahoo.fetch_series(ticker, start_date=start_date)
                    sector_price_dicts[ticker] = series_to_dict(raw)
                except Exception:
                    pass  # degrade gracefully if a ticker fails

            participation_vals, return_breadth_vals = compute_sector_breadth_series(
                sector_price_dicts, clean_dates
            )

            clean_values = series
            raw_series = clean_ratio_vals

            normalized_series = compute_breadth_composite(
                clean_ratio_vals,
                participation_vals,
                return_breadth_vals,
                lookback=ind.lookback_days_for_z,
                trend_window=30,
                direction=ind.direction,
            )
        elif code == "SECTOR_REGIME_ALIGNMENT":
            # Sector divergence alignment score from the same data basis used by
            # the Sector Divergence dashboard widget (3m projection leadership).
            from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue

            runs = (
                db.query(SectorProjectionRun)
                .order_by(SectorProjectionRun.as_of_date.asc(), SectorProjectionRun.created_at.asc())
                .all()
            )

            alignment_points = []
            for run in runs:
                values_3m = (
                    db.query(SectorProjectionValue)
                    .filter(
                        SectorProjectionValue.run_id == run.id,
                        SectorProjectionValue.horizon == "3m",
                    )
                    .all()
                )

                defensive_scores, cyclical_scores = split_defensive_cyclical_scores(values_3m)

                if not defensive_scores or not cyclical_scores:
                    continue

                defensive_avg = sum(defensive_scores) / len(defensive_scores)
                cyclical_avg = sum(cyclical_scores) / len(cyclical_scores)
                spread = defensive_avg - cyclical_avg
                alignment_score = compute_alignment_score(run.system_state, spread)
                alignment_points.append({"date": run.as_of_date.isoformat(), "value": alignment_score})

            if len(alignment_points) < 20:
                db.close()
                raise ValueError(
                    f"Insufficient sector projection history for {code}: only {len(alignment_points)} points"
                )

            series = alignment_points
            clean_values = series
            raw_series = [point["value"] for point in series]

            # Already a 0-100 stability score; map to z-space before applying direction adjustment.
            score_to_z = lambda score: (score / 100.0) * 4 - 2
            normalized_series = direction_adjusted(
                [score_to_z(val) for val in raw_series],
                ind.direction,
            )
        elif code == "UNRATE":
            # CRITICAL: For UNRATE, we store ABSOLUTE RATE but score based on 6-MONTH CHANGE
            # This captures employment trend deterioration/improvement rather than absolute level
            # Rationale: Market stress comes from unemployment RISING, not the absolute rate
            # Rising unemployment (positive change) = deteriorating conditions = stress
            
            import numpy as np
            
            # Calculate 6-month change (unemployment is monthly data)
            # For monthly data, 6 months = 6 data points, but since we get daily fills, use ~126 days
            lookback_period = min(126, len(raw_series) - 1)  # ~6 months
            
            unemp_change_series = []
            for i in range(len(raw_series)):
                if i < lookback_period:
                    # Not enough history, use shorter lookback
                    lookback_idx = 0
                else:
                    lookback_idx = i - lookback_period
                
                # Change over period (positive = unemployment rising = bad)
                change = raw_series[i] - raw_series[lookback_idx]
                unemp_change_series.append(change)
            
            # Store absolute unemployment rates in database (raw_series unchanged)
            # But normalize based on 6-month change for scoring
            # Positive change = unemployment rising = stress
            # With direction=1, rising unemployment → inverted to low stability score (RED)
            
            normalized_series = normalize_series(
                unemp_change_series,
                direction=ind.direction,
                lookback=ind.lookback_days_for_z,
            )
        elif code == "SPY":
            # CRITICAL: For SPY, we store EMA GAP PERCENTAGE, not absolute price
            # This transforms SPY from price level (e.g., $580.45) to trend strength (e.g., +1.35% above EMA)
            # Rationale: Market stress comes from trend divergence, not absolute price levels
            # Price below EMA = distribution/weakness, Price above EMA = accumulation/strength
            import numpy as np
            
            if len(raw_series) < 50:
                # Not enough data for EMA, fall back to standard normalization
                normalized_series = normalize_series(
                    raw_series,
                    direction=ind.direction,
                    lookback=ind.lookback_days_for_z,
                )
            else:
                # Calculate 50-day EMA for trend baseline
                ema_period = 50
                prices = np.array(raw_series)
                
                # Calculate EMA using exponential weights
                alpha = 2 / (ema_period + 1)
                ema = np.zeros_like(prices)
                ema[0] = prices[0]  # Initialize with first price
                
                for i in range(1, len(prices)):
                    ema[i] = alpha * prices[i] + (1 - alpha) * ema[i-1]
                
                # Calculate percentage gap from EMA
                # Positive gap = price above EMA (bullish strength)
                # Negative gap = price below EMA (bearish weakness/stress)
                gap_pct = ((prices - ema) / ema) * 100
                
                # IMPORTANT: Replace raw_series with gap_pct - this is what gets stored in the database
                raw_series = gap_pct.tolist()
                
                # Normalize the gap percentages
                # Large positive gap = strong uptrend = stability (GREEN)
                # Large negative gap = weak/broken trend = stress (RED)
                # With direction=-1, negative gaps (stress) get lower scores
                normalized_series = normalize_series(
                    gap_pct.tolist(),
                    direction=ind.direction,
                    lookback=ind.lookback_days_for_z,
                )
        else:
            # Standard normalization on raw values
            normalized_series = normalize_series(
                raw_series,
                direction=ind.direction,
                lookback=ind.lookback_days_for_z,
            )

        scores = score_series(normalized_series)
        states = classify_series(
            scores,
            ind.threshold_green_max,
            ind.threshold_yellow_max
        )

        # --- Store to DB ---
        if backfill_days > 0:
            # Store multiple historical data points
            num_points = min(backfill_days, len(clean_values))
            stored_count = 0
            
            for i in range(-num_points, 0):
                date_str = clean_values[i]["date"]
                timestamp = datetime.strptime(date_str, "%Y-%m-%d")
                
                # Check if this timestamp already exists
                existing = db.query(IndicatorValue).filter(
                    IndicatorValue.indicator_id == ind.id,
                    IndicatorValue.timestamp == timestamp
                ).first()
                
                if not existing:
                    entry = IndicatorValue(
                        indicator_id=ind.id,
                        timestamp=timestamp,
                        raw_value=float(raw_series[i]),
                        normalized_value=float(normalized_series[i]),
                        score=float(scores[i]),
                        state=states[i],
                    )
                    db.add(entry)
                    stored_count += 1
            
            db.commit()
            db.close()
            
            latest_date = clean_values[-1]["date"]
            return {
                "indicator": code,
                "date": latest_date,
                "raw": raw_series[-1],
                "score": scores[-1],
                "state": states[-1],
                "backfilled": stored_count
            }
        else:
            # Store only latest data point
            latest_raw = raw_series[-1]
            latest_norm = normalized_series[-1]
            latest_score = scores[-1]
            latest_state = states[-1]
            latest_date = clean_values[-1]["date"]

            latest_timestamp = datetime.strptime(latest_date, "%Y-%m-%d")
            entry = db.query(IndicatorValue).filter(
                IndicatorValue.indicator_id == ind.id,
                IndicatorValue.timestamp == latest_timestamp,
            ).first()

            if entry is None:
                entry = IndicatorValue(
                    indicator_id=ind.id,
                    timestamp=latest_timestamp,
                    raw_value=float(latest_raw),
                    normalized_value=float(latest_norm),
                    score=float(latest_score),
                    state=latest_state,
                )
                db.add(entry)
            else:
                entry.raw_value = float(latest_raw)
                entry.normalized_value = float(latest_norm)
                entry.score = float(latest_score)
                entry.state = latest_state

            ind.last_raw_value = float(latest_raw)
            ind.last_score = float(latest_score)
            ind.last_state = latest_state
            ind.last_updated = latest_timestamp
            db.commit()
            db.close()
            
            return {
                "indicator": code,
                "date": latest_date,
                "raw": latest_raw,
                "score": latest_score,
                "state": latest_state
            }

    async def _ingest_page_input(self, code: str, backfill_days: int = 0):
        db: Session = SessionLocal()

        def parse_timestamp(value: str) -> datetime:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=None)

        try:
            ind: Indicator | None = (
                db.query(Indicator)
                .filter(Indicator.code == code)
                .first()
            )
            if ind is None:
                raise ValueError(f"Indicator {code} not found in DB")

            history_days = max(backfill_days, 365)
            history = get_page_input_history(code, days=history_days)
            latest_point = history[-1] if history else next(
                (item for item in get_page_input_statuses(days=history_days) if item["code"] == code),
                None,
            )

            if latest_point is None or latest_point.get("timestamp") is None:
                raise ValueError(f"No valid page-input data points returned for {code}")

            points_to_store = history[-backfill_days:] if backfill_days > 0 else [latest_point]
            stored_count = 0

            for point in points_to_store:
                timestamp_value = point.get("timestamp")
                score_value = point.get("score")
                raw_value = point.get("raw_value", score_value)
                state_value = point.get("state")

                if timestamp_value is None or score_value is None:
                    continue

                timestamp = parse_timestamp(timestamp_value)
                entry = (
                    db.query(IndicatorValue)
                    .filter(
                        IndicatorValue.indicator_id == ind.id,
                        IndicatorValue.timestamp == timestamp,
                    )
                    .first()
                )

                if entry is None:
                    entry = IndicatorValue(
                        indicator_id=ind.id,
                        timestamp=timestamp,
                        raw_value=float(raw_value),
                        normalized_value=float(score_value),
                        score=float(score_value),
                        state=state_value,
                    )
                    db.add(entry)
                    stored_count += 1
                else:
                    entry.raw_value = float(raw_value)
                    entry.normalized_value = float(score_value)
                    entry.score = float(score_value)
                    entry.state = state_value

            latest_timestamp = parse_timestamp(latest_point["timestamp"])
            latest_raw = float(latest_point.get("raw_value", latest_point["score"]))
            latest_score = float(latest_point["score"])
            latest_state = latest_point.get("state")

            ind.last_raw_value = latest_raw
            ind.last_score = latest_score
            ind.last_state = latest_state
            ind.last_updated = latest_timestamp

            db.commit()

            result = {
                "indicator": code,
                "date": latest_timestamp.date().isoformat(),
                "raw": latest_raw,
                "score": latest_score,
                "state": latest_state,
            }
            if backfill_days > 0:
                result["backfilled"] = stored_count
            return result
        finally:
            db.close()

    async def _ingest_aas(self, backfill_days: int = 0):
        from sqlalchemy import desc, func
        from app.services.ingestion.aas_data_ingestion import run_daily_ingestion
        from app.services.aas_calculator import AASCalculator

        run_daily_ingestion()

        db: Session = SessionLocal()
        try:
            calculator = AASCalculator(db)
            backfilled = 0
            latest_indicator = None

            if backfill_days > 0:
                start = datetime.utcnow().date() - timedelta(days=backfill_days - 1)
                for offset in range(backfill_days):
                    target_date = datetime.combine(start + timedelta(days=offset), datetime.min.time())
                    result = calculator.calculate_for_date(target_date)
                    if result:
                        backfilled += 1
                        latest_indicator = result
            else:
                latest_indicator = calculator.calculate_for_date(datetime.utcnow())

            if not latest_indicator:
                return {"indicator": "AAS", "error": "AAS calculation skipped - insufficient data"}
            aas_indicator_def = db.query(Indicator).filter_by(code="AAS").first()
            indicator_value = None
            if aas_indicator_def:
                indicator_value = (
                    db.query(IndicatorValue)
                    .filter(
                        IndicatorValue.indicator_id == aas_indicator_def.id,
                        func.date(IndicatorValue.timestamp) == latest_indicator.date.date(),
                    )
                    .order_by(desc(IndicatorValue.timestamp))
                    .first()
                )

            return {
                "indicator": "AAS",
                "date": latest_indicator.date.date().isoformat(),
                "raw": indicator_value.raw_value if indicator_value else latest_indicator.pressure_index,
                "score": indicator_value.score if indicator_value else latest_indicator.stability_score,
                "state": indicator_value.state if indicator_value else None,
                **({"backfilled": backfilled} if backfill_days > 0 else {}),
            }
        finally:
            db.close()

    async def ingest_all_indicators(self, backfill_days: int = 0):
        """
        Runs ingest_indicator() on all indicators in the database.
        
        Args:
            backfill_days: If > 0, backfill last N days of history for all indicators
        """
        db: Session = SessionLocal()
        inds = db.query(Indicator).all()
        db.close()

        results = []
        for ind in inds:
            try:
                result = await self.ingest_indicator(ind.code, backfill_days=backfill_days)
                results.append(result)
            except Exception as e:
                results.append({
                    "indicator": ind.code,
                    "error": str(e)
                })

        return results
    
    async def backfill_all_indicators(self, days: int = 365):
        """
        Backfill historical data for all indicators.
        This is a convenience method for initial setup.
        """
        return await self.ingest_all_indicators(backfill_days=days)

    def update_system_status(self):
        """
        Aggregates indicator states into a system-level status.
        (Agent C will replace this logic later.)
        """

        db = SessionLocal()
        indicators = db.query(Indicator).all()
        indicator_map = {ind.id: ind for ind in indicators}
        latest_values = (
            db.query(IndicatorValue)
            .order_by(IndicatorValue.timestamp.desc())
            .all()
        )

        # Use latest record per indicator
        seen = set()
        latest = []
        for v in latest_values:
            if v.indicator_id not in seen:
                latest.append(v)
                seen.add(v.indicator_id)

        red_count = sum(1 for x in latest if x.state == "RED")
        yellow_count = sum(1 for x in latest if x.state == "YELLOW")

        scores_by_code = {}
        weights_by_code = {}
        for value in latest:
            indicator = indicator_map.get(value.indicator_id)
            if not indicator:
                continue
            scores_by_code[indicator.code] = value.score
            weights_by_code[indicator.code] = indicator.weight or 0.0

        composite, _ = compute_weighted_composite(scores_by_code, weights_by_code)
        composite = composite if composite is not None else 50
        if composite >= 70:
            system_state = "GREEN"
        elif composite >= 40:
            system_state = "YELLOW"
        else:
            system_state = "RED"

        entry = SystemStatus(
            timestamp=datetime.utcnow(),
            composite_score=composite,
            state=system_state,
            red_count=red_count,
            yellow_count=yellow_count,
        )

        db.add(entry)
        db.commit()
        db.close()

        # Check for alert conditions after system update
        from app.services.alert_engine import check_alert_conditions
        check_alert_conditions()

        return {
            "system_state": system_state,
            "composite_score": composite,
            "red_count": red_count,
            "yellow_count": yellow_count
        }
