from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Market Diagnostic Dashboard API"
    APP_ENV: str = "development"
    DATABASE_URL: str = "sqlite:///./market.db"
    ADMIN_API_KEY: Optional[str] = None
    SECRET_OPTIONS_AUTH_REQUIRED: Optional[bool] = None
    SECRET_OPTIONS_READ_API_KEY: Optional[str] = None
    SECRET_OPTIONS_WRITE_API_KEY: Optional[str] = None
    SECRET_OPTIONS_READ_ACTOR: Optional[str] = None
    SECRET_OPTIONS_WRITE_ACTOR: Optional[str] = None
    # Explicit operator kill-switch for the bounded outcome-learning scanner
    # canary. Evidence is still evaluated when disabled, but it cannot affect
    # the applied candidate order unless an operator deliberately opts in.
    OPTION_LEARNING_CANARY_ENABLED: bool = False
    FRED_API_KEY: Optional[str] = None
    BLS_API_KEY: Optional[str] = None
    EIA_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    MARKET_DIAGNOSTIC_MODEL: Optional[str] = None
    CORS_ORIGINS: str = "*"  # Comma-separated origins or * for all
    RUN_SCHEDULER: bool = False
    COMEX_INVENTORY_URL: Optional[str] = None
    COMEX_INVENTORY_PATH: Optional[str] = None
    COMEX_INVENTORY_GOLD_URL: Optional[str] = None
    COMEX_INVENTORY_GOLD_PATH: Optional[str] = None
    COMEX_INVENTORY_SILVER_URL: Optional[str] = None
    COMEX_INVENTORY_SILVER_PATH: Optional[str] = None
    COMEX_INVENTORY_COPPER_URL: Optional[str] = None
    COMEX_INVENTORY_COPPER_PATH: Optional[str] = None
    COMEX_INVENTORY_PLAT_PALL_URL: Optional[str] = None
    COMEX_INVENTORY_PLAT_PALL_PATH: Optional[str] = None
    COMEX_INVENTORY_PLATINUM_URL: Optional[str] = None
    COMEX_INVENTORY_PLATINUM_PATH: Optional[str] = None
    COMEX_INVENTORY_PALLADIUM_URL: Optional[str] = None
    COMEX_INVENTORY_PALLADIUM_PATH: Optional[str] = None
    COMEX_OPEN_INTEREST_URL: Optional[str] = None
    COMEX_OPEN_INTEREST_PATH: Optional[str] = None
    COMEX_SOURCE: Optional[str] = None
    COMEX_ALLOW_ESTIMATES: Optional[str] = None
    SIFMA_SWAP_URL: Optional[str] = None
    UPDATES_BASE_URL: Optional[str] = None
    UPDATES_PUBLISH_KEY: Optional[str] = None
    GPT_ACTION_PUBLISH_KEY: Optional[str] = None
    GPT_ACTION_RUN_KEY: Optional[str] = None

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
