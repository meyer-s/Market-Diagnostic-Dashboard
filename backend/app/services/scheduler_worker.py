from __future__ import annotations

import asyncio
import logging
import signal

from app.services.scheduler import run_initial_etl, start_scheduler, stop_scheduler

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
    await run_initial_etl()
    start_scheduler()
    await stop_event.wait()
    logger.info("Stopping scheduler worker process...")
    stop_scheduler()


def main() -> None:
    asyncio.run(run_scheduler_worker())


if __name__ == "__main__":
    main()
