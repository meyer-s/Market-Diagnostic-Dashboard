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
        "scoring": "Direction: +1 (high = stress). Scored on RATE OF CHANGE: rising rates = tightening = stress, falling rates = easing = stability. The velocity of change matters more than absolute level. First data point is skipped to avoid zero-padding bias.",
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
        "scoring": "Direction: -1 (negative gap = stress). Uses (Price - 50 EMA) / 50 EMA as percentage gap. Positive gap (price above EMA) = bullish = HIGH score = GREEN. Negative gap (below EMA) = bearish = LOW score = RED. Z-score normalized on gap percentages.",
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
        "scoring": "Direction: -1 (negative/inverted spread = stress). Normal positive spread = HIGH score = GREEN. Inverted negative spread = LOW score = RED. Z-score normalization with direction inversion.",
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
    
    "CONSUMER_HEALTH": {
        "name": "Consumer Health Index",
        "description": "Derived indicator measuring consumer financial health by comparing spending and income growth against inflation. Combines PCE (Personal Consumption Expenditures), PI (Personal Income), and CPI (Consumer Price Index) to assess real consumer capacity.",
        "relevance": "When spending and income growth outpace inflation, consumers have expanding real purchasing power and economic health is strong. When inflation outpaces spending/income growth, consumers face a squeeze with declining real purchasing power, signaling economic stress.",
        "scoring": "Direction: -1 (negative = stress). Calculates average of two spreads: [(PCE MoM% - CPI MoM%) + (PI MoM% - CPI MoM%)] / 2. Positive spread = spending and income outpacing inflation (healthy). Negative spread = inflation eroding real consumer capacity (stress).",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "Positive spread = Real consumer purchasing power expanding (GOOD). Negative spread = Inflation squeeze on consumers (BAD). Shows whether consumer fundamentals support economic growth or signal contraction.",
        "derived_from": ["PCE", "PI", "CPI"],
        "calculation": "Consumer Health = Average[(PCE Growth - CPI Growth), (PI Growth - CPI Growth)] - Avoids double-weighting inflation",
        "thresholds": {
            "green_below": 30,
            "yellow_below": 60
        },
        "typical_range": "Healthy: +1% to +3% spread. Neutral: -0.5% to +1%. Warning: -1% to -3%. Crisis: -3%+ (severe squeeze).",
        "impact": "Very high impact. This composite metric reveals whether consumer fundamentals align with market indicators. Negative spreads (RED state) signal consumers losing purchasing power despite nominal growth, indicating recession risk and reduced corporate revenue expectations. Captures the real-world impact of inflation on consumer capacity."
    },
    
    "BOND_MARKET_STABILITY": {
        "name": "Bond Market Stability Composite",
        "description": "Comprehensive bond market health index aggregating five critical fixed-income signals: credit spreads, yield curve shape, rate momentum, Treasury volatility, and term premium. Provides a holistic 0-100 stability score for bond market conditions.",
        "relevance": "The bond market often signals economic stress before equities. This composite captures multiple dimensions of fixed-income market health, from credit risk to rate volatility, offering early warnings of systemic instability. Bond markets are larger and more sensitive to macroeconomic shifts than equities.",
        "scoring": "Direction: -1 (indicates high raw value should map to low final score). Computes weighted composite stress score from 5 sub-indicators, each z-score normalized and mapped to 0-100 where higher = more stress. The direction=-1 setting inverts this during normalization so that high stress maps to low final scores (RED) and low stress maps to high final scores (GREEN). Thresholds: 65-100 = GREEN (stable), 35-65 = YELLOW (caution), 0-35 = RED (stress).",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "High score (65+) = Healthy bond markets, normal credit conditions, manageable volatility (GOOD). Mid score (35-65) = Elevated concerns, some stress signals (CAUTION). Low score (0-35) = Severe bond market stress, credit crunch, high volatility (BAD).",
        "derived_from": ["BAMLH0A0HYM2", "BAMLC0A0CM", "DGS10", "DGS2", "DGS3MO", "DGS30", "DGS5"],
        "components": {
            "credit_spread_stress": {
                "weight": 0.44,
                "description": "Credit Spread Stress (44%)",
                "sources": ["High Yield OAS (BAMLH0A0HYM2)", "Investment Grade OAS (BAMLC0A0CM)"],
                "formula": "Average z-scores of HY and IG option-adjusted spreads. Higher spreads = more stress.",
                "interpretation": "Widening credit spreads indicate investors demanding higher risk premiums, signaling deteriorating credit conditions and potential default risk.",
                "typical_ranges": {
                    "hy_oas": "Normal: 300-500 bps, Elevated: 500-800 bps, Crisis: 800+ bps",
                    "ig_oas": "Normal: 100-200 bps, Elevated: 200-350 bps, Crisis: 350+ bps"
                }
            },
            "yield_curve_health": {
                "weight": 0.23,
                "description": "Yield Curve Health (23%)",
                "sources": ["10Y-2Y Spread (DGS10-DGS2)", "10Y-3M Spread (DGS10-DGS3MO)", "Optional: 30Y-5Y (DGS30-DGS5)"],
                "formula": "Average z-scores of yield curve slopes, inverted. Steeper curve = healthier = lower stress score.",
                "interpretation": "Inverted curves (negative spreads) have preceded every U.S. recession since 1955. Flat/inverted = recession warning. Steep = growth expectations.",
                "typical_ranges": {
                    "10y2y": "Healthy: +0.5% to +2%, Warning: 0% to -0.5%, Crisis: -0.5% or lower",
                    "10y3m": "Healthy: +1% to +2.5%, Warning: 0% to +0.5%, Crisis: negative"
                }
            },
            "rates_momentum": {
                "weight": 0.17,
                "description": "Rates Momentum (17%)",
                "sources": ["2Y Yield ROC (DGS2)", "10Y Yield ROC (DGS10)"],
                "formula": "3-month rate of change for 2Y and 10Y yields. Large upward spikes indicate aggressive Fed tightening = stress.",
                "interpretation": "Rapid rate increases signal restrictive monetary policy and increased recession risk. Historical Fed hiking cycles correlate with market corrections.",
                "typical_ranges": "Gradual: ±25 bps/quarter, Aggressive: ±50-100 bps/quarter, Crisis tightening: 100+ bps/quarter"
            },
            "treasury_volatility": {
                "weight": 0.16,
                "description": "Treasury Volatility (16%)",
                "sources": ["Calculated from 10-Year Treasury Yield (DGS10)"],
                "formula": "Fixed 20-day rolling standard deviation of absolute daily yield changes. Higher volatility = increased stress. Initial values use expanding window.",
                "interpretation": "Realized Treasury volatility measures actual rate instability. Elevated volatility signals uncertainty, forced deleveraging, or liquidity concerns in Treasury markets. Similar to MOVE Index but calculated from daily yield changes for better data availability.",
                "typical_ranges": "Low volatility: <0.03% daily std dev, Moderate: 0.03-0.06%, High: 0.06-0.10%, Crisis: >0.10%"
            }
        },
        "calculation": "Composite Stress Score = (Credit Spread Stress * 0.44) + (Yield Curve Stress * 0.23) + (Rates Momentum Stress * 0.17) + (Treasury Volatility Stress * 0.16). Stored as raw stress score (0-100, higher = more stress). The direction=-1 indicator setting inverts this during normalization for final scoring.",
        "thresholds": {
            "green_below": 65,
            "yellow_below": 35
        },
        "typical_range": "GREEN (Score 65-100): Normal bond market conditions with healthy credit, normal curve, low volatility. YELLOW (Score 35-65): Some stress signals emerging, elevated caution. RED (Score 0-35): Severe bond market dysfunction, credit crunch, high volatility.",
        "impact": "Very high impact. Bond markets are leading indicators of economic conditions. This composite captures systemic stress before it manifests in equities. RED states (score <35) historically coincide with recessions, credit crises, or major policy shifts. The weighted approach prioritizes credit conditions (44%) as the most sensitive early warning system.",
        "historical_context": "Major crises (2008, 2020) showed severe bond market stress months before equity peaks. Credit spreads widened dramatically, curves inverted, and MOVE spiked. This composite would have provided early RED warnings during: 2008 Financial Crisis, 2011 European Debt Crisis, 2018 Q4 selloff, 2020 COVID shock.",
        "use_cases": [
            "Early warning system for systemic financial stress",
            "Credit cycle assessment and recession forecasting",
            "Portfolio risk management and defensive positioning",
            "Central bank policy impact monitoring",
            "Fixed-income market health diagnostic"
        ]
    },
    
    "LIQUIDITY_PROXY": {
        "name": "Liquidity Proxy Indicator",
        "description": "Composite measure of systemic liquidity conditions combining M2 money supply growth, Federal Reserve balance sheet changes, and overnight reverse repo facility usage. Captures the availability of money and credit in the financial system.",
        "relevance": "Liquidity is the lifeblood of financial markets. When liquidity is abundant, asset prices rise and volatility falls. When liquidity drains, markets become vulnerable to shocks and corrections. This indicator provides early warning of liquidity regime shifts.",
        "scoring": "Direction: -1 (indicates high raw value should map to low final score). Formula: z(M2 YoY%) + z(ΔFed Balance Sheet) - z(RRP Usage). Components are z-score normalized and combined into liquidity proxy, then inverted and scaled to create a stress score (0-100, where higher = worse liquidity). The direction=-1 setting inverts this during normalization so high stress maps to low final scores (RED) and low stress maps to high final scores (GREEN).",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "GREEN (Score 60-100): Abundant liquidity, supportive tailwinds for risk assets. YELLOW (Score 30-60): Neutral/mixed liquidity, market vulnerable to shocks. RED (Score 0-30): Liquidity drought, high fragility, increased crash risk.",
        "derived_from": ["M2SL", "WALCL", "RRPONTSYD"],
        "components": {
            "m2_money_supply": {
                "symbol": "M2SL",
                "description": "M2 Money Supply Year-over-Year Growth",
                "interpretation": "Rapid M2 growth = increasing money supply = higher liquidity. Declining M2 growth = monetary tightening. M2 includes cash, checking deposits, savings accounts, money market funds - broad measure of money availability.",
                "typical_ranges": "Healthy: 5-8% YoY growth. Tight: 0-3% growth. Extreme ease: 10%+ growth (2020-2021). Contraction: negative growth (rare, indicates severe tightening)."
            },
            "fed_balance_sheet": {
                "symbol": "WALCL",
                "description": "Federal Reserve Total Assets (Balance Sheet Changes)",
                "interpretation": "Increasing balance sheet = Fed buying assets (QE) = injecting liquidity. Decreasing balance sheet = Fed selling assets (QT) = draining liquidity. Delta (change) matters more than absolute level.",
                "typical_ranges": "QE: +$50-100B/month. QT: -$50-95B/month. Neutral: flat to small changes. Crisis response: massive expansion (2008, 2020)."
            },
            "reverse_repo": {
                "symbol": "RRPONTSYD",
                "description": "Overnight Reverse Repo Facility Usage",
                "interpretation": "HIGH RRP usage = excess reserves parked at Fed = LOW effective market liquidity (money sitting idle). LOW RRP = reserves deployed in markets = HIGH liquidity. Inverse relationship with market liquidity.",
                "typical_ranges": "Low liquidity stress: $2T+ parked. Moderate: $500B-$2T. High liquidity: <$500B. Zero usage = maximum liquidity deployment."
            }
        },
        "calculation": "1) Calculate M2 YoY% change (12-month lookback). 2) Calculate Fed balance sheet delta (month-over-month change). 3) Get RRP usage level. 4) Compute z-scores for each. 5) Combine: Liquidity = z(M2_YoY) + z(ΔFedBS) - z(RRP). 6) Map to 0-100 stress score (inverted: high liquidity = high score).",
        "thresholds": {
            "green_below": 60,
            "yellow_below": 30
        },
        "typical_range": "GREEN (Score 60-100): 2020-2021 QE era, abundant liquidity supporting asset prices. YELLOW (Score 30-60): 2019 normal conditions, 2023-2024 partial recovery. RED (Score 0-30): 2022 aggressive QT and M2 contraction.",
        "impact": "Very high impact. Liquidity drives ALL asset classes. The saying 'don't fight the Fed' refers primarily to liquidity conditions. Major market regimes correlate with liquidity: 2008-2014 QE = bull market, 2018 QT = correction, 2020-2021 massive QE = bubble, 2022 aggressive QT = bear market. This indicator provides systematic edge for timing risk-on/risk-off positioning.",
        "historical_context": "Liquidity explains much of market behavior that fundamentals cannot. 2020-2021: GREEN (M2 growth 25%+, Fed balance sheet +$4T, RRP near zero) = everything rallied. 2022: RED (M2 declining, QT -$95B/month, RRP peaked $2.5T) = worst year since 2008. 2023-2024: YELLOW (M2 stabilizing, QT slowing, RRP declining) = choppy recovery.",
        "use_cases": [
            "Market regime identification (risk-on vs risk-off)",
            "Asset allocation decisions and beta management",
            "Timing entry/exit for risk assets",
            "Fed policy impact assessment (QE/QT effects)",
            "Crash risk monitoring (liquidity droughts precede crashes)",
            "Cryptocurrency and speculative asset timing (most liquidity-sensitive)"
        ],
        "correlation_note": "Strong inverse correlation with VIX. When liquidity is abundant (GREEN), volatility tends to be low. When liquidity drains (RED), volatility spikes. Also correlates with credit spreads and risk appetite metrics."
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
