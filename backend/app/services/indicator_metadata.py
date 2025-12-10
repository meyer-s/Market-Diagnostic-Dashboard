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
        "description": "SPY tracks the S&P 500 index, representing the 500 largest U.S. companies. Scored based on distance from 50-day EMA to capture trend strength and mean reversion dynamics.",
        "relevance": "The gap between price and its 50-day EMA reveals trend strength and exhaustion. Large deviations signal overextended conditions or breakdowns in trend structure.",
        "scoring": "Direction: -1 (low = stress). Uses (Price - 50 EMA) / 50 EMA as percentage gap. Positive gap (price above EMA) = bullish = GREEN. Negative gap (below EMA) = bearish = RED. Z-score normalized on gap percentages.",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "Price above 50 EMA = Bullish Trend (GOOD). Price below 50 EMA = Bearish Trend/Weakness (BAD). Large deviations indicate overextension or breakdown.",
        "use_ema_gap": True,
        "ema_period": 50,
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Healthy bull: +2% to +8% above 50 EMA. Neutral: -2% to +2%. Bearish: -2% to -10%. Crisis: -10%+.",
        "impact": "Very high impact. Distance from 50 EMA captures market structure better than raw price. Sustained negative gaps (RED) signal broken trends and increased correction risk. Reduces noise from absolute price levels."
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
    },
    
    "PCE": {
        "name": "Personal Consumption Expenditures",
        "description": "PCE measures total consumer spending on goods and services in the U.S. economy. It's the Federal Reserve's preferred inflation gauge and a key indicator of consumer demand and economic health.",
        "relevance": "Rising PCE indicates strong consumer spending and economic activity. Declining PCE signals weakening demand, reduced consumer confidence, and potential recession.",
        "scoring": "Direction: -1 (low = stress). Strong consumer spending = economic health. Declining spending = weakness. Z-score normalized with 252-day lookback.",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "Rising PCE = Strong Consumer Demand (GOOD). Falling PCE = Weak Economy/Recession Risk (BAD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Healthy growth: 2-4% YoY. Moderate: 0-2%. Contraction: Negative growth signals recession.",
        "impact": "Very high impact. Consumer spending accounts for ~70% of U.S. GDP. Declining PCE (RED state) is a strong recession indicator and directly impacts corporate earnings expectations."
    },
    
    "PI": {
        "name": "Personal Income",
        "description": "Personal Income measures the total income received by individuals from all sources including wages, salaries, investment income, and government benefits. A key indicator of consumer purchasing power.",
        "relevance": "Rising personal income supports consumer spending and economic growth. Stagnant or declining income constrains spending and signals economic stress.",
        "scoring": "Direction: -1 (low = stress). Strong income growth = consumer health and spending capacity. Declining income = economic weakness and reduced demand.",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "Rising Income = Strong Consumer Health (GOOD). Falling Income = Economic Weakness (BAD).",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Healthy: 3-5% YoY growth. Moderate: 1-3%. Warning: 0-1%. Recessionary: Negative growth.",
        "impact": "High impact on consumer spending capacity and confidence. Declining personal income (RED state) precedes reduced consumer spending and economic contraction, affecting market sentiment and corporate revenue expectations."
    },
    
    "CPI": {
        "name": "Consumer Price Index (CPI)",
        "description": "The Consumer Price Index measures changes in the price level of a basket of consumer goods and services. CPI is the most widely watched inflation indicator, tracking price changes faced by urban consumers.",
        "relevance": "Rising CPI indicates inflation eroding purchasing power. Rapid CPI increases trigger Fed rate hikes, tighten financial conditions, and reduce real consumer income. High inflation destabilizes markets and economies.",
        "scoring": "Direction: +1 (high = stress). Uses month-over-month percentage change. Accelerating inflation = stress/Fed tightening. Decelerating inflation = stability. Deflation also signals economic weakness.",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "Rising CPI = Inflation Pressure/Fed Tightening (BAD). Stable/Declining CPI = Price Stability (GOOD).",
        "use_rate_of_change": True,
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Healthy: 1.5-2.5% YoY. Elevated: 3-5%. Crisis: 5%+. Fed target: 2% YoY. MoM changes: 0.1-0.3% normal, 0.4%+ concerning.",
        "impact": "Very high impact. Accelerating CPI (RED state) forces Fed rate hikes, pressures profit margins, reduces consumer purchasing power, and increases recession risk. CPI directly influences Fed policy decisions and market expectations."
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
