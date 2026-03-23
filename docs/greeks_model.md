# Greeks Model Documentation

**Last Updated:** January 23, 2026  
**Implementation:** `/backend/app/services/greeks_calculator.py`

## Overview

This document describes the options Greeks calculation model used in the Market Diagnostic Dashboard. The implementation uses the **Black-Scholes-Merton model** for European options to provide accurate pricing and risk metrics.

## Model: Black-Scholes (European Options)

We use the Black-Scholes model for standard US equity options. While US equity options are technically American-style (can be exercised early), the Black-Scholes European model provides excellent approximation for:
- Call options on non-dividend stocks
- Most equity options away from ex-dividend dates
- Risk metric calculations (Greeks)

### Why European Model?

1. **Simplicity**: Closed-form solutions for all Greeks
2. **Speed**: No need for binomial/trinomial trees
3. **Accuracy**: Excellent approximation for most cases
4. **Industry Standard**: Widely used for Greeks calculations even for American options

## Greeks Definitions & Units

### Delta (Δ)
**Definition:** Rate of change of option price with respect to underlying price  
**Units:** Per 1 share  
**Range:**
- Call options: [0, 1]
- Put options: [-1, 0]

**Interpretation:**
- Delta = 0.50 means the option gains $0.50 per $1 move in underlying
- High absolute delta (~0.8-1.0) indicates deep in-the-money
- Low absolute delta (~0-0.2) indicates out-of-the-money

**Formula (Call):**
```
Δ_call = e^(-qT) * N(d1)
```

**Formula (Put):**
```
Δ_put = -e^(-qT) * N(-d1)
```

### Gamma (Γ)
**Definition:** Rate of change of delta with respect to underlying price  
**Units:** Per $1 move in underlying (per 1 share)  
**Range:** Always positive

**Interpretation:**
- Gamma = 0.02 means delta increases by 0.02 per $1 move in underlying
- Highest at-the-money
- Approaches zero deep ITM or OTM
- Increases dramatically near expiration (ATM)

**Formula (Same for Calls and Puts):**
```
Γ = (e^(-qT) * n(d1)) / (S * σ * sqrt(T))
```

where n(d1) is the standard normal probability density function.

### Theta (Θ)
**Definition:** Rate of change of option price with respect to time  
**Units:** $ per day per contract (100 shares)  
**Sign:** Negative for long options (time decay)

**Interpretation:**
- Theta = -5.00 means the option loses $5.00 per day (all else equal)
- Accelerates as expiration approaches (especially ATM)
- Time decay is non-linear; most decay occurs in final 30 days

**Formula (Call):**
```
Θ_call = -(S * n(d1) * σ * e^(-qT)) / (2 * sqrt(T))
         - r * K * e^(-rT) * N(d2)
         + q * S * e^(-qT) * N(d1)
```

**Formula (Put):**
```
Θ_put = -(S * n(d1) * σ * e^(-qT)) / (2 * sqrt(T))
        + r * K * e^(-rT) * N(-d2)
        - q * S * e^(-qT) * N(-d1)
```

**Conversion:** Annualized theta is divided by 365 and multiplied by 100 for per-contract.

### Vega (ν)
**Definition:** Rate of change of option price with respect to volatility  
**Units:** $ per 1 volatility point per contract  
**Sign:** Always positive

**Interpretation:**
- Vega = 15.0 means the option gains $15 if volatility increases by 1 percentage point (e.g., 30% → 31%)
- Highest at-the-money
- Increases with time to expiration

**Formula (Same for Calls and Puts):**
```
ν = S * e^(-qT) * n(d1) * sqrt(T)
```

**Note:** Vega is per 1 percentage point (0.01 in decimal), scaled by 100 for per-contract.

## Black-Scholes Formula Components

### d1 and d2

```
d1 = [ln(S/K) + (r - q + σ²/2) * T] / (σ * sqrt(T))
d2 = d1 - σ * sqrt(T)
```

### Normal Distribution Functions

- **N(x)**: Cumulative distribution function (CDF) of standard normal
- **n(x)**: Probability density function (PDF) of standard normal

```
n(x) = (1/sqrt(2π)) * exp(-x²/2)
N(x) = ∫[-∞,x] n(t) dt
```

### Option Price Formulas

**Call:**
```
C = S * e^(-qT) * N(d1) - K * e^(-rT) * N(d2)
```

**Put:**
```
P = K * e^(-rT) * N(-d2) - S * e^(-qT) * N(-d1)
```

## Parameters

### Required Inputs

| Parameter | Symbol | Description | Example |
|-----------|--------|-------------|---------|
| Spot Price | S | Current underlying price | $100.00 |
| Strike Price | K | Option strike price | $105.00 |
| Time to Expiry | T | Years to expiration | 0.1534 (56 days / 365) |
| Risk-Free Rate | r | Annualized rate (decimal) | 0.0425 (4.25%) |
| Volatility | σ | Annualized vol (decimal) | 0.35 (35%) |
| Option Type | - | 'call' or 'put' | 'call' |

### Optional Inputs

| Parameter | Symbol | Description | Default |
|-----------|--------|-------------|---------|
| Dividend Yield | q | Annualized yield (decimal) | 0.0 |

### Configuration

**Risk-Free Rate (r):** Currently set to **4.25%** (0.0425)
- Based on current US Treasury rates
- Should be adjusted periodically to match 3-month T-bill rate
- Configured in: `/backend/app/api/secret_options.py` as `RISK_FREE_RATE`

## Volatility Handling

The system uses a **priority hierarchy** for volatility:

### Priority 1: Chain Implied Volatility
- Source: Live option chain from yfinance
- Field: `impliedVolatility` from option contract
- Status: "chain"

### Priority 2: Inverted from Option Price
- Method: Numerical root-finding (Brent's method)
- Uses: Mid price (bid+ask)/2 if available, else last price
- Bounds: IV search range [0.001, 5.0] (0.1% to 500%)
- Status: "inverted (mid)" or "inverted (last)"

### Priority 3: Historical Volatility
- Source: 30-day historical volatility from price history
- Calculation: Standard deviation of log returns, annualized
- Status: "historical"

### Priority 4: Default Fallback
- Value: 30% (0.30)
- Only used when all other methods fail
- Status: "default"

## Implied Volatility Inversion

When chain IV is not available, we invert the Black-Scholes formula to solve for σ given market price.

### Algorithm: Brent's Method

**Objective Function:**
```
f(σ) = BS_Price(S, K, T, r, σ, type) - Market_Price = 0
```

**Method:** Brent's root-finding algorithm (scipy.optimize.brentq)
- Combines bisection, secant, and inverse quadratic interpolation
- Guaranteed convergence within bounds
- Typical iterations: 5-15

**Bounds:**
- Lower: 0.1% (0.001)
- Upper: 500% (5.0)

**Convergence:**
- Tolerance: 1e-6
- Max iterations: 100

**Validation:**
- Checks no-arbitrage bounds before inversion
- Returns `None` if market price violates arbitrage

## Curve Generation

### Delta/Gamma vs Price Curve

**Purpose:** Shows how delta and gamma change as underlying moves

**Configuration:**
- Default range: ±30% of current price
- Default points: 51
- X-axis: Underlying price
- Y-axis: Delta (0-1) and Gamma (varies)

**Generation:**
```python
generate_delta_gamma_curve(
    K=strike,
    T=time_to_expiry,
    r=risk_free_rate,
    sigma=volatility,
    option_type='call' or 'put',
    current_price=spot,
    price_range_pct=0.3,  # ±30%
    num_points=51
)
```

**Expected Behavior:**
- **Delta Curve:**
  - Calls: Sigmoid shape from 0 (OTM) to 1 (ITM)
  - Puts: Sigmoid shape from -1 (ITM) to 0 (OTM)
  - Steepest at strike price
  
- **Gamma Curve:**
  - Bell-shaped curve
  - Peak at strike price
  - Approaches zero ITM and OTM
  - Higher peak with shorter time to expiration

### Theta vs Time Curve

**Purpose:** Shows time decay as expiration approaches

**Configuration:**
- X-axis: Days to expiration (descending)
- Y-axis: Theta ($ per day per contract)
- Range: From current DTE down to 1 day

**Generation:**
```python
generate_theta_curve(
    S=spot,
    K=strike,
    r=risk_free_rate,
    sigma=volatility,
    option_type='call' or 'put',
    current_dte=days_to_expiry,
    min_days=1
)
```

**Expected Behavior:**
- Theta becomes more negative (accelerates) as expiration approaches
- ATM options experience fastest acceleration
- Deep ITM/OTM options have relatively flat theta curves

## Known Limitations

### 1. Early Exercise (American Options)
**Issue:** Model does not account for early exercise premium  
**Impact:** Minimal for most cases; significant only for:
- Deep ITM puts
- Calls on high-dividend stocks near ex-dividend date

**Mitigation:** For precision-critical cases, consider binomial model

### 2. Dividends
**Current:** Assumes zero dividend yield (q=0)  
**Future:** Can add dividend yield parameter if needed

### 3. Interest Rates
**Current:** Static 4.25% rate  
**Future:** Could fetch live T-bill rates from FRED API

### 4. Volatility Smile/Skew
**Issue:** Assumes constant volatility across strikes  
**Reality:** IV varies by strike (smile) and moneyness (skew)

**Mitigation:** Uses per-contract chain IV when available

### 5. Discrete Dividends
**Current:** Continuous dividend yield model  
**Reality:** Stocks pay discrete dividends

**Impact:** Minor for most stocks; significant for high-yield

## Validation & Testing

### Test Coverage

Comprehensive test suite in `/backend/tests/test_greeks_calculator.py` covering:
- Basic pricing calculations
- Greeks accuracy (delta, gamma, theta, vega)
- Put-call relationships
- Implied volatility inversion
- Curve generation
- Edge cases (zero time, zero vol, negative prices)
- Real-world scenarios (KTOS, NEOG, ERAS, NKE positions)

### Reference Values

Tests validate against known Black-Scholes values:
- ATM call delta ≈ 0.50-0.55 (depending on r)
- Gamma peaks at-the-money
- Theta accelerates near expiration
- IV inversion recovers original volatility within 0.1%

### Running Tests

```bash
cd backend
pytest tests/test_greeks_calculator.py -v
```

## Troubleshooting

### Delta showing 0.000 for ITM options

**Possible Causes:**
- Resolved: Theta not scaled to per-contract
- Resolved: Time to expiry calculation incorrect
- Check: Volatility is non-zero
- Check: Option chain data is current

### Gamma shows absurdly high values

**Possible Causes:**
- Resolved: Incorrect gamma formula scaling
- Resolved: Time to expiry very small (numerical instability)
- Check: T is clamped to minimum 1e-6 years

### Delta saturates at 1.000 instantly

**Possible Causes:**
- Resolved: Used incorrect time units (days instead of years)
- Resolved: Risk-free rate wrong units (percentage instead of decimal)

### Theta curve looks flat or wrong direction

**Possible Causes:**
- Resolved: Generated curve from 1 to max instead of max to 1
- Resolved: Theta units (annual vs daily, per-share vs per-contract)

## Future Enhancements

### Short Term
- [ ] Add live risk-free rate fetching
- [ ] Support dividend yield input
- [ ] Add Rho (sensitivity to interest rate)

### Medium Term
- [ ] Implement binomial model for American options
- [ ] Add volatility surface interpolation
- [ ] Support discrete dividend adjustments

### Long Term
- [ ] Machine learning-based IV prediction
- [ ] Greeks Greeks (second derivatives: vanna, charm, etc.)
- [ ] Portfolio-level Greeks aggregation

## References

1. **Black, F., & Scholes, M. (1973).** "The Pricing of Options and Corporate Liabilities." *Journal of Political Economy*, 81(3), 637-654.

2. **Hull, J. C. (2017).** *Options, Futures, and Other Derivatives* (10th ed.). Pearson.

3. **Haug, E. G. (2007).** *The Complete Guide to Option Pricing Formulas* (2nd ed.). McGraw-Hill.

4. **Scipy.stats Documentation:** Normal Distribution Functions  
   https://docs.scipy.org/doc/scipy/reference/stats.html

5. **Scipy.optimize Documentation:** Root Finding (brentq)  
   https://docs.scipy.org/doc/scipy/reference/optimize.html

## Appendix: Example Calculations

### Example 1: KTOS 125C (OTM Call)

**Inputs:**
- S = $113.85
- K = $125.00
- T = 56 days / 365 = 0.1534 years
- r = 0.0425
- σ = 0.35 (35%)
- Type = Call

**Expected Greeks (approximate):**
- Delta ≈ 0.35-0.45
- Gamma ≈ 0.015-0.025
- Theta ≈ -8 to -12 ($ per day per contract)
- Vega ≈ 12-18

### Example 2: NKE 65C (Near ATM)

**Inputs:**
- S = $65.46
- K = $65.00
- T = 28 days / 365 = 0.0767 years
- r = 0.0425
- σ = 0.30 (30%)
- Type = Call

**Expected Greeks:**
- Delta ≈ 0.55-0.65 (slightly ITM)
- Gamma ≈ 0.05-0.08 (high ATM gamma)
- Theta ≈ -15 to -20 (accelerated decay)
- Vega ≈ 8-12

---

**For questions or issues, contact:** Development Team  
**Last Implementation Review:** January 23, 2026
