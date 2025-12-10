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

# Agent C — clean stubs (will be replaced in Ticket C1)
from app.services.analytics_stub import (
    classify_series,
    normalize_series,
    compute_score,
    compute_state,
    score_series
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
                
                # All three are monthly, align by date
                pce_dict = {x["date"]: x["value"] for x in pce_series if x["value"] is not None}
                cpi_dict = {x["date"]: x["value"] for x in cpi_series if x["value"] is not None}
                pi_dict = {x["date"]: x["value"] for x in pi_series if x["value"] is not None}
                
                # Find common dates
                common_dates = sorted(set(pce_dict.keys()) & set(cpi_dict.keys()) & set(pi_dict.keys()))
                
                # Build aligned series with derived value placeholder
                series = [{"date": date, "value": 0.0} for date in common_dates]
                # Store raw values for later calculation
                pce_raw = [pce_dict[date] for date in common_dates]
                cpi_raw = [cpi_dict[date] for date in common_dates]
                pi_raw = [pi_dict[date] for date in common_dates]
            elif code == "BOND_MARKET_STABILITY":
                # This indicator fetches its data in the processing section below
                # Just create placeholder series for now
                series = [{"date": start_date, "value": 0.0}]
            elif code == "LIQUIDITY_PROXY":
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
            except:
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
            
            # Since we've already computed 0-100 scores, use them directly
            # but still normalize for consistency with system
            normalized_series = normalize_series(
                raw_series,
                direction=ind.direction,
                lookback=ind.lookback_days_for_z,
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
            
            # Calculate M2 YoY% change
            m2_yoy = np.zeros_like(m2_vals)
            # Need at least 252 data points (roughly 1 year of daily data, but these are often weekly/monthly)
            # For monthly data, use 12 months back
            periods_per_year = 12  # Assume monthly data
            for i in range(periods_per_year, len(m2_vals)):
                m2_yoy[i] = ((m2_vals[i] - m2_vals[i - periods_per_year]) / m2_vals[i - periods_per_year]) * 100
            
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
            
            # Store as stress score (0-100, where higher = worse liquidity conditions)
            # High liquidity z-score (good) should map to low stress score
            # Low liquidity z-score (bad) should map to high stress score
            # direction=-1 in indicator config will invert this during normalization
            # so that high stress → low final score (RED) and low stress → high final score (GREEN)
            liquidity_stress = 50 - (liquidity_proxy * 15)  # Scale z-scores to reasonable range
            liquidity_stress = np.clip(liquidity_stress, 0, 100)
            
            # Update series with actual dates and values
            series = [{"date": common_dates[i], "value": liquidity_stress[i]} for i in range(len(common_dates))]
            clean_values = series  # All values are valid
            raw_series = liquidity_stress.tolist()
            
            # Normalize for consistency
            normalized_series = normalize_series(
                raw_series,
                direction=ind.direction,
                lookback=ind.lookback_days_for_z,
            )
        elif code == "DFF":
            # Calculate rate of change (difference between consecutive points)
            # Skip first point since it has no prior reference
            roc_series = []
            for i in range(1, len(raw_series)):
                change = raw_series[i] - raw_series[i-1]
                roc_series.append(change)
            
            # Update clean_values to match roc_series length
            clean_values = clean_values[1:]
            
            # Normalize the rate of change (positive change = rising = stress)
            normalized_series = normalize_series(
                roc_series,
                direction=ind.direction,
                lookback=ind.lookback_days_for_z,
            )
        elif code == "SPY":
            # For SPY, use distance from 50-day EMA as the indicator
            # This captures trend strength and mean reversion better than raw price
            import numpy as np
            
            if len(raw_series) < 50:
                # Not enough data for EMA, fall back to standard normalization
                normalized_series = normalize_series(
                    raw_series,
                    direction=ind.direction,
                    lookback=ind.lookback_days_for_z,
                )
            else:
                # Calculate 50-day EMA
                ema_period = 50
                prices = np.array(raw_series)
                
                # Calculate EMA using exponential weights
                alpha = 2 / (ema_period + 1)
                ema = np.zeros_like(prices)
                ema[0] = prices[0]  # Start with first price
                
                for i in range(1, len(prices)):
                    ema[i] = alpha * prices[i] + (1 - alpha) * ema[i-1]
                
                # Calculate percentage gap from EMA
                # Positive gap = price above EMA (bullish), Negative = below EMA (bearish)
                gap_pct = ((prices - ema) / ema) * 100
                
                # Normalize the gap percentages
                # When gap is large positive (price way above EMA) = GREEN (strong trend)
                # When gap is large negative (price way below EMA) = RED (weak/bearish)
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

        # naive scoring — replaced by Agent C in Sprint 2
        composite = sum(x.score for x in latest) / len(latest) if latest else 50
        if red_count >= 2:
            system_state = "RED"
        elif yellow_count >= 3:
            system_state = "YELLOW"
        else:
            system_state = "GREEN"

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