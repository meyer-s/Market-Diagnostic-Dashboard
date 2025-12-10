"""
Background Scheduler for ETL Jobs

Automatically refreshes indicator data at regular intervals.
"""

import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app.services.ingestion.etl_runner import ETLRunner

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()
etl = ETLRunner()


async def scheduled_etl_job():
    """
    Background task that ingests all indicators and updates system status.
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
    except Exception as e:
        logger.error(f"❌ ETL job failed: {str(e)}")


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
