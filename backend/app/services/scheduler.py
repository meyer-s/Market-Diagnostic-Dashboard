"""
Background Scheduler for ETL Jobs

Automatically refreshes indicator data at regular intervals.
"""

import asyncio
import logging
import os
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services.ingestion.etl_runner import ETLRunner
from app.services.options_alerts import run_options_alert_scan
from app.services.market_diagnostic_runner import run_market_diagnostic
from app.services.sector_projection import (
    compute_sector_projections,
    detect_duplicate_series,
    detect_stale_series,
    fetch_sector_price_history,
    MODEL_VERSION,
    WEIGHTS,
)
from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue
from app.models.system_status import SystemStatus
from app.utils.db_helpers import get_db_session
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()
etl = ETLRunner()


async def scheduled_etl_job():
    """
    Background task that ingests all indicators, updates system status, and computes sector projections.
    Runs on a schedule (default: every 4 hours during market hours).
    """
    try:
        logger.info("🔄 Starting scheduled ETL job...")
        results = await etl.ingest_all_indicators()
        status = etl.update_system_status()
        success_count = sum(1 for r in results if "error" not in r)
        error_count = len(results) - success_count
        logger.info(
            f"✅ ETL job completed: {success_count} success, "
            f"{error_count} errors. System state: {status['system_state']}"
        )
        
        # --- AAS Data Ingestion ---
        logger.info("📊 Ingesting AAS data (crypto & macro)...")
        try:
            from app.services.ingestion.aas_data_ingestion import run_daily_ingestion
            run_daily_ingestion()
            logger.info("✅ AAS data ingestion completed")
        except Exception as e:
            logger.error(f"❌ AAS data ingestion failed: {e}", exc_info=True)
        
        # --- Precious Metals Ingestion ---
        logger.info("?? Ingesting precious metals data...")
        try:
            from app.services.ingestion.precious_metals_ingester import (
                ingest_precious_metals_daily,
                ingest_precious_metals_weekly,
                ingest_precious_metals_monthly,
            )
            daily_results = ingest_precious_metals_daily()
            weekly_results = ingest_precious_metals_weekly()
            monthly_results = ingest_precious_metals_monthly()
            logger.info(
                "? Precious metals ingestion completed (daily=%s, weekly=%s, monthly=%s)",
                daily_results,
                weekly_results,
                monthly_results,
            )
        except Exception as e:
            logger.error(f"? Precious metals ingestion failed: {e}", exc_info=True)

        # --- AAS Calculation ---
        logger.info("🎯 Calculating AAS indicator...")
        try:
            from app.services.aas_calculator import AASCalculator
            from app.core.db import SessionLocal
            db = SessionLocal()
            try:
                calculator = AASCalculator(db)
                aas_result = calculator.calculate_for_date(datetime.utcnow())
                if aas_result:
                    logger.info(f"✅ AAS calculated: Score={aas_result.stability_score:.1f}, Regime={aas_result.regime}")
                else:
                    logger.warning("⚠️ AAS calculation skipped - insufficient data")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"❌ AAS calculation failed: {e}", exc_info=True)
        
        # --- Sector Projections ---
        logger.info("🔮 Computing sector projections...")
        # Get system state
        system_state = status["system_state"] if status and "system_state" in status else "YELLOW"
        price_data = fetch_sector_price_history()
        duplicates = detect_duplicate_series(price_data)
        stale = detect_stale_series(price_data)
        warnings = []
        if duplicates:
            warnings.append({"type": "duplicate_series", "details": duplicates})
        if stale:
            warnings.append({"type": "stale_series", "details": stale})
        if duplicates:
            logger.error(
                "❌ Duplicate sector price series detected; skipping projection storage."
            )
            return
        projections = compute_sector_projections(price_data, system_state=system_state)
        if projections:
            as_of_date = datetime.utcnow().date()
            with get_db_session() as db:
                prev_run = (
                    db.query(SectorProjectionRun)
                    .order_by(SectorProjectionRun.created_at.desc())
                    .first()
                )
                prev_cache = None
                if prev_run:
                    prev_values = (
                        db.query(SectorProjectionValue)
                        .filter_by(run_id=prev_run.id)
                        .all()
                    )
                    prev_cache = {
                        "run_id": prev_run.id,
                        "as_of_date": str(prev_run.as_of_date),
                        "created_at": prev_run.created_at.isoformat(),
                        "system_state": prev_run.system_state,
                        "model_version": prev_run.model_version,
                        "values": [
                            {
                                "horizon": v.horizon,
                                "sector_symbol": v.sector_symbol,
                                "sector_name": v.sector_name,
                                "score_total": v.score_total,
                                "rank": v.rank,
                            }
                            for v in prev_values
                        ],
                    }

                run = SectorProjectionRun(
                    as_of_date=as_of_date,
                    created_at=datetime.utcnow(),
                    system_state=system_state,
                    model_version=MODEL_VERSION,
                    config_json={
                        "weights": WEIGHTS,
                        "data_warnings": warnings,
                        "previous_run_cache": prev_cache,
                    },
                )
                db.add(run)
                db.flush()
                for p in projections:
                    db.add(SectorProjectionValue(
                        run_id=run.id,
                        horizon=p["horizon"],
                        sector_symbol=p["sector_symbol"],
                        sector_name=p["sector_name"],
                        score_total=p["score_total"],
                        score_trend=p["score_trend"],
                        score_rel=p["score_rel"],
                        score_risk=p["score_risk"],
                        score_regime=p["score_regime"],
                        metrics_json=p["metrics"],
                        rank=p["rank"],
                    ))
                db.commit()
            logger.info(f"✅ Sector projections computed and stored for {as_of_date}")
        else:
            logger.warning("⚠️ No sector projections computed.")
    except Exception as e:
        logger.error(f"❌ ETL job failed: {str(e)}")


def scheduled_market_diagnostic_publish_job():
    """Scheduled runner for Market Diagnostic updates."""
    try:
        now_et = datetime.now(ZoneInfo("America/New_York"))
        run_date_utc = datetime.now(timezone.utc).date().isoformat()
        day_of_week = now_et.strftime("%a").upper()
        should_post = day_of_week in {"MON", "THU"}
        dry_run = not should_post

        logger.info(
            "Market Diagnostic schedule check at %s ET: day=%s should_post=%s dry_run=%s",
            now_et.isoformat(),
            day_of_week,
            should_post,
            dry_run,
        )

        result = run_market_diagnostic(
            run_date_utc=run_date_utc,
            day_of_week=day_of_week,
            mode="scheduled",
            dry_run=dry_run,
        )
        logger.info("Market Diagnostic runner completed: ok=%s slug=%s action=%s id=%s", result.ok, result.slug, result.action, result.id)
    except Exception as exc:
        logger.error("Market Diagnostic runner failed: %s", exc, exc_info=True)


def start_scheduler():
    """
    Initialize and start the background scheduler.
    
    Schedule:
    - Run every 4 hours during weekdays (market data updates)
    - Skip weekends when markets are closed
    """
    # Run every 4 hours on weekdays (Mon-Fri), 8 AM to 8 PM ET
    scheduler.add_job(
        scheduled_etl_job,
        CronTrigger(
            day_of_week="mon-fri",
            hour="8-20/4",  # 8 AM, 12 PM, 4 PM, 8 PM
            timezone="America/New_York"
        ),
        id="etl_job",
        name="Indicator Data Ingestion",
        replace_existing=True,
    )

    if os.getenv("OPTIONS_ALERTS_ENABLED", "false").lower() in {"1", "true", "yes"}:
        scheduler.add_job(
            run_options_alert_scan,
            CronTrigger(minute="*/30", timezone="America/New_York"),
            id="options_alerts",
            name="Options Alert Scan",
            replace_existing=True,
        )

    # Runs daily at 10:00 AM America/New_York.
    # Posting is gated inside the job to Mon/Thu; non-post days run dry-run checks.
    scheduler.add_job(
        scheduled_market_diagnostic_publish_job,
        CronTrigger(
            day_of_week="mon-sun",
            hour=10,
            minute=0,
            timezone="America/New_York",
        ),
        id="market_diagnostic_runner",
        name="Market Diagnostic Runner",
        replace_existing=True,
    )
    
    scheduler.start()
    logger.info("📅 Scheduler started - ETL will run every 4 hours during market hours")


def stop_scheduler():
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("🛑 Scheduler stopped")


async def run_initial_etl():
    """
    Run ETL immediately on startup to ensure fresh data.
    This ensures the dashboard has current data even if the scheduled job hasn't run yet.
    """
    logger.info("🚀 Running initial ETL on startup...")
    await scheduled_etl_job()
