"""
ETL Runner
Atlas → Agent A

Pulls indicator data from FRED or Yahoo, normalizes, scores, and stores into DB.
This is the backbone of the daily ingestion cycle.

Supports:
- ingest_indicator(code)
- ingest_all_indicators()
"""

from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.indicator import Indicator
from app.models.indicator_value import IndicatorValue
from app.models.system_status import SystemStatus

from app.services.ingestion.fred_client import FredClient
from app.services.ingestion.yahoo_client import YahooClient
from app.services.ingestion.breadth_utils import compute_breadth_composite_z
from app.utils.system_scoring import compute_weighted_composite

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

        if code == "AAP":
            db.close()
            return await self._ingest_aap(backfill_days)

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
            
            # Consumer Health = Average of (PCE growth - CPI growth) and (PI growth - CPI growth)
            # This avoids double-weighting CPI
            # Positive = spending and income outpacing inflation (healthy)
            # Negative = inflation outpacing spending/income (consumer squeeze)
            consumer_health = []
            for i in range(len(pce_mom)):
                pce_spread = pce_mom[i] - cpi_mom[i]
                pi_spread = pi_mom[i] - cpi_mom[i]
                health = (pce_spread + pi_spread) / 2
                consumer_health.append(health)
            
            # Update raw_series with the derived consumer health values
            raw_series = consumer_health
            
            # Normalize the consumer health metric
            # Positive values = healthy consumer (spending/income > inflation)
            # Negative values = consumer stress (inflation > spending/income)
            normalized_series = normalize_series(
                consumer_health,
                direction=ind.direction,
                lookback=ind.lookback_days_for_z,
            )
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
            
            # Fetch components for Consumer & Corporate Sentiment
            # A. University of Michigan Consumer Sentiment - Weight 0.30
            umich_series = await self.fred.fetch_series("UMCSENT", start_date=start_date)
            
            # B. NFIB Small Business Optimism - Weight 0.30
            # FRED symbol: BOPTTOTM (Total Index) or use proxy
            nfib_series = []
            try:
                nfib_series = await self.fred.fetch_series("BOPTEXP", start_date=start_date)  # Expectations component
            except Exception:
                print("Warning: NFIB (BOPTEXP) not available, trying alternative")
                try:
                    nfib_series = await self.fred.fetch_series("BOPTTOTM", start_date=start_date)
                except Exception:
                    print("Warning: NFIB not available, using reduced component model")
            
            # C. ISM New Orders (Manufacturing) - Weight 0.25
            ism_mfg_series = []
            try:
                ism_mfg_series = await self.fred.fetch_series("NEWORDER", start_date=start_date)
            except Exception:
                print("Warning: ISM Manufacturing New Orders (NEWORDER) not available")
            
            # D. CapEx Proxy (Nondefense Capital Goods ex-Aircraft) - Weight 0.15
            capex_series = []
            try:
                capex_series = await self.fred.fetch_series("ACOGNO", start_date=start_date)
            except Exception:
                print("Warning: CapEx proxy (ACOGNO) not available")
            
            # Convert to dicts for alignment
            def series_to_dict(s):
                return {x["date"]: x["value"] for x in s if x["value"] is not None}
            
            umich_dict = series_to_dict(umich_series)
            nfib_dict = series_to_dict(nfib_series) if nfib_series else {}
            ism_dict = series_to_dict(ism_mfg_series) if ism_mfg_series else {}
            capex_dict = series_to_dict(capex_series) if capex_series else {}
            
            # Find dates where Michigan sentiment exists (required component)
            # Monthly data, so need at least 12 months (not 30 days)
            if len(umich_dict) < 12:
                db.close()
                raise ValueError(f"Insufficient Michigan Consumer Sentiment data for {code}")
            
            required_dates = set(umich_dict.keys())
            common_dates = sorted(required_dates)
            
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
            
            nfib_filled = forward_fill_to_dates(nfib_dict, common_dates) if nfib_dict else {}
            ism_filled = forward_fill_to_dates(ism_dict, common_dates) if ism_dict else {}
            capex_filled = forward_fill_to_dates(capex_dict, common_dates) if capex_dict else {}
            
            # Extract values
            umich_vals = np.array([umich_dict[d] for d in common_dates])
            
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
            
            # Determine weights based on available components
            if has_nfib and has_ism and has_capex:
                # All components available
                weights = {
                    'umich': 0.30,
                    'nfib': 0.30,
                    'ism': 0.25,
                    'capex': 0.15
                }
                composite_conf = (
                    umich_conf * weights['umich'] +
                    nfib_conf * weights['nfib'] +
                    ism_conf * weights['ism'] +
                    capex_conf * weights['capex']
                )
            elif has_nfib and has_ism:
                # No CapEx
                weights = {
                    'umich': 0.33,
                    'nfib': 0.33,
                    'ism': 0.34,
                    'capex': 0.00
                }
                composite_conf = (
                    umich_conf * weights['umich'] +
                    nfib_conf * weights['nfib'] +
                    ism_conf * weights['ism']
                )
            elif has_nfib:
                # Only Michigan + NFIB
                weights = {
                    'umich': 0.50,
                    'nfib': 0.50,
                    'ism': 0.00,
                    'capex': 0.00
                }
                composite_conf = (
                    umich_conf * weights['umich'] +
                    nfib_conf * weights['nfib']
                )
            else:
                # Only Michigan (minimum)
                weights = {
                    'umich': 1.00,
                    'nfib': 0.00,
                    'ism': 0.00,
                    'capex': 0.00
                }
                composite_conf = umich_conf
            
            # Store composite confidence score (0-100, higher = better sentiment)
            # With direction=-1 in config, this will be properly normalized
            # High confidence -> high final score (GREEN), low confidence -> low final score (RED)

            # Carry forward the latest monthly sentiment reading to "today"
            # so dashboard freshness reflects current known state between releases.
            today_key = datetime.utcnow().strftime("%Y-%m-%d")
            if common_dates and common_dates[-1] < today_key:
                common_dates.append(today_key)
                composite_conf = np.append(composite_conf, composite_conf[-1])
            
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
            # Breadth proxy: equal-weight vs cap-weight relative strength (RSP/SPY)
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
            for date, ratio in zip(common_dates, ratio_vals):
                if ratio is None:
                    continue
                series.append({"date": date, "value": ratio})
                clean_ratio_vals.append(ratio)

            if len(clean_ratio_vals) < 30:
                db.close()
                raise ValueError(f"Insufficient clean ratio data for {code}: only {len(clean_ratio_vals)} points")

            clean_values = series
            raw_series = clean_ratio_vals

            normalized_series = compute_breadth_composite_z(
                clean_ratio_vals,
                lookback=ind.lookback_days_for_z,
                trend_window=30,
                level_weight=0.65,
                trend_weight=0.35,
                direction=ind.direction,
            )
        elif code == "DFF":
            # CRITICAL: For DFF, we store the ABSOLUTE RATE but score based on 6-MONTH RATE CHANGE
            # This captures the policy cycle (tightening vs easing) rather than day-to-day noise
            # Rationale: Market stress comes from sustained rate changes, not daily fluctuations
            
            import numpy as np
            
            # Calculate 6-month (126 trading days) cumulative rate change
            lookback_period = 126  # ~6 months of trading days
            rate_change_series = []
            
            for i in range(len(raw_series)):
                if i < lookback_period:
                    # Not enough history, use shorter lookback
                    lookback_idx = 0
                else:
                    lookback_idx = i - lookback_period
                
                # Cumulative change over period
                rate_change = raw_series[i] - raw_series[lookback_idx]
                rate_change_series.append(rate_change)
            
            # Store absolute rates in database (raw_series unchanged)
            # But normalize based on 6-month rate change for scoring
            # Positive change = rates rising = tightening = stress
            # With direction=1, rising rates → negative z-score (after inversion) → low stability score (RED)
            # Falling rates → positive z-score → high stability score (GREEN)
            
            normalized_series = normalize_series(
                rate_change_series,
                direction=ind.direction,
                lookback=ind.lookback_days_for_z,
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
            
            entry = IndicatorValue(
                indicator_id=ind.id,
                timestamp=datetime.strptime(latest_date, "%Y-%m-%d"),
                raw_value=float(latest_raw),
                normalized_value=float(latest_norm),
                score=float(latest_score),
                state=latest_state,
            )

            db.add(entry)
            db.commit()
            db.close()
            
            return {
                "indicator": code,
                "date": latest_date,
                "raw": latest_raw,
                "score": latest_score,
                "state": latest_state
            }

    async def _ingest_aap(self, backfill_days: int = 0):
        from sqlalchemy import desc, func
        from app.services.ingestion.aap_data_ingestion import run_daily_ingestion
        from app.services.aap_calculator import AAPCalculator

        run_daily_ingestion()

        db: Session = SessionLocal()
        try:
            calculator = AAPCalculator(db)
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
                return {"indicator": "AAP", "error": "AAP calculation skipped - insufficient data"}

            aap_indicator_def = db.query(Indicator).filter_by(code="AAP").first()
            indicator_value = None
            if aap_indicator_def:
                indicator_value = (
                    db.query(IndicatorValue)
                    .filter(
                        IndicatorValue.indicator_id == aap_indicator_def.id,
                        func.date(IndicatorValue.timestamp) == latest_indicator.date.date(),
                    )
                    .order_by(desc(IndicatorValue.timestamp))
                    .first()
                )

            return {
                "indicator": "AAP",
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
