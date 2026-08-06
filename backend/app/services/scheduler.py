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
from app.services.market_context.agriculture_adapters import refresh_agriculture_report_caches
from app.services.options_alerts import run_options_alert_scan
from app.services.option_trade_reminders import send_due_trade_sell_reminders
from app.services.option_sweep_runs import start_dashboard_sweep
from app.services.option_decision_jobs import (
    refresh_due_option_assessments,
    update_option_learning_outcomes,
)
from app.services.market_diagnostic_runner import run_market_diagnostic
from app.services.sector_projection import (
    compute_sector_projections,
    detect_duplicate_series,
    detect_stale_series,
    fetch_sector_price_history,
    save_sector_projection_run,
)
from app.models.system_status import SystemStatus
from app.utils.db_helpers import get_db_session
from app.services.scheduler_lock import scheduler_job_lock
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
        with scheduler_job_lock("scheduled_etl_job") as acquired:
            if not acquired:
                return
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
            
            # --- News Ingestion ---
            logger.info("📰 Ingesting news articles...")
            try:
                from app.services.news_service import refresh_news_cache
                from app.core.db import SessionLocal as _NewsSessionLocal
                _news_db = _NewsSessionLocal()
                try:
                    news_result = refresh_news_cache(_news_db)
                    logger.info(
                        "✅ News ingestion completed: %d tickers checked, %d new items",
                        news_result.get("tickers_checked", 0),
                        news_result.get("new_items", 0),
                    )
                finally:
                    _news_db.close()
            except Exception as e:
                logger.error(f"❌ News ingestion failed: {e}", exc_info=True)

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
                    run, persisted_warnings = save_sector_projection_run(
                        db,
                        projections,
                        system_state=system_state,
                        source_warnings=warnings,
                        as_of_date=as_of_date,
                    )
                    run_id = run.id
                    quality_status = (run.config_json or {}).get("quality_status", "valid")
                logger.info(
                    "✅ Sector projections computed and stored for %s (run_id=%s, quality=%s, warnings=%s)",
                    as_of_date,
                    run_id,
                    quality_status,
                    len(persisted_warnings),
                )
            else:
                logger.warning("⚠️ No sector projections computed.")
    except Exception as e:
        logger.error(f"❌ ETL job failed: {str(e)}")


async def scheduled_news_refresh_job():
    """Refresh news article cache for all tracked tickers every 2 hours."""
    try:
        with scheduler_job_lock("scheduled_news_refresh_job") as acquired:
            if not acquired:
                return
            logger.info("📰 Starting scheduled news refresh...")
            from app.services.news_service import refresh_news_cache
            from app.core.db import SessionLocal as _NewsSessionLocal
            db = _NewsSessionLocal()
            try:
                result = refresh_news_cache(db)
                logger.info(
                    "✅ News refresh completed: %d tickers checked, %d new items",
                    result.get("tickers_checked", 0),
                    result.get("new_items", 0),
                )
            finally:
                db.close()
    except Exception as exc:
        logger.error("❌ News refresh job failed: %s", exc, exc_info=True)


async def scheduled_agriculture_report_refresh_job():
    """Refresh the expensive agriculture report adapters once per day."""
    try:
        logger.info("🌽 Refreshing agriculture report caches...")
        await asyncio.to_thread(refresh_agriculture_report_caches)
        logger.info("✅ Agriculture report caches refreshed")
    except Exception as exc:
        logger.error("❌ Agriculture report cache refresh failed: %s", exc, exc_info=True)


def scheduled_market_diagnostic_publish_job():
    """Scheduled runner for Market Diagnostic updates."""
    try:
        with scheduler_job_lock("market_diagnostic_publish_job") as acquired:
            if not acquired:
                return
            now_et = datetime.now(ZoneInfo("America/New_York"))
            run_date_utc = datetime.now(timezone.utc).date().isoformat()
            day_of_week = now_et.strftime("%a").upper()
            is_first_friday = day_of_week == "FRI" and now_et.day <= 7
            should_post = day_of_week in {"MON", "THU"} or is_first_friday
            special_event_summary = is_first_friday
            dry_run = not should_post

            logger.info(
                "Market Diagnostic schedule check at %s ET: day=%s should_post=%s dry_run=%s first_friday=%s",
                now_et.isoformat(),
                day_of_week,
                should_post,
                dry_run,
                is_first_friday,
            )

            result = run_market_diagnostic(
                run_date_utc=run_date_utc,
                day_of_week=day_of_week,
                mode="scheduled",
                dry_run=dry_run,
                special_event_summary=special_event_summary,
            )
            logger.info("Market Diagnostic runner completed: ok=%s slug=%s action=%s id=%s", result.ok, result.slug, result.action, result.id)
    except Exception as exc:
        logger.error("Market Diagnostic runner failed: %s", exc, exc_info=True)


def scheduled_option_trade_reminders_job():
    """Send due Discord reminders for scanner-attributed option trades."""
    try:
        with scheduler_job_lock("option_trade_sell_reminders") as acquired:
            if not acquired:
                return
            stats = send_due_trade_sell_reminders()
            logger.info("Option trade sell reminder job completed: %s", stats)
    except Exception as exc:
        logger.error("Option trade sell reminder job failed: %s", exc, exc_info=True)


def scheduled_option_thesis_assessment_job():
    """Refresh due option decision grades without creating orders."""
    try:
        with scheduler_job_lock("option_thesis_assessments") as acquired:
            if not acquired:
                return
            stats = refresh_due_option_assessments()
            logger.info("Option thesis assessment job completed: %s", stats)
    except Exception as exc:
        logger.error("Option thesis assessment job failed: %s", exc, exc_info=True)


def scheduled_option_learning_job():
    """Mature decision horizons and classify newly closed option trades."""
    try:
        with scheduler_job_lock("option_decision_learning") as acquired:
            if not acquired:
                return
            stats = update_option_learning_outcomes()
            logger.info("Option decision learning job completed: %s", stats)
    except Exception as exc:
        logger.error("Option decision learning job failed: %s", exc, exc_info=True)


def scheduled_sp500_option_scanner_job():
    """Start the persisted S&P 500 options scanner on its intraday cadence."""
    try:
        with scheduler_job_lock("scheduled_sp500_option_scanner") as acquired:
            if not acquired:
                return
            threshold = float(os.getenv("SCHEDULED_SP500_SCANNER_THRESHOLD", "30"))
            try:
                run = start_dashboard_sweep(
                    "SP500",
                    threshold,
                    trigger_source="scheduled",
                )
            except RuntimeError as exc:
                logger.info("Scheduled S&P 500 options scan skipped: %s", exc)
                return
            logger.info(
                "Scheduled S&P 500 options scan queued: run_id=%s threshold=%.1f",
                run.get("id"),
                threshold,
            )
    except Exception as exc:
        logger.error("Scheduled S&P 500 options scan failed: %s", exc, exc_info=True)


def start_scheduler():
    """
    Initialize and start the background scheduler.
    
    Schedule:
    - Run every 4 hours during weekdays (market data updates)
    - Skip weekends when markets are closed
    """
    # Run every 4 hours on weekdays (Mon-Fri), 8 AM to 8 PM ET
    if scheduler.get_job("etl_job") is None:
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

    if scheduler.get_job("news_refresh") is None:
        scheduler.add_job(
            scheduled_news_refresh_job,
            CronTrigger(
                day_of_week="mon-fri",
                hour="7-20/2",  # every 2 hours, 7 AM to 8 PM ET
                timezone="America/New_York",
            ),
            id="news_refresh",
            name="News Article Cache Refresh",
            replace_existing=True,
        )

    if scheduler.get_job("agriculture_report_refresh") is None:
        scheduler.add_job(
            scheduled_agriculture_report_refresh_job,
            CronTrigger(
                day_of_week="mon-sun",
                hour=5,
                minute=15,
                timezone="America/New_York",
            ),
            id="agriculture_report_refresh",
            name="Agriculture Report Cache Refresh",
            replace_existing=True,
        )

    if os.getenv("OPTIONS_ALERTS_ENABLED", "false").lower() in {"1", "true", "yes"} and scheduler.get_job("options_alerts") is None:
        scheduler.add_job(
            run_options_alert_scan,
            CronTrigger(minute="*/30", timezone="America/New_York"),
            id="options_alerts",
            name="Options Alert Scan",
            replace_existing=True,
        )

    if scheduler.get_job("option_trade_sell_reminders") is None:
        scheduler.add_job(
            scheduled_option_trade_reminders_job,
            CronTrigger(
                day_of_week="mon-fri",
                hour="9-16",
                minute="5,35",
                timezone="America/New_York",
            ),
            id="option_trade_sell_reminders",
            name="Option Trade Sell Reminders",
            replace_existing=True,
        )

    if scheduler.get_job("option_thesis_assessments") is None:
        scheduler.add_job(
            scheduled_option_thesis_assessment_job,
            CronTrigger(
                day_of_week="mon-fri",
                hour="10,13,16",
                minute=20,
                timezone="America/New_York",
            ),
            id="option_thesis_assessments",
            name="Automatic Option Thesis Assessments",
            replace_existing=True,
        )

    if scheduler.get_job("option_decision_learning") is None:
        scheduler.add_job(
            scheduled_option_learning_job,
            CronTrigger(
                day_of_week="mon-fri",
                hour=18,
                minute=10,
                timezone="America/New_York",
            ),
            id="option_decision_learning",
            name="Option Decision Outcome Learning",
            replace_existing=True,
        )

    if scheduler.get_job("sp500_options_scanner") is None:
        scheduler.add_job(
            scheduled_sp500_option_scanner_job,
            CronTrigger(
                day_of_week="mon-fri",
                hour="10,12,14",
                minute=0,
                timezone="America/New_York",
            ),
            id="sp500_options_scanner",
            name="S&P 500 Options Scanner",
            replace_existing=True,
        )

    # Runs daily at 10:00 AM America/New_York.
    # Posting is gated inside the job to Mon/Thu plus first Friday; non-post days run dry-run checks.
    if scheduler.get_job("market_diagnostic_runner") is None:
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

    if not scheduler.running:
        scheduler.start()
        logger.info("📅 Scheduler started - ETL runs every 4 hours, news refreshes every 2 hours, agriculture caches refresh daily")


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
