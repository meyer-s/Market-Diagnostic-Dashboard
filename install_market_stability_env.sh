#!/usr/bin/env bash

echo "==============================================="
echo " Market Stability Dashboard — Mac Setup Script"
echo " Atlas → Steven"
echo "==============================================="

# ---- Check for Homebrew ----
if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found — installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "Homebrew already installed."
fi

echo "Updating Homebrew..."
brew update

# ---- Install Python 3.11 ----
echo "Installing Python 3.11..."
brew install python@3.11

# ---- Install Node + PNPM ----
echo "Installing Node and PNPM..."
brew install node
brew install pnpm

# ---- Install Postgres ----
echo "Installing PostgreSQL..."
brew install postgresql@16
brew services start postgresql@16

# ---- Install Docker ----
echo "Installing Docker Desktop..."
brew install --cask docker

echo "Ensure Docker Desktop is launched at least once to complete setup."

# ---- Install Git ----
brew install git

# ---- Create project directory ----
mkdir -p ~/market-stability-dashboard
cd ~/market-stability-dashboard

# ------------------------------
# BACKEND ENV SETUP (FastAPI)
# ------------------------------
echo "Setting up backend environment..."

mkdir -p backend
cd backend

# Create virtual environment
python3.11 -m venv .venv
source .venv/bin/activate

echo "Installing backend dependencies..."
pip install --upgrade pip

pip install \
    fastapi \
    uvicorn[standard] \
    pydantic \
    pydantic-settings \
    sqlalchemy \
    alembic \
    python-dotenv \
    requests \
    yfinance \
    numpy \
    pandas \
    python-multipart \
    httpx \
    psycopg2-binary

deactivate
cd ..

# ------------------------------
# FRONTEND ENV SETUP (React/Vite)
# ------------------------------
echo "Setting up frontend environment..."

mkdir -p frontend
cd frontend

pnpm create vite@latest . --template react-ts
pnpm install
pnpm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

cd ..

# ------------------------------
# DOCKER / DEVTOOLS
# ------------------------------
echo "Installing additional dev tools..."
brew install \
    jq \
    httpie \
    tree

# ------------------------------
# FINISH
# ------------------------------
echo "==============================================="
echo " Setup complete!"
echo " You are ready to start development."
echo " Next steps:"
echo " 1) open Docker Desktop"
echo " 2) cd backend && source .venv/bin/activate"
echo " 3) cd frontend && pnpm dev"
echo "==============================================="