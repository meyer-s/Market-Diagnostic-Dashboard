from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Market Stability Dashboard API"
    DATABASE_URL: str = "sqlite:///./market.db"
    FRED_API_KEY: Optional[str] = None
    CORS_ORIGINS: str = "*"  # Comma-separated origins or * for all
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

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
