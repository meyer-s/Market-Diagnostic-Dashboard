from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Market Stability Dashboard API"
    DATABASE_URL: str = "sqlite:///./market.db"
    FRED_API_KEY: Optional[str] = None

    model_config = {"extra": "allow", "env_file": ".env"}

settings = Settings()