import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.db import Base, engine
from app.models import options_alerts  # noqa: F401
from app.models import option_positions  # noqa: F401
from app.models import update_post  # noqa: F401
from app.models import institutional_flow_event  # noqa: F401
from app.services.schema_patches import ensure_aas_indicator_code, ensure_signal_attribution_columns
from app.api.health import router as health_router
from app.api.status import router as status_router
from app.api.indicators import router as indicators_router
from app.api.alerts import router as alerts_router
from app.api.news import router as news_router
from app.api.dow_theory import router as dow_theory_router
from app.api.market_map import router as market_map_router
from app.api.options_alerts import router as options_alerts_router
from app.api.secret_options import router as secret_options_router
from app.api.precious_metals import router as precious_metals_router
from app.api.crypto import router as crypto_router
from app.api.aas import router as aas_router
from app.api.discord import router as discord_router
from app.api.update_posts import router as update_posts_router
from app.api.actions import router as actions_router
from app.api.institutional_flow import router as institutional_flow_router
from app.api.market_internals import router as market_internals_router

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

# CORS middleware - configurable via environment variable
from app.core.config import settings

allowed_origins = settings.CORS_ORIGINS.split(",") if settings.CORS_ORIGINS != "*" else ["*"]
# Ensure all origins are stripped of whitespace
allowed_origins = [o.strip() for o in allowed_origins]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables
Base.metadata.create_all(bind=engine)
ensure_aas_indicator_code(engine)
ensure_signal_attribution_columns(engine)

# Routers
app.include_router(health_router, prefix="/health", tags=["Health"])
app.include_router(status_router, tags=["Status"])
app.include_router(indicators_router, tags=["Indicators"])
app.include_router(alerts_router, tags=["Alerts"])
# Market news endpoints backed by the cached ticker list.
app.include_router(news_router, tags=["News"])
app.include_router(dow_theory_router, tags=["DowTheory"])
app.include_router(market_map_router, tags=["MarketMap"])
app.include_router(options_alerts_router, tags=["OptionsAlerts"])
app.include_router(secret_options_router, tags=["SecretOptions"])
app.include_router(update_posts_router, tags=["Updates"])
app.include_router(actions_router, tags=["Actions"])

# Sector Projections
from app.api.sector_projection import router as sector_projection_router
app.include_router(sector_projection_router, tags=["SectorProjections"])

# Sector Summary (for dashboard integration)
from app.api.sector_summary import router as sector_summary_router
app.include_router(sector_summary_router, tags=["SectorSummary"])

# Sector Alerts (divergence detection)
from app.api.sector_alerts import router as sector_alerts_router
app.include_router(sector_alerts_router, tags=["SectorAlerts"])

# Stock Projections
from app.api.stock_projection import router as stock_projection_router
app.include_router(stock_projection_router, tags=["StockProjections"])

from app.api.admin import router as admin_router
app.include_router(admin_router, prefix="/admin", tags=["Admin"])

# Precious Metals Diagnostic
app.include_router(precious_metals_router, tags=["PreciousMetals"])

# Crypto Diagnostic
app.include_router(crypto_router, tags=["Crypto"])

# Institutional Flow Proxy (dark-pool style clustered volume levels)
app.include_router(institutional_flow_router, tags=["InstitutionalFlow"])

# Market internals breadth/volume overview
app.include_router(market_internals_router, tags=["MarketInternals"])

# Metal Projections
from app.api.metal_projections import router as metal_projections_router
app.include_router(metal_projections_router, prefix="/precious-metals", tags=["MetalProjections"])

# Alternative Asset Stability indicator
app.include_router(aas_router, tags=["AlternativeAssetStability"])

# Discord Bot Integration
app.include_router(discord_router, tags=["Discord"])
