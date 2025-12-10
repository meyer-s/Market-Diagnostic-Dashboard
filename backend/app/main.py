import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.db import Base, engine
from app.api.health import router as health_router
from app.api.status import router as status_router
from app.api.indicators import router as indicators_router
from app.api.alerts import router as alerts_router
from app.api.dow_theory import router as dow_theory_router

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.
    - On startup: Run initial ETL and start scheduler
    - On shutdown: Stop scheduler gracefully
    """
    from app.services.scheduler import start_scheduler, stop_scheduler, run_initial_etl
    
    # Startup
    logging.info("🚀 Application starting up...")
    
    # Run initial ETL to get fresh data immediately
    asyncio.create_task(run_initial_etl())
    
    # Start the background scheduler
    start_scheduler()
    
    yield
    
    # Shutdown
    logging.info("🛑 Application shutting down...")
    stop_scheduler()


app = FastAPI(
    title="Market Stability Dashboard API",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://96.232.170.38:5173",  # External access
        "*"  # Allow all origins for external sharing (remove in production)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables
Base.metadata.create_all(bind=engine)

# Routers
app.include_router(health_router, prefix="/health", tags=["Health"])
app.include_router(status_router, tags=["Status"])
app.include_router(indicators_router, tags=["Indicators"])
app.include_router(alerts_router, tags=["Alerts"])
app.include_router(dow_theory_router, tags=["DowTheory"])

from app.api.admin import router as admin_router
app.include_router(admin_router, prefix="/admin", tags=["Admin"])
