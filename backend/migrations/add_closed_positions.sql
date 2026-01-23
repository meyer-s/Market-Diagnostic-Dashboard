-- Add closed_positions table to track P/L history
CREATE TABLE IF NOT EXISTS closed_position (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR NOT NULL,
    option_type VARCHAR NOT NULL,
    strike FLOAT NOT NULL,
    expiration DATE NOT NULL,
    contracts INTEGER NOT NULL,
    trade_date DATE NOT NULL,
    fill_price FLOAT NOT NULL,
    total_cost FLOAT NOT NULL,
    underlying_at_entry FLOAT,
    close_date DATE NOT NULL,
    exit_price FLOAT NOT NULL,
    total_proceeds FLOAT NOT NULL,
    underlying_at_exit FLOAT,
    dollar_pnl FLOAT NOT NULL,
    percent_pnl FLOAT NOT NULL,
    account VARCHAR,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_closed_position_symbol ON closed_position(symbol);
CREATE INDEX IF NOT EXISTS idx_closed_position_close_date ON closed_position(close_date);
