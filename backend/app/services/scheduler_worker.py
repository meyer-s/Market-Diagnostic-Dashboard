from __future__ import annotations

import asyncio
import logging
import signal

from app.services.scheduler import run_initial_etl, start_scheduler, stop_scheduler
from app.utils.logging_config import configure_safe_dependency_logging

logger = logging.getLogger(__name__)


async def run_scheduler_worker() -> None:
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    logger.info("Starting scheduler worker process...")
    # Register cron jobs before the startup ETL. External data providers can make
    # that sweep run for several minutes; scheduled decision reviews must not be
    # unavailable during the wait. The ETL advisory lock still prevents overlap
    # if a regular ETL trigger arrives before this startup pass completes.
    start_scheduler()
    try:
        await run_initial_etl()
        await stop_event.wait()
    finally:
        logger.info("Stopping scheduler worker process...")
        stop_scheduler()


def main() -> None:
    configure_safe_dependency_logging()
    asyncio.run(run_scheduler_worker())


if __name__ == "__main__":
    main()
