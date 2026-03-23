# Market Diagnostic Dashboard

A real-time macro and market dashboard that turns rates, liquidity, credit, sentiment, alternative assets, and sector internals into a human-readable market regime view.

🌐 **Live at**: [marketdiagnostictool.com](https://marketdiagnostictool.com)

---

## 📊 System Overview

### Core Market Indicators
- **VIX**: Market volatility and fear gauge
- **SPY**: S&P 500 trend strength (50-day EMA distance)
- **Federal Funds Rate**: Rate-of-change momentum
- **10Y-2Y Treasury Curve**: Yield curve inversion detector
- **Unemployment Rate**: Labor market health
- **Consumer Health**: Composite consumer strength indicator
- **Bond Market Stability**: 4-component weighted (credit, curve, momentum, volatility)
- **Liquidity Proxy**: 3-component z-score (M2, Fed BS, RRP)
- **Analyst Confidence**: Market sentiment gauge
- **Sentiment Composite**: Combined consumer & corporate sentiment

---

## 🚀 Key Features

### Real-Time Monitoring
- **Automated Data Ingestion**: 4-hour ETL pipeline from FRED API & Yahoo Finance
- **365-Day Historical Backfill**: Complete historical context on startup
- **Manual Refresh**: One-click data updates on dashboard
- **Data Freshness Indicators**: Visual status showing last update times

### Advanced Analytics
- **Dow Theory Market Strain**: Direction and strain analysis based on Dow Theory principles
- **System Breakdown**: Weighted methodology view with historical heatmap and live component logic
- **Alternative Assets**: Precious metals and crypto diagnostics inside the AAS framework
- **Market Map**: Visual sector performance heatmap and intraday context
- **Sector & Stock Projections**: Forward-looking sector and single-name analysis
- **Recap Tools**: Published market recap workflow and archive pages

### User Experience
- **Responsive Design**: Mobile-first and production-deployed
- **Market News Integration**: Cached headlines with ticker filtering
- **Indicator Detail Pages**: Historical context, methodology, and chart tooling per signal

---

## 🏗️ Architecture

### Backend (FastAPI + PostgreSQL)
```
backend/
├── app/
│   ├── api/          # REST endpoints
│   ├── models/       # SQLAlchemy models
│   ├── services/     # Business logic (calculators, ingestion)
│   └── utils/        # Helper functions
├── backfill_*.py     # Data backfill scripts
├── fetch_*.py        # Data fetcher scripts
└── complete_aap_components.py  # AAP full implementation
```

### Frontend (React + TypeScript)
```
frontend/
├── src/
│   ├── components/   # Reusable UI components
│   ├── pages/        # Route pages
│   ├── hooks/        # Custom React hooks
│   ├── types/        # TypeScript definitions
│   └── utils/        # Helper functions
```

### Deployment (Docker)
- **Docker Compose**: Orchestrates backend, frontend, and PostgreSQL
- **Multi-arch Support**: Works on Mac ARM64 and x86_64
- **Production Ready**: Nginx reverse proxy, health checks, auto-restart

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Git

### Development Setup
```bash
# Clone repository
git clone https://github.com/meyer-s/Market-Diagnostic-Dashboard.git
cd Market-Diagnostic-Dashboard

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Access dashboard
open http://localhost:3000
```

### Production Deployment
```bash
# On production server
cd ~/Market-Diagnostic-Dashboard
git pull

# Deploy full AAP system (runs all data fetchers + backfills)
./deploy_full_aap.sh

# Or manual deployment
docker-compose up -d --build
docker exec market_backend python seed_indicators.py
docker exec market_backend python complete_aap_components.py
docker exec market_backend python backfill_aap.py
```

---

## 📦 Data Sources

### Primary APIs
- **FRED (Federal Reserve Economic Data)**: Macro indicators, rates, and economic context
- **Yahoo Finance**: Equity and market pricing inputs
- **CoinGecko**: Crypto prices, market caps, and leadership context
- **DeFiLlama**: DeFi TVL and stablecoin supply
- **Additional specialty sources**: COMEX, ETF, central-bank, and metals-specific data feeds

### Data Quality
- ✅ **100% Real Data**: All seed data replaced with live sources
- ✅ **Daily Updates**: Scheduled ingestion every 4 hours
- ✅ **Historical Depth**: 90-365 days depending on indicator
- ✅ **Source Attribution**: All data tagged with origin

---

## 🔧 Key Scripts

### Operational Scripts
- **`seed_indicators.py`**: Initialize 11 core indicators in database
- **`backfill_metals.py`**: Backfill precious metals data
- **`fetch_real_macro.py`**: Fetch macro liquidity data from FRED
- **`fetch_cb_holdings.py`**: Fetch central bank gold holdings
- **`fetch_comex_data.py`**: Estimate COMEX inventory stress
- **`refresh_aap_data.py`**: Master script to refresh all data sources

### Deployment Scripts
- **`deploy_full_aap.sh`**: One-command full system deployment
- Pulls code, runs all data fetchers, backfills historical data

### Maintenance Scripts (in `backend/maintenance_scripts/`)
- One-time use scripts for debugging and development
- Archived documentation in `archive/` folder

---

## 🎯 API Endpoints

### Core Indicators
- `GET /indicators` - List all 11 indicators with current values
- `GET /indicators/{code}` - Detailed indicator data
- `GET /indicators/{code}/history?days=90` - Historical data

### System
- `GET /health` - System health check
- `GET /admin/status` - Detailed system status
- `GET /dow-theory/strain` - Dow Theory analysis
- `GET /precious-metals/regime` - Metals diagnostic

### Sector Analysis
- `GET /sector-projections` - Forward sector analysis
- `GET /stocks/{ticker}/projections` - Individual stock signals
- `GET /sector-alerts` - Active sector alerts

---

## 📊 Frontend Pages

### Main Pages
- `/` - Dashboard with market regime summary and core signal monitoring
- `/indicators` - Indicator library with detail pages and history
- `/system-breakdown` - Methodology, weighting, and historical state distribution
- `/market-map` - Sector performance visualization
- `/news` - Market news with ticker filtering

### Specialized Pages
- `/alternative-assets` - AAS overview plus precious metals and crypto diagnostics
- `/sector-projections` - Sector forward analysis
- `/stock-analysis` - Individual stock projections
- `/tools/recap` - Published recap index and post pages
- `/aap-breakdown` - Full Alternative Asset Stability component breakdown

---

## 🛠️ Development

### Environment Variables
```bash
# Backend (.env or devops/env/backend.env)
DATABASE_URL=postgresql://user:pass@db:5432/market_diagnostic
FRED_API_KEY=your_fred_api_key

# Frontend (devops/env/frontend.env)
VITE_API_URL=http://localhost:8000
```

### Running Tests
```bash
# Backend tests
cd backend
pytest

# Frontend tests
cd frontend
npm test
```

### Database Migrations
```bash
# Create migration
docker exec market_backend alembic revision --autogenerate -m "description"

# Apply migration
docker exec market_backend alembic upgrade head
```

---

## 🤝 Contributing

This is a private project. For questions or issues, contact the development team.

---

## 📄 License

Proprietary - All rights reserved © 2026 Steven J Meyer LLC

---

## 🔗 Links

- **Production**: [marketdiagnostictool.com](https://marketdiagnostictool.com)
- **Repository**: [github.com/meyer-s/Market-Diagnostic-Dashboard](https://github.com/meyer-s/Market-Diagnostic-Dashboard)
- **Documentation**: See `DEPLOYMENT_GUIDE.md` and `AAP_FULL_IMPLEMENTATION.md`

---

## 📝 Version History

### v2.1 (January 2026)
- ✅ Integrated CoinGecko for 365-day crypto historical data
- ✅ Added precious metals diagnostic page
- ✅ Comprehensive system breakdown visualization
- ✅ Removed AAP from main dashboard (moved to specialized section)
- ✅ Improved data freshness indicators

### v2.0 (January 2026)
- ✅ Added Alternative Asset Stability (AAS) indicator
- ✅ Implemented 18-component framework
- ✅ Replaced all seed data with real sources
- ✅ Comprehensive documentation and deployment automation

### v1.0 (Initial Release)
- ✅ 11 core market indicators
- ✅ Real-time dashboard and analytics
- ✅ Docker deployment
- ✅ FRED + Yahoo Finance integration
