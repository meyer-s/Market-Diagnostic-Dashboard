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
        
        if source_upper == "FRED":
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
        # For rate indicators like DFF, score the velocity (change) not the level
        if code == "DFF":
            # Calculate rate of change (difference between consecutive points)
            roc_series = [0.0]  # First point has no prior reference
            for i in range(1, len(raw_series)):
                change = raw_series[i] - raw_series[i-1]
                roc_series.append(change)
            
            # Normalize the rate of change (positive change = rising = stress)
            normalized_series = normalize_series(
                roc_series,
                direction=ind.direction,
                lookback=ind.lookback_days_for_z,
            )
        elif code in ("PCE", "PI"):
            # For consumer indicators, use month-over-month percentage change
            # This captures growth/contraction better than absolute levels
            mom_pct = [0.0]  # First point has no prior reference
            for i in range(1, len(raw_series)):
                if raw_series[i-1] != 0:
                    pct_change = ((raw_series[i] - raw_series[i-1]) / raw_series[i-1]) * 100
                    mom_pct.append(pct_change)
                else:
                    mom_pct.append(0.0)
            
            # Normalize MoM% changes
            # Positive growth = healthy consumer = stability (direction -1)
            # Negative growth = contracting consumer = stress
            normalized_series = normalize_series(
                mom_pct,
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