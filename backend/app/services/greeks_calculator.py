"""
Black-Scholes Greeks Calculator

Implements accurate option Greeks using the Black-Scholes-Merton model for European options.
All calculations follow industry conventions for units and scaling.

Units and Conventions:
- Delta: per 1 share (calls: [0,1], puts: [-1,0])
- Gamma: change in delta per $1 move in underlying (per 1 share)
- Theta: $ per day per contract (100 shares), negative for long options
- Vega: $ change per 1% vol point (per contract)

Implementation Notes:
- Uses European option pricing (no early exercise)
- Dividend yield (q) is optional, defaults to 0
- Risk-free rate (r) should be annualized decimal (e.g., 0.0425 for 4.25%)
- Volatility (sigma) should be annualized decimal (e.g., 0.35 for 35%)
- Time to expiry (T) in years (use days_to_expiry / 365.0)
"""

from __future__ import annotations

import math
from typing import Dict, Optional, Tuple
from scipy.stats import norm
from scipy.optimize import brentq


def norm_cdf(x: float) -> float:
    """Cumulative distribution function for standard normal distribution."""
    return norm.cdf(x)


def norm_pdf(x: float) -> float:
    """Probability density function for standard normal distribution."""
    return norm.pdf(x)


def black_scholes_d1_d2(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    q: float = 0.0
) -> Tuple[float, float]:
    """
    Calculate d1 and d2 for Black-Scholes formula.
    
    Args:
        S: Spot price (current underlying price)
        K: Strike price
        T: Time to expiry in years
        r: Risk-free rate (annualized)
        sigma: Volatility (annualized)
        q: Dividend yield (annualized), default 0
    
    Returns:
        Tuple of (d1, d2)
    """
    if T <= 0 or sigma <= 0:
        raise ValueError("T and sigma must be positive")
    
    sqrt_T = math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    
    return d1, d2


def black_scholes_price(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: str,
    q: float = 0.0
) -> float:
    """
    Calculate Black-Scholes option price.
    
    Args:
        S: Spot price
        K: Strike price
        T: Time to expiry in years
        r: Risk-free rate
        sigma: Volatility
        option_type: 'call' or 'put'
        q: Dividend yield, default 0
    
    Returns:
        Option price per share
    """
    if S <= 0 or K <= 0 or T <= 0 or sigma <= 0:
        return 0.0
    
    d1, d2 = black_scholes_d1_d2(S, K, T, r, sigma, q)
    
    if option_type.lower() == 'call':
        price = S * math.exp(-q * T) * norm_cdf(d1) - K * math.exp(-r * T) * norm_cdf(d2)
    else:  # put
        price = K * math.exp(-r * T) * norm_cdf(-d2) - S * math.exp(-q * T) * norm_cdf(-d1)
    
    return max(price, 0.0)


def calculate_greeks(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: str,
    q: float = 0.0
) -> Dict[str, float]:
    """
    Calculate all Greeks for an option position.
    
    Args:
        S: Spot price (current underlying price)
        K: Strike price
        T: Time to expiry in years
        r: Risk-free rate (annualized decimal, e.g., 0.045)
        sigma: Volatility (annualized decimal, e.g., 0.35)
        option_type: 'call' or 'put'
        q: Dividend yield (annualized), default 0
    
    Returns:
        Dictionary containing:
        - delta: per 1 share
        - gamma: per $1 move per share
        - theta: per day per contract (100 shares)
        - vega: per 1 vol point per contract
        - price: theoretical option price per share
    """
    # Handle edge cases
    if S <= 0 or K <= 0 or T <= 1e-6 or sigma <= 0:
        return {
            "delta": 0.0,
            "gamma": 0.0,
            "theta": 0.0,
            "vega": 0.0,
            "price": 0.0
        }
    
    # Clamp very small T to avoid numerical issues
    T = max(T, 1e-6)
    
    # Calculate d1, d2
    sqrt_T = math.sqrt(T)
    d1, d2 = black_scholes_d1_d2(S, K, T, r, sigma, q)
    
    # PDF and CDF values
    nd1 = norm_pdf(d1)
    
    # Delta (per share)
    if option_type.lower() == 'call':
        delta = math.exp(-q * T) * norm_cdf(d1)
    else:  # put
        delta = -math.exp(-q * T) * norm_cdf(-d1)
    
    # Gamma (per $1 move per share)
    # Same for calls and puts
    gamma = (math.exp(-q * T) * nd1) / (S * sigma * sqrt_T)
    
    # Theta (per year, then convert to per day per contract)
    # Theta is typically negative for long options (time decay)
    if option_type.lower() == 'call':
        theta_annual = (
            -(S * nd1 * sigma * math.exp(-q * T)) / (2 * sqrt_T)
            - r * K * math.exp(-r * T) * norm_cdf(d2)
            + q * S * math.exp(-q * T) * norm_cdf(d1)
        )
    else:  # put
        theta_annual = (
            -(S * nd1 * sigma * math.exp(-q * T)) / (2 * sqrt_T)
            + r * K * math.exp(-r * T) * norm_cdf(-d2)
            - q * S * math.exp(-q * T) * norm_cdf(-d1)
        )
    
    # Convert to per day per contract (100 shares)
    theta_per_day_per_contract = (theta_annual / 365.0) * 100.0
    
    # Vega (per 1 percentage point vol change per contract)
    # BS formula gives vega per 1.0 change in sigma (decimal)
    # For 1 percentage point (0.30 -> 0.31 = 0.01 change): divide by 100
    # For contract (100 shares): multiply by 100
    # Net effect: vega_per_contract = vega_per_share * 100 / 100 = vega_per_share
    vega_per_share = S * math.exp(-q * T) * nd1 * sqrt_T
    vega_per_contract = vega_per_share  # Already accounts for contract size vs percentage point
    
    # Price (per share, for reference)
    price = black_scholes_price(S, K, T, r, sigma, option_type, q)
    
    return {
        "delta": delta,
        "gamma": gamma,
        "theta": theta_per_day_per_contract,
        "vega": vega_per_contract,
        "price": price
    }


def implied_volatility(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: str,
    q: float = 0.0,
    max_iterations: int = 100,
    tolerance: float = 1e-6
) -> Optional[float]:
    """
    Calculate implied volatility using Brent's method (root finding).
    
    Args:
        market_price: Observed option price in the market
        S: Spot price
        K: Strike price
        T: Time to expiry in years
        r: Risk-free rate
        option_type: 'call' or 'put'
        q: Dividend yield, default 0
        max_iterations: Maximum iterations for solver
        tolerance: Convergence tolerance
    
    Returns:
        Implied volatility (annualized decimal) or None if cannot converge
    """
    # Validate inputs
    if market_price <= 0 or S <= 0 or K <= 0 or T <= 0:
        return None
    
    # Check no-arbitrage bounds
    if option_type.lower() == 'call':
        intrinsic = max(S - K, 0)
    else:
        intrinsic = max(K - S, 0)
    
    if market_price < intrinsic:
        return None  # Violates no-arbitrage
    
    # Define objective function
    def objective(sigma: float) -> float:
        try:
            bs_price = black_scholes_price(S, K, T, r, sigma, option_type, q)
            return bs_price - market_price
        except Exception:
            return float('inf')
    
    # Try to find root in reasonable volatility range
    try:
        # Typical IV range: 1% to 500% (0.01 to 5.0)
        iv = brentq(objective, 0.001, 5.0, maxiter=max_iterations, xtol=tolerance)
        return iv
    except Exception:
        # If Brent's method fails, return None
        return None


def generate_delta_gamma_curve(
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: str,
    current_price: float,
    q: float = 0.0,
    price_range_pct: float = 0.3,
    num_points: int = 51
) -> list[Dict[str, float]]:
    """
    Generate delta and gamma values across a range of underlying prices.
    
    Args:
        K: Strike price
        T: Time to expiry in years
        r: Risk-free rate
        sigma: Volatility
        option_type: 'call' or 'put'
        current_price: Current underlying price (for centering the range)
        q: Dividend yield, default 0
        price_range_pct: Price range as percentage of current price (e.g., 0.3 = ±30%)
        num_points: Number of points to generate
    
    Returns:
        List of dicts with keys: price, delta, gamma
    """
    lower = current_price * (1 - price_range_pct)
    upper = current_price * (1 + price_range_pct)
    
    curve = []
    for i in range(num_points):
        S = lower + (upper - lower) * i / (num_points - 1)
        try:
            greeks = calculate_greeks(S, K, T, r, sigma, option_type, q)
            curve.append({
                "price": round(S, 2),
                "delta": greeks["delta"],
                "gamma": greeks["gamma"]
            })
        except Exception:
            # If calculation fails, add zeros
            curve.append({
                "price": round(S, 2),
                "delta": 0.0,
                "gamma": 0.0
            })
    
    return curve


def generate_theta_curve(
    S: float,
    K: float,
    r: float,
    sigma: float,
    option_type: str,
    current_dte: int,
    q: float = 0.0,
    min_days: int = 1
) -> list[Dict[str, float]]:
    """
    Generate theta values from current DTE down to min_days.
    
    Args:
        S: Spot price (current underlying price)
        K: Strike price
        r: Risk-free rate
        sigma: Volatility
        option_type: 'call' or 'put'
        current_dte: Current days to expiry
        q: Dividend yield, default 0
        min_days: Minimum days to calculate (default 1)
    
    Returns:
        List of dicts with keys: days, theta
    """
    curve = []
    max_days = max(current_dte, 1)
    
    # Generate from current DTE down to min_days
    for days in range(max_days, min_days - 1, -1):
        T = days / 365.0
        try:
            greeks = calculate_greeks(S, K, T, r, sigma, option_type, q)
            curve.append({
                "days": days,
                "theta": greeks["theta"]
            })
        except Exception:
            curve.append({
                "days": days,
                "theta": 0.0
            })
    
    return curve
