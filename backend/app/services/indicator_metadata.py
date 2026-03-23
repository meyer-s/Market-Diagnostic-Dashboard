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
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "VIX typically ranges from 10-20 in calm markets, 20-30 during uncertainty, and 30+ during crisis periods.",
        "impact": "Critical early warning indicator. Elevated VIX (RED state) signals imminent market volatility and potential corrections."
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
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "Healthy bull: +2% to +8% above 50 EMA. Neutral: -2% to +2%. Bearish: -2% to -10%. Crisis: -10%+.",
        "impact": "Very high impact. Distance from 50 EMA captures market structure better than raw price. Sustained negative gaps (RED) indicate weakened trend structure. Reduces noise from absolute price levels."
    },

    "BREADTH_HEALTH": {
        "name": "Market Breadth Health",
        "description": (
            "A 3-component composite measuring whether market gains are broadly shared across "
            "stocks and sectors, not driven by a narrow concentration of large-cap tech. "
            "Components: (1) RSP/SPY ratio — equal-weight vs cap-weight participation (35%); "
            "(2) Sector participation — fraction of 11 SPDR sector ETFs trading above their "
            "50-day moving average (40%); (3) Sector return breadth — fraction of sectors with "
            "a positive 20-day return (25%). A market rotating out of tech-heavy concentration "
            "into broad sector participation scores higher here."
        ),
        "relevance": (
            "Broad participation is a hallmark of healthy bull markets. When gains concentrate "
            "in 2–3 mega-cap sectors, the market is fragile — a single rotation can cause "
            "index-level damage. Conversely, when sectors like Financials, Industrials, Energy, "
            "and Healthcare all advance together, it reflects genuine economic expansion rather "
            "than momentum chasing. Sector widening is structurally good for the economy."
        ),
        "scoring": (
            "Each component is z-score normalized over a 252-day lookback (direction: -1, higher = better). "
            "RSP/SPY also blends a 30-day trend component (65% level, 35% trend). "
            "The three normalized scores are combined at 35/40/25 weights."
        ),
        "direction": -1,
        "positive_is_good": True,
        "interpretation": (
            "High score = broad participation across sectors (GOOD). "
            "Low score = narrow, tech-heavy or mega-cap-only leadership (BAD). "
            "A rising score during a market rally means the rally is healthy and sustainable."
        ),
        "thresholds": {
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": (
            "RSP/SPY ratio typically clusters near 1.0. Sector participation above 70% is healthy; "
            "below 40% indicates most sectors are lagging. Return breadth above 60% is constructive."
        ),
        "impact": (
            "High impact. Breadth Health captures market internals that price-level indicators miss. "
            "Strong breadth confirmed by sector diversification is one of the most reliable signals "
            "of a sustainable advance vs a narrow, momentum-driven market prone to sharp reversals."
        )
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
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "DXY normally ranges 90-105. Levels above 110 indicate extreme dollar strength and potential market stress.",
        "impact": "Moderate to high impact. Extreme dollar moves can trigger currency crises and affect global liquidity conditions."
    },
    
    "UNRATE": {
        "name": "U.S. Unemployment Rate",
        "description": "The unemployment rate measures the percentage of the labor force that is jobless and actively seeking employment. Published monthly by the Bureau of Labor Statistics.",
        "relevance": "Rising unemployment signals economic deterioration and reduced consumer spending power. Persistent increases are associated with weaker demand cycles.",
        "scoring": "Direction: +1 (high = stress). Elevated unemployment indicates economic weakness. Scores normalize based on historical ranges.",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "High unemployment = Weak Economy (BAD). Low unemployment = Strong Economy (GOOD).",
        "thresholds": {
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "Healthy economy: 3.5-5%. Elevated stress: 5-7%. Crisis levels: 7%+",
        "impact": "High impact on consumer confidence and spending. Rising unemployment reflects weakening labor demand and can weigh on financial conditions."
    },
    
    "T10Y2Y": {
        "name": "10-Year minus 2-Year Treasury Spread",
        "description": "The yield curve spread between 10-year and 2-year U.S. Treasury notes. A key signal of macro regime and rate expectations.",
        "relevance": "Sustained inversions have historically coincided with weaker growth regimes. The spread reflects expectations for policy and the growth outlook.",
        "scoring": "Direction: -1 (negative/inverted spread = stress). Normal positive spread = HIGH score = GREEN. Inverted negative spread = LOW score = RED. Z-score normalization with direction inversion.",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "Positive spread = Normal Curve/Growth (GOOD). Negative spread = Inverted/Recession Signal (BAD).",
        "thresholds": {
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "Healthy: +0.5% to +2%. Warning: 0% to -0.5%. Crisis: -0.5% or lower",
        "impact": "Very high impact. Sustained inversion (RED state) reflects tight policy expectations and weaker growth regimes."
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
            "green_below": 40,
            "yellow_below": 70
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
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "Normal: 300-500 bps. Elevated: 500-800 bps. Crisis: 800+ bps",
        "impact": "High impact on corporate financing and market sentiment. Widening spreads (RED) can trigger credit crunches and constrain business investment."
    },
    
    "CONSUMER_HEALTH": {
        "name": "Consumer Health Index",
        "description": "Derived indicator measuring consumer financial health by comparing spending and income growth against inflation. Combines PCE (Personal Consumption Expenditures), PI (Personal Income), and CPI (Consumer Price Index) to assess real consumer capacity.",
        "relevance": "When spending and income growth outpace inflation, consumers have expanding real purchasing power and economic health is strong. When inflation outpaces spending/income growth, consumers face a squeeze with declining real purchasing power, signaling economic stress.",
        "scoring": "Final output is a stability score (0-100) where HIGHER = HEALTHIER CONSUMERS = MORE STABLE. Backend calculates real consumer purchasing power by comparing spending/income growth against inflation: [(PCE - CPI) + (PI - CPI)] / 2. Positive spread normalized to higher stability scores. Thresholds: ≥70 = GREEN (healthy), 40-69 = YELLOW (neutral), <40 = RED (stress).",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "Positive spread = Real consumer purchasing power expanding (GOOD). Negative spread = Inflation squeeze on consumers (BAD). Shows whether consumer fundamentals support economic growth or signal contraction.",
        "derived_from": ["PCE", "PI", "CPI"],
        "calculation": "Consumer Health = Average[(PCE Growth - CPI Growth), (PI Growth - CPI Growth)] - Avoids double-weighting inflation",
        "thresholds": {
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "Healthy: +1% to +3% spread. Neutral: -0.5% to +1%. Warning: -1% to -3%. Crisis: -3%+ (severe squeeze).",
        "impact": "Very high impact. This composite metric reveals whether consumer fundamentals align with market indicators. Negative spreads (RED state) signal consumers losing purchasing power despite nominal growth, indicating tighter demand conditions."
    },
    
    "BOND_MARKET_STABILITY": {
        "name": "Bond Market Stability Composite",
        "description": "Comprehensive bond market health index aggregating five critical fixed-income signals: credit spreads, yield curve shape, rate momentum, Treasury volatility, and term premium. Provides a holistic 0-100 stability score for bond market conditions. Public-sector stress subpanel uses public, derived proxies rather than proprietary municipal curve feeds.",
        "relevance": "The bond market often reflects shifts in financial conditions before equities. This composite captures multiple dimensions of fixed-income market health, from credit risk to rate volatility.",
        "scoring": "Final output is a stability score (0-100) where HIGHER = MORE STABLE. Backend computes weighted composite stress from sub-indicators, then inverts to stability score. Thresholds: ≥70 = GREEN (stable), 40-69 = YELLOW (caution), <40 = RED (stress).",
        "direction": 1,
        "positive_is_good": False,
        "interpretation": "High score (70+) = Healthy bond markets, normal credit conditions, manageable volatility (GREEN). Mid score (40-69) = Elevated concerns, some stress signals (YELLOW). Low score (<40) = Severe bond market stress, credit crunch, high volatility (RED).",
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
                "interpretation": "Inverted curves (negative spreads) have historically coincided with weaker growth regimes. Flat/inverted = tighter growth expectations. Steep = stronger growth expectations.",
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
                "interpretation": "Rapid rate increases signal restrictive monetary policy and tighter financial conditions. Historical hiking cycles correlate with broader market stress.",
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
        "calculation": "Composite Stress Score = (Credit Spread Stress * 0.44) + (Yield Curve Stress * 0.23) + (Rates Momentum Stress * 0.17) + (Treasury Volatility Stress * 0.16). Stored as raw stress score (0-100, higher = more stress). The direction=1 indicator setting inverts this during normalization for final scoring.",
        "thresholds": {
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "GREEN (Score 65-100): Normal bond market conditions with healthy credit, normal curve, low volatility. YELLOW (Score 35-65): Some stress signals emerging, elevated caution. RED (Score 0-35): Severe bond market dysfunction, credit crunch, high volatility.",
        "impact": "Very high impact. Bond markets are sensitive to funding conditions and credit risk. RED states (score <35) reflect broad fixed-income stress and tighter financing conditions.",
        "historical_context": "Major crises (2008, 2020) showed severe bond market stress months before equity peaks. Credit spreads widened dramatically, curves inverted, and MOVE spiked. This composite would have provided early RED warnings during: 2008 Financial Crisis, 2011 European Debt Crisis, 2018 Q4 selloff, 2020 COVID shock.",
        "use_cases": [
            "System-wide stress monitoring across fixed income",
            "Credit cycle assessment and funding condition monitoring",
            "Central bank policy impact monitoring",
            "Fixed-income market health diagnostic"
        ]
    },
    
    "SENTIMENT_COMPOSITE": {
        "name": "Consumer & Corporate Sentiment Composite",
        "description": "Composite measure of consumer and corporate confidence levels combining University of Michigan Consumer Sentiment, an OECD business-confidence proxy, a regional manufacturing new-orders proxy, and capital expenditure orders. Captures the psychological willingness to spend, invest, and expand.",
        "relevance": "Economic activity is influenced by confidence and expectations. Shifts in sentiment often coincide with changes in spending and investment behavior.",
        "scoring": "Final output is a stability score (0-100) where HIGHER = MORE CONFIDENCE = MORE STABLE. Components (Michigan, business confidence proxy, regional new-orders proxy, CapEx) are z-score normalized and mapped to 0-100 confidence scale, then weighted and combined. Thresholds: ≥70 = GREEN (broad optimism), 40-69 = YELLOW (mixed sentiment), <40 = RED (pessimism).",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "GREEN (Score 70-100): Broad-based optimism across consumers and businesses. YELLOW (Score 40-69): Mixed or neutral sentiment. RED (Score <40): Pervasive pessimism and muted demand.",
        "derived_from": ["USACSCICP02STSAM", "NFIB (scraped)", "BSCICP02USM460S", "NOCDISA066MSFRBNY", "VNWOSAMFRBDAL", "NOCDFSA066MSFRBPHI", "NEWORDER"],
        "components": {
            "michigan_consumer_sentiment": {
                "symbol": "USACSCICP02STSAM",
                "weight": 0.30,
                "description": "OECD US Consumer Confidence (30%)",
                "interpretation": "OECD composite consumer confidence for the United States, updated monthly and typically 1 month more current than the University of Michigan survey on FRED. Values above 100 indicate above-average consumer confidence; below 100 indicates below-average confidence. Tracks consumer willingness to spend, borrow, and make major purchases.",
                "typical_ranges": "Very Optimistic: >105. Healthy: 100-105. Cautious: 97-100. Pessimistic: 93-97. Crisis: <93 (2008, 2020, 2022).",
                "monthly": True
            },
            "nfib_small_business": {
                "symbol": "NFIB Optimism Index (direct scrape) / BSCICP02USM460S (history)",
                "weight": 0.30,
                "description": "NFIB Small Business Optimism Index (30%)",
                "interpretation": "The NFIB Optimism Index is scraped directly from nfib.com for the current month, providing the freshest available reading. Historical values use the OECD Business Tendency Survey (BSCICP02USM460S) translated to the NFIB index scale (mean=98, std=6.5) so that z-score normalization is consistent throughout. Higher values indicate stronger small-business optimism and willingness to hire and invest.",
                "typical_ranges": "Very Optimistic: >105. Healthy: 101-105. Neutral: 98-101 (52-yr avg). Cautious: 94-98. Pessimistic: <94.",
                "monthly": True
            },
            "ism_new_orders": {
                "symbol": "NOCDISA066MSFRBNY + VNWOSAMFRBDAL + NOCDFSA066MSFRBPHI",
                "weight": 0.25,
                "description": "Regional Manufacturing New Orders Proxy — 3 Districts (25%)",
                "interpretation": "Average of New York, Texas (Dallas), and Philadelphia Federal Reserve manufacturing new-orders diffusion surveys. Three-district coverage produces a more robust and geographically diverse signal than any single survey. Higher readings indicate improving order flow and stronger forward demand.",
                "typical_ranges": "Strong demand: >20. Balanced: 0-20. Weak demand: <0. Stress: <-10.",
                "monthly": True
            },
            "capex_proxy": {
                "symbol": "NEWORDER",
                "weight": 0.15,
                "description": "Nondefense Capital Goods Orders ex-Aircraft (15%)",
                "interpretation": "Proxy for corporate capital expenditure - the ultimate vote of confidence in the future. When companies order machinery, equipment, and technology, they're committing to multi-year investments. High orders signal expansion plans. Declining orders indicate pessimism about future demand.",
                "typical_ranges": "Strong CapEx cycle: +10% YoY. Moderate: +2-5% YoY. Weak: -2 to +2% YoY. Recession: -10%+ YoY decline (2008-2009, 2015-2016, 2020).",
                "monthly": True
            }
        },
        "calculation": "1) Fetch USACSCICP02STSAM (OECD US consumer confidence) from FRED. 2) Fetch BSCICP02USM460S (OECD business confidence) and translate to NFIB Optimism Index scale; replace or append latest month with directly scraped NFIB value if available. 3) Average NY Fed, Dallas Fed, and Philadelphia Fed new-orders surveys into a 3-district regional proxy. 4) Fetch NEWORDER capex proxy. 5) Align dates on the union of component release dates and forward-fill slower series. 3) Compute z-scores for each using 520-day lookback. 4) Map z-scores to 0-100 confidence scores: ((z + 3) / 6) * 100. 5) Weight and combine. 6) If optional components are missing, redistribute weights. 7) Store as composite confidence score 0-100.",
        "thresholds": {
            "green_above": 70,
            "yellow_above": 40
        },
        "typical_range": "GREEN (Score 65-100): Broad optimism across consumer and business surveys. YELLOW (Score 35-65): Mixed sentiment. RED (Score 0-35): Widespread pessimism and weaker demand conditions.",
        "impact": "High impact. Sentiment shapes spending and hiring decisions. This composite captures shifts in confidence that align with changing demand conditions.",
        "historical_context": "Sentiment indicators collapsed during: 2008 Financial Crisis (all components plunged), 2011 Debt Ceiling Crisis (brief shock), 2015-2016 Manufacturing Recession (CapEx and ISM weak), 2020 COVID Shock (historic collapse then recovery), 2022 Inflation Shock (Michigan hit 50-year low). Each major sentiment collapse preceded or coincided with GDP contractions or market corrections.",
        "use_cases": [
            "Monitoring demand sentiment shifts",
            "Consumer confidence context for discretionary activity",
            "Business cycle stage identification",
            "Complement to hard economic data (employment, production)",
            "Forward-looking confidence assessment"
        ]
    },
    
    "LIQUIDITY_PROXY": {
        "name": "Liquidity Proxy Indicator",
        "description": "Composite measure of systemic liquidity conditions combining M2 money supply growth, Federal Reserve balance sheet changes, and overnight reverse repo facility usage. Captures the availability of money and credit in the financial system.",
        "relevance": "Liquidity is a cross-asset driver. When liquidity expands, financial conditions ease; when it contracts, conditions tighten. This indicator tracks liquidity regime shifts.",
        "scoring": "Final output is a stability score (0-100) where HIGHER = MORE LIQUIDITY = MORE STABLE. Backend combines z-scores of M2 growth, Fed balance sheet changes, and inverted RRP usage into liquidity metric, then maps to stability score. Thresholds: ≥70 = GREEN (abundant liquidity), 40-69 = YELLOW (neutral/mixed), <40 = RED (liquidity drought).",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "GREEN (Score 70-100): Abundant liquidity. YELLOW (Score 40-69): Neutral/mixed liquidity. RED (Score <40): Liquidity tightness and elevated funding stress.",
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
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "GREEN (Score 60-100): 2020-2021 QE era, abundant liquidity supporting asset prices. YELLOW (Score 30-60): 2019 normal conditions, 2023-2024 partial recovery. RED (Score 0-30): 2022 aggressive QT and M2 contraction.",
        "impact": "Very high impact. Liquidity conditions align with broad market regimes and funding availability. This indicator contextualizes shifts in financial conditions.",
        "historical_context": "Liquidity explains much of market behavior that fundamentals cannot. 2020-2021: GREEN (M2 growth 25%+, Fed balance sheet +$4T, RRP near zero) = everything rallied. 2022: RED (M2 declining, QT -$95B/month, RRP peaked $2.5T) = worst year since 2008. 2023-2024: YELLOW (M2 stabilizing, QT slowing, RRP declining) = choppy recovery.",
        "use_cases": [
            "Market regime identification",
            "System-wide liquidity context",
            "Fed policy impact assessment (QE/QT effects)",
            "Liquidity stress monitoring (droughts coincide with tighter regimes)",
            "Cross-asset liquidity sensitivity checks"
        ],
        "correlation_note": "Strong inverse correlation with VIX. When liquidity is abundant (GREEN), volatility tends to be low. When liquidity drains (RED), volatility spikes. Also correlates with credit spreads and risk appetite metrics."
    },
    
    "ANALYST_ANXIETY": {
        "name": "Analyst Confidence",
        "description": "Composite sentiment indicator measuring institutional and professional market confidence through volatility calm and credit risk proxies. Combines equity volatility (VIX), rates volatility (MOVE), high-yield credit stress (HY OAS), and equity risk premium dynamics to gauge market confidence and stability.",
        "relevance": "Analyst confidence captures the professional investment community's collective assessment of market stability. Institutional confidence influences hedging activity and overall market stability.",
        "scoring": "Final output is a stability score (0-100) where HIGHER = LOWER ANXIETY = MORE STABLE. Each component (VIX, MOVE, HY OAS, ERP) normalized via z-score with momentum blending, mapped to stress, then inverted to stability. Thresholds: ≥70 = GREEN (calm markets), 40-69 = YELLOW (elevated caution), <40 = RED (high anxiety).",
        "direction": -1,
        "positive_is_good": True,
        "interpretation": "GREEN (Score 70-100): Low institutional anxiety and stable credit conditions. YELLOW (Score 40-69): Elevated caution and mixed signals. RED (Score <40): High institutional anxiety and stress.",
        "derived_from": ["^VIX", "^MOVE", "BAMLH0A0HYM2", "DGS10", "BAMLC0A4CBBB"],
        "components": {
            "vix": {
                "symbol": "^VIX",
                "weight": 0.40,
                "description": "CBOE Volatility Index - Equity Market Volatility",
                "interpretation": "Market's expectation of 30-day S&P 500 volatility derived from options pricing. The 'fear gauge' - spikes during uncertainty and panic. High VIX = high equity market anxiety.",
                "typical_ranges": "Calm: 10-15. Normal: 15-20. Elevated: 20-30. Crisis: 30+. Extreme panic: 50+ (2008, 2020).",
                "stress_mapping": "Higher VIX = Higher stress. VIX >30 signals severe anxiety, <15 signals complacency."
            },
            "move": {
                "symbol": "^MOVE",
                "weight": 0.25,
                "description": "Merrill Lynch Option Volatility Estimate - Rates Market Volatility",
                "interpretation": "Treasury market volatility - the 'VIX for bonds'. Elevated MOVE indicates uncertainty about Fed policy, inflation expectations, or fixed-income market dysfunction. High MOVE = high rates market anxiety.",
                "typical_ranges": "Calm: 50-80. Elevated: 80-120. Stressed: 120-150. Crisis: 150+ (March 2020: 265).",
                "stress_mapping": "Higher MOVE = Higher stress. MOVE >120 signals significant Treasury market anxiety.",
                "availability_note": "Optional component - if unavailable, weight redistributed to other components."
            },
            "hy_oas": {
                "symbol": "BAMLH0A0HYM2",
                "weight": 0.25,
                "description": "ICE BofA US High Yield Index Option-Adjusted Spread",
                "interpretation": "Yield spread of junk bonds over Treasuries. Widening spreads indicate investors demanding more compensation for credit risk, signaling deteriorating credit conditions and economic pessimism. High spreads = high credit stress.",
                "typical_ranges": "Strong: 300-400 bps. Normal: 400-600 bps. Stressed: 600-800 bps. Crisis: 800+ bps (2008: 2000+ bps, 2020: 1100 bps).",
                "stress_mapping": "Higher spreads = Higher stress. HY OAS >800 bps signals severe credit market anxiety."
            },
            "erp_proxy": {
                "symbol": "BAMLC0A4CBBB - DGS10",
                "weight": 0.10,
                "description": "Equity Risk Premium Proxy (BBB Corporate Yield - 10Y Treasury)",
                "interpretation": "Approximates risk premium investors demand for equity exposure. Widening ERP suggests investors fleeing to safety, demanding higher returns for risk-taking. Rapid ERP expansion signals 'risk-off' environment.",
                "typical_ranges": "Tight: 1.0-2.0%. Normal: 2.0-3.0%. Widening: 3.0-4.0%. Extreme: 4.0%+ (flight to quality).",
                "stress_mapping": "Wider spreads and rapid expansion = Higher stress. ERP >3.5% signals significant risk aversion.",
                "availability_note": "Optional component - if BBB data unavailable, weight redistributed to other components."
            }
        },
        "weight_reallocation": "If MOVE unavailable: VIX=0.44, HY_OAS=0.28, ERP=0.10. If ERP unavailable: VIX=0.55, HY_OAS=0.35. If both unavailable: VIX=0.60, HY_OAS=0.40 (minimum viable configuration).",
        "calculation": "1) Fetch component data (520+ day history). 2) For each component: compute z-score (520-day mean/std), compute 10-day ROC z-score, blend (75% value + 25% momentum). 3) Clamp z to [-3, +3]. 4) Map to stress: ((z + 3) / 6) * 100. 5) Compute weighted composite stress. 6) Invert to stability: 100 - stress. 7) Apply direction=-1 normalization for final scoring.",
        "thresholds": {
            "green_below": 40,
            "yellow_below": 70
        },
        "typical_range": "GREEN (Score 65-100): 2017-2019 'Goldilocks' period, 2021 post-COVID recovery. VIX <20, MOVE <100, tight credit spreads. Institutional confidence high. YELLOW (Score 35-65): 2023-2024 mixed regime, 2015-2016 volatility episodes. Some anxiety but not systemic. RED (Score 0-35): 2008 Financial Crisis, March 2020 COVID crash, Q4 2018. VIX >30, MOVE >150, HY spreads >800 bps.",
        "impact": "High impact for regime identification. Analyst Confidence reflects institutional anxiety levels and credit conditions. Shifts in confidence provide context for evolving market regimes.",
        "historical_context": "Major market dislocations show extreme anxiety: 2008 Crisis (RED for months, VIX peaked 89, HY spreads 2000+ bps), 2020 COVID (RED spike, VIX 82, MOVE 265, rapid recovery), 2018 Q4 (YELLOW/RED, VIX spiked to 36, -20% equity drawdown). GREEN regimes (2017-2019, 2021) marked by low volatility, tight spreads, and strong returns.",
        "use_cases": [
            "Early warning system for institutional risk-off behavior",
            "Volatility regime identification and hedging decisions",
            "Credit cycle assessment and high-yield exposure management",
            "Portfolio beta adjustment based on anxiety levels",
            "Options strategy selection (sell premium in GREEN, buy protection in YELLOW/RED)",
            "Correlation with systematic risk events and market dislocations"
        ],
        "directional_interpretation": "7-day delta provides context: Improving (+3 or more) = Anxiety declining. Deteriorating (-3 or less) = Anxiety rising. Stable (within ±3) = No material change.",
        "correlation_note": "High correlation with overall market stress. Inverse correlation with risk assets and positive correlation with safe-haven demand."
    }
}


def get_indicator_metadata(code: str) -> dict:
    """Get metadata for an indicator."""
    normalized_code = normalize_indicator_code(code)
    return INDICATOR_METADATA.get(normalized_code, {
        "name": code,
        "description": "No description available.",
        "relevance": "Not specified.",
        "scoring": "Standard z-score normalization with 0-100 scaling.",
        "thresholds": {"green_below": 40, "yellow_below": 70},
        "typical_range": "Not specified.",
        "impact": "Not specified."
    })


def get_all_metadata() -> dict:
    """Get metadata for all indicators."""
    return INDICATOR_METADATA


ALIAS_TO_CANONICAL = {
    "ANALYST_CONFIDENCE": "ANALYST_ANXIETY",
}

DISPLAY_NAME_OVERRIDES = {
    "ANALYST_ANXIETY": "Analyst Confidence",
}


def normalize_indicator_code(code: str) -> str:
    """Map alias codes to their canonical indicator codes."""
    return ALIAS_TO_CANONICAL.get(code, code)


def get_display_indicator_name(code: str, name: str) -> str:
    """Return a display-friendly name for an indicator code."""
    return DISPLAY_NAME_OVERRIDES.get(code, name)
