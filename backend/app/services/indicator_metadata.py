"""
Indicator metadata and descriptions
"""

INDICATOR_METADATA = {
    "VIX": {
        "name": "CBOE Volatility Index (VIX)",
        "description": "The VIX measures the stock market's expectation of volatility based on S&P 500 index options. Often called the 'fear gauge', it indicates market anxiety and uncertainty.",
        "relevance": "Higher VIX values signal increased market stress and investor fear. A rising VIX often precedes or accompanies market downturns, while low VIX suggests complacency.",
        "scoring": "Direction: +1 (high = stress). Z-score normalized with 252-day lookback. Scores 0-100 where lower scores indicate higher market stress.",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "High VIX = Market Fear/Stress (BAD). Low VIX = Market Calm (GOOD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "VIX typically ranges from 10-20 in calm markets, 20-30 during uncertainty, and 30+ during crisis periods.",
        "impact": "Critical early warning indicator. Elevated VIX (RED state) signals imminent market volatility and potential corrections."
    },
    
    "DFF": {
        "name": "Federal Funds Effective Rate",
        "description": "The Federal Funds Rate is the interest rate at which depository institutions lend reserve balances to other institutions overnight. It's the primary tool the Federal Reserve uses to implement monetary policy.",
        "relevance": "The Fed Funds Rate directly influences all other interest rates in the economy, affecting borrowing costs for consumers and businesses. Rapid rate increases can stress financial markets and slow economic growth.",
        "scoring": "Direction: +1 (high = stress). Scored on RATE OF CHANGE: rising rates = tightening = stress, falling rates = easing = stability. The velocity of change matters more than absolute level.",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "Rising rates = Tightening Policy/Stress (BAD). Falling rates = Easing Policy (GOOD).",
        "use_rate_of_change": True,
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Near-zero during easing (0-0.25%). Neutral: 2-3%. Restrictive: 4%+. Crisis response involves rapid cuts.",
        "impact": "Very high impact. Rate changes affect mortgage rates, corporate borrowing, stock valuations, and economic activity. Aggressive hiking cycles (RED) increase recession risk."
    },
    
    "SPY": {
        "name": "S&P 500 ETF (SPY)",
        "description": "SPY tracks the S&P 500 index, representing the 500 largest U.S. companies. It serves as the primary benchmark for U.S. equity market performance and overall economic health.",
        "relevance": "Declining stock prices reflect deteriorating corporate earnings expectations, weakening economic outlook, or flight to safety. Sustained downtrends often coincide with recessions.",
        "scoring": "Direction: -1 (low = stress). Falling prices indicate stress. Z-score normalized with prices inverted so lower values produce lower stability scores.",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "High SPY = Bull Market/Strength (GOOD). Low SPY = Bear Market/Weakness (BAD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Bull market: steady gains with <10% pullbacks. Correction: 10-20% decline. Bear market: 20%+ decline. Crisis: 30%+ decline.",
        "impact": "Very high impact. Equity market weakness affects investor confidence, retirement accounts, consumer spending (wealth effect), and corporate investment decisions. Sustained RED state signals serious market stress."
    },
    
    "DXY": {
        "name": "U.S. Dollar Index (DXY)",
        "description": "The DXY measures the value of the U.S. dollar against a basket of major foreign currencies including the euro, yen, and pound sterling.",
        "relevance": "A strong dollar can pressure emerging markets, commodities, and U.S. exporters. Extreme dollar strength may indicate global capital flight to safety.",
        "scoring": "Direction: +1 (high = stress). Rapid dollar appreciation signals risk-off behavior and potential stress in global financial markets.",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "High DXY = Extreme Strength/Risk-off (BAD). Moderate DXY = Balanced (GOOD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "DXY normally ranges 90-105. Levels above 110 indicate extreme dollar strength and potential market stress.",
        "impact": "Moderate to high impact. Extreme dollar moves can trigger currency crises and affect global liquidity conditions."
    },
    
    "UNRATE": {
        "name": "U.S. Unemployment Rate",
        "description": "The unemployment rate measures the percentage of the labor force that is jobless and actively seeking employment. Published monthly by the Bureau of Labor Statistics.",
        "relevance": "Rising unemployment signals economic deterioration and reduced consumer spending power. Sharp increases often accompany or precede recessions.",
        "scoring": "Direction: +1 (high = stress). Elevated unemployment indicates economic weakness. Scores normalize based on historical ranges.",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "High unemployment = Weak Economy (BAD). Low unemployment = Strong Economy (GOOD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Healthy economy: 3.5-5%. Elevated stress: 5-7%. Crisis levels: 7%+",
        "impact": "High impact on consumer confidence and spending. Rising unemployment is a key recession indicator that affects market sentiment and Fed policy."
    },
    
    "T10Y2Y": {
        "name": "10-Year minus 2-Year Treasury Spread",
        "description": "The yield curve spread between 10-year and 2-year U.S. Treasury notes. A key predictor of economic conditions and recessions.",
        "relevance": "An inverted yield curve (negative spread) has preceded every U.S. recession since 1950. It signals expectations of economic slowdown and Fed rate cuts.",
        "scoring": "Direction: -1 (low/negative = stress). Inversion indicates stress. Lower scores reflect greater inversion and higher recession risk.",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "Positive spread = Normal Curve/Growth (GOOD). Negative spread = Inverted/Recession Signal (BAD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Healthy: +0.5% to +2%. Warning: 0% to -0.5%. Crisis: -0.5% or lower",
        "impact": "Very high impact. The most reliable recession predictor. Sustained inversion (RED state) signals elevated recession probability within 12-24 months."
    },
    
    "TEDRATE": {
        "name": "TED Spread",
        "description": "The difference between 3-month LIBOR and 3-month U.S. Treasury bill rates. Measures perceived credit risk in the banking system.",
        "relevance": "Widening TED spread indicates banks are unwilling to lend to each other, signaling credit market stress and systemic risk.",
        "scoring": "Direction: +1 (high = stress). Elevated spreads indicate banking sector stress and liquidity concerns.",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "High TED = Credit Stress/Banking Fear (BAD). Low TED = Normal Lending (GOOD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Normal: 10-30 basis points. Elevated: 50-100 bps. Crisis: 200+ bps (2008 reached 450 bps)",
        "impact": "Critical indicator during financial crises. Sharp widening (RED state) signals severe credit market dysfunction and potential systemic risk."
    },
    
    "BAMLH0A0HYM2": {
        "name": "High Yield (Junk Bond) Spread",
        "description": "The yield spread between high-yield corporate bonds and U.S. Treasuries. Reflects credit risk premium investors demand for risky debt.",
        "relevance": "Widening spreads indicate investors are demanding higher compensation for credit risk, signaling deteriorating credit conditions and reduced risk appetite.",
        "scoring": "Direction: +1 (high = stress). Rising spreads signal increased default risk and tightening credit conditions.",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "High spread = Credit Stress/Default Risk (BAD). Low spread = Credit Confidence (GOOD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Normal: 300-500 bps. Elevated: 500-800 bps. Crisis: 800+ bps",
        "impact": "High impact on corporate financing and market sentiment. Widening spreads (RED) can trigger credit crunches and constrain business investment."
    }
}


def get_indicator_metadata(code: str) -> dict:
    """Get metadata for an indicator."""
    return INDICATOR_METADATA.get(code, {
        "name": code,
        "description": "No description available.",
        "relevance": "Not specified.",
        "scoring": "Standard z-score normalization with 0-100 scaling.",
        "thresholds": {"green_below": 30, "yellow_below": 60},
        "typical_range": "Not specified.",
        "impact": "Not specified."
    })


def get_all_metadata() -> dict:
    """Get metadata for all indicators."""
    return INDICATOR_METADATA
