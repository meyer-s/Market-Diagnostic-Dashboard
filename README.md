# Market Diagnostic Dashboard

A real-time market stability monitoring system that tracks key financial indicators and provides comprehensive market analysis.

## Features

- **Real-time Indicator Monitoring**: Tracks VIX, SPY (via 50-day EMA gap), Federal Funds Rate (DFF via rate-of-change), Treasury Yield Curve (T10Y2Y), and Unemployment Rate (UNRATE)
- **Dow Theory Market Strain Analysis**: Advanced market direction and strain calculations based on Dow Theory principles
- **System Overview Dashboard**: Composite scoring system with historical trends, alert notifications, and purpose description
- **Automated Data Ingestion**: Scheduled ETL pipeline pulling data from FRED API and Yahoo Finance
- **Alert System**: Configurable threshold-based alerting for market condition changes
- **Docker Support**: Full containerized deployment for both Mac (ARM64) and Windows (x86_64)
- **Advanced Technical Analysis**: SPY uses distance from 50-day EMA to capture trend strength and mean reversion dynamics

## Tech Stack

### Backend
- **FastAPI**: Modern Python web framework
- **PostgreSQL**: Production database (SQLite for development)
- **SQLAlchemy**: ORM for database operations
- **APScheduler**: Automated data ingestion scheduling
- **yfinance**: Yahoo Finance data integration
- **FRED API**: Federal Reserve Economic Data integration

### Frontend
- **React 18**: Modern UI framework
- **TypeScript**: Type-safe development
- **Vite**: Fast build tool and dev server
- **TailwindCSS**: Utility-first CSS framework
- **Recharts**: Data visualization library

## Quick Start

### Prerequisites
- Docker and Docker Compose
- (Optional) Python 3.11+ and Node.js 18+ for local development

### Running with Docker

1. Clone the repository:
```bash
git clone <your-repo-url>
cd Market-Diagnostic-Dashboard
```

2. Start all services:
```bash
docker-compose up -d
```

3. Seed the database:
```bash
docker exec market_backend python seed_indicators.py
```

4. Backfill historical data:
```bash
curl -X POST http://localhost:8000/admin/backfill
```

5. Access the application:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Database Admin: http://localhost:8080

### Local Development

#### Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

#### Frontend Setup
```bash
cd frontend
npm install -g pnpm
pnpm install
pnpm dev
```

## Configuration

### Environment Variables

Create `devops/env/backend.env`:
```env
DATABASE_URL=postgresql://market_user:market_pass@db:5432/marketdb
FRED_API_KEY=your_fred_api_key_here
```

Create `devops/env/db.env`:
```env
POSTGRES_USER=market_user
POSTGRES_PASSWORD=market_pass
POSTGRES_DB=marketdb
```

Create `devops/env/frontend.env`:
```env
VITE_API_URL=http://localhost:8000
```

## API Endpoints

### Health & Status
- `GET /health` - Health check
- `GET /system` - System overview with composite score
- `GET /indicators` - List all indicators with current values

### Data Management
- `POST /admin/backfill` - Backfill historical data (365 days)
- `GET /alerts` - Recent alerts (configurable timeframe)
- `POST /alerts/check` - Manually trigger alert condition check

### Market Analysis
- `GET /dow-theory` - Current Dow Theory market metrics
- `GET /dow-theory/history` - Historical market direction trend (90 days)

## Architecture

### Indicator Scoring System
- **Z-Score Normalization**: Rolling 252-day window for statistical normalization
- **Directional Logic**: Configurable interpretation (high=stress vs high=stability)
- **0-100 Scoring**: Normalized scores mapped to intuitive scale
- **State Classification**: RED/YELLOW/GREEN based on configurable thresholds
- **Enhanced Metrics**: 
  - SPY: Uses (Price - 50 EMA) / EMA percentage gap to capture trend strength
  - DFF: Uses rate-of-change instead of absolute level to measure policy velocity

### Data Pipeline
1. **Ingestion**: Automated fetching from FRED and Yahoo Finance
2. **Normalization**: Z-score calculation with directional adjustment
3. **Scoring**: Conversion to 0-100 stability scores
4. **Classification**: State assignment (RED/YELLOW/GREEN)
5. **Storage**: Timestamped storage in PostgreSQL

## Docker Commands

```bash
# View container status
docker-compose ps

# View logs
docker logs market_backend -f
docker logs market_frontend -f
docker logs market_postgres -f

# Restart a service
docker restart market_backend

# Stop all services
docker-compose down

# Rebuild and restart
docker-compose up -d --build

# View all logs
docker-compose logs -f
```

## Development Notes

- Backend runs on port 8000
- Frontend runs on port 5173 (Vite default)
- PostgreSQL runs on port 5432
- Adminer (DB admin) runs on port 8080
- ETL scheduler runs every 4 hours during market hours
- Initial data load happens on application startup

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
