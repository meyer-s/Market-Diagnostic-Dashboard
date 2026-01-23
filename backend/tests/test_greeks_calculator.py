"""
Tests for Greeks Calculator

Validates Greeks calculations against known reference values.
Uses values computed from external Black-Scholes calculators to verify accuracy.
"""

import pytest
import math
from app.services.greeks_calculator import (
    calculate_greeks,
    black_scholes_price,
    implied_volatility,
    generate_delta_gamma_curve,
    generate_theta_curve
)


class TestBlackScholesPrice:
    """Test option pricing calculations."""
    
    def test_atm_call(self):
        """Test ATM call option pricing."""
        # S=100, K=100, T=1 year, r=5%, sigma=20%
        price = black_scholes_price(
            S=100.0,
            K=100.0,
            T=1.0,
            r=0.05,
            sigma=0.20,
            option_type='call'
        )
        # Reference value from standard BS calculator: ~10.45
        assert 10.0 < price < 11.0
        
    def test_atm_put(self):
        """Test ATM put option pricing."""
        price = black_scholes_price(
            S=100.0,
            K=100.0,
            T=1.0,
            r=0.05,
            sigma=0.20,
            option_type='put'
        )
        # Put-call parity: P = C - S + K*e^(-rT)
        # Reference value: ~5.57
        assert 5.0 < price < 6.5
    
    def test_itm_call(self):
        """Test ITM call option pricing."""
        price = black_scholes_price(
            S=110.0,
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.25,
            option_type='call'
        )
        # ITM call should have at least intrinsic value
        assert price >= 10.0
        assert price > 10.0  # Should have time value


class TestGreeksCalculation:
    """Test Greeks calculations."""
    
    def test_atm_call_delta(self):
        """ATM call delta should be around 0.5."""
        greeks = calculate_greeks(
            S=100.0,
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.30,
            option_type='call'
        )
        # ATM call delta ~0.5-0.55 depending on r
        assert 0.48 < greeks['delta'] < 0.60
    
    def test_atm_put_delta(self):
        """ATM put delta should be around -0.5."""
        greeks = calculate_greeks(
            S=100.0,
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.30,
            option_type='put'
        )
        # ATM put delta ~-0.5 to -0.45
        assert -0.55 < greeks['delta'] < -0.42
    
    def test_itm_call_delta(self):
        """Deep ITM call delta should approach 1.0."""
        greeks = calculate_greeks(
            S=120.0,
            K=100.0,
            T=0.25,
            r=0.05,
            sigma=0.25,
            option_type='call'
        )
        # Deep ITM delta should be high
        assert greeks['delta'] > 0.85
    
    def test_otm_call_delta(self):
        """Deep OTM call delta should approach 0."""
        greeks = calculate_greeks(
            S=80.0,
            K=100.0,
            T=0.25,
            r=0.05,
            sigma=0.25,
            option_type='call'
        )
        # Deep OTM delta should be low
        assert greeks['delta'] < 0.15
    
    def test_gamma_symmetry(self):
        """Gamma should be the same for calls and puts."""
        call_greeks = calculate_greeks(
            S=100.0,
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.30,
            option_type='call'
        )
        put_greeks = calculate_greeks(
            S=100.0,
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.30,
            option_type='put'
        )
        # Gamma should be identical
        assert abs(call_greeks['gamma'] - put_greeks['gamma']) < 1e-10
    
    def test_gamma_peak_at_atm(self):
        """Gamma should be highest ATM."""
        atm_gamma = calculate_greeks(
            S=100.0, K=100.0, T=0.5, r=0.05, sigma=0.30, option_type='call'
        )['gamma']
        
        itm_gamma = calculate_greeks(
            S=110.0, K=100.0, T=0.5, r=0.05, sigma=0.30, option_type='call'
        )['gamma']
        
        otm_gamma = calculate_greeks(
            S=90.0, K=100.0, T=0.5, r=0.05, sigma=0.30, option_type='call'
        )['gamma']
        
        # ATM should have highest gamma
        assert atm_gamma > itm_gamma
        assert atm_gamma > otm_gamma
    
    def test_theta_negative_for_long(self):
        """Theta should be negative for long options (time decay)."""
        greeks = calculate_greeks(
            S=100.0,
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.30,
            option_type='call'
        )
        # Theta should be negative (time decay)
        assert greeks['theta'] < 0
    
    def test_theta_increases_near_expiry(self):
        """Theta should be more negative (faster decay) closer to expiry."""
        far_theta = calculate_greeks(
            S=100.0, K=100.0, T=1.0, r=0.05, sigma=0.30, option_type='call'
        )['theta']
        
        near_theta = calculate_greeks(
            S=100.0, K=100.0, T=0.1, r=0.05, sigma=0.30, option_type='call'
        )['theta']
        
        # Near expiry theta should be more negative (absolute value larger)
        assert abs(near_theta) > abs(far_theta)
    
    def test_vega_positive(self):
        """Vega should be positive (higher vol = higher option value)."""
        greeks = calculate_greeks(
            S=100.0,
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.30,
            option_type='call'
        )
        assert greeks['vega'] > 0
    
    def test_vega_highest_atm(self):
        """Vega should be highest ATM."""
        atm_vega = calculate_greeks(
            S=100.0, K=100.0, T=0.5, r=0.05, sigma=0.30, option_type='call'
        )['vega']
        
        itm_vega = calculate_greeks(
            S=110.0, K=100.0, T=0.5, r=0.05, sigma=0.30, option_type='call'
        )['vega']
        
        assert atm_vega > itm_vega


class TestImpliedVolatility:
    """Test IV inversion."""
    
    def test_iv_inversion_call(self):
        """Test that IV inversion recovers the original volatility."""
        sigma_true = 0.30
        price = black_scholes_price(
            S=100.0, K=100.0, T=0.5, r=0.05, sigma=sigma_true, option_type='call'
        )
        
        iv = implied_volatility(
            market_price=price,
            S=100.0,
            K=100.0,
            T=0.5,
            r=0.05,
            option_type='call'
        )
        
        # Should recover original volatility within tolerance
        assert iv is not None
        assert abs(iv - sigma_true) < 0.001
    
    def test_iv_inversion_put(self):
        """Test IV inversion for put options."""
        sigma_true = 0.25
        price = black_scholes_price(
            S=100.0, K=100.0, T=1.0, r=0.05, sigma=sigma_true, option_type='put'
        )
        
        iv = implied_volatility(
            market_price=price,
            S=100.0,
            K=100.0,
            T=1.0,
            r=0.05,
            option_type='put'
        )
        
        assert iv is not None
        assert abs(iv - sigma_true) < 0.001
    
    def test_iv_rejects_arbitrage(self):
        """IV inversion should return None for arbitrage prices."""
        # Call price below intrinsic value
        iv = implied_volatility(
            market_price=5.0,  # Too low for S=110, K=100
            S=110.0,
            K=100.0,
            T=0.5,
            r=0.05,
            option_type='call'
        )
        assert iv is None


class TestCurveGeneration:
    """Test curve generation functions."""
    
    def test_delta_gamma_curve_length(self):
        """Test that curve has correct number of points."""
        curve = generate_delta_gamma_curve(
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.30,
            option_type='call',
            current_price=100.0,
            num_points=51
        )
        assert len(curve) == 51
    
    def test_delta_gamma_curve_range(self):
        """Test that curve covers correct price range."""
        curve = generate_delta_gamma_curve(
            K=100.0,
            T=0.5,
            r=0.05,
            sigma=0.30,
            option_type='call',
            current_price=100.0,
            price_range_pct=0.3,
            num_points=51
        )
        # Should go from 70 to 130
        assert curve[0]['price'] == pytest.approx(70.0, abs=1.0)
        assert curve[-1]['price'] == pytest.approx(130.0, abs=1.0)
    
    def test_theta_curve_descending(self):
        """Test that theta curve goes from high DTE to low."""
        curve = generate_theta_curve(
            S=100.0,
            K=100.0,
            r=0.05,
            sigma=0.30,
            option_type='call',
            current_dte=30,
            min_days=1
        )
        # Should have 30 points (30 down to 1)
        assert len(curve) == 30
        # First point should be highest DTE
        assert curve[0]['days'] == 30
        # Last point should be 1 day
        assert curve[-1]['days'] == 1
        # Days should be descending
        for i in range(len(curve) - 1):
            assert curve[i]['days'] > curve[i+1]['days']


class TestEdgeCases:
    """Test edge cases and error handling."""
    
    def test_zero_time_returns_zeros(self):
        """Zero time to expiry should return zero Greeks."""
        greeks = calculate_greeks(
            S=100.0, K=100.0, T=0.0, r=0.05, sigma=0.30, option_type='call'
        )
        assert greeks['delta'] == 0.0
        assert greeks['gamma'] == 0.0
        assert greeks['theta'] == 0.0
    
    def test_zero_volatility_returns_zeros(self):
        """Zero volatility should return zero Greeks."""
        greeks = calculate_greeks(
            S=100.0, K=100.0, T=0.5, r=0.05, sigma=0.0, option_type='call'
        )
        assert greeks['delta'] == 0.0
    
    def test_negative_price_returns_zeros(self):
        """Negative spot price should return zeros."""
        greeks = calculate_greeks(
            S=-100.0, K=100.0, T=0.5, r=0.05, sigma=0.30, option_type='call'
        )
        assert greeks['delta'] == 0.0


class TestRealWorldScenarios:
    """Test with real-world option parameters."""
    
    def test_ktos_call(self):
        """Test with KTOS 125C parameters."""
        # KTOS: S~113.85, K=125, T~56 days, sigma~0.35 (estimated)
        greeks = calculate_greeks(
            S=113.85,
            K=125.0,
            T=56/365.0,
            r=0.0425,
            sigma=0.35,
            option_type='call'
        )
        # Should be OTM with moderate delta
        assert 0.3 < greeks['delta'] < 0.6
        assert greeks['gamma'] > 0
        assert greeks['theta'] < 0
    
    def test_neog_itm_call(self):
        """Test with NEOG 10C ITM parameters."""
        # NEOG: S~9.93, K=10, T~56 days
        greeks = calculate_greeks(
            S=9.93,
            K=10.0,
            T=56/365.0,
            r=0.0425,
            sigma=0.40,
            option_type='call'
        )
        # Near ATM, should have significant delta
        assert 0.35 < greeks['delta'] < 0.65
    
    def test_eras_deep_itm_call(self):
        """Test with ERAS 7.5C deep ITM parameters."""
        # ERAS: S~10.29, K=7.5, T~28 days
        greeks = calculate_greeks(
            S=10.29,
            K=7.5,
            T=28/365.0,
            r=0.0425,
            sigma=0.45,
            option_type='call'
        )
        # Deep ITM should have high delta
        assert greeks['delta'] > 0.75
        # But should not be exactly 1.0 with time remaining
        assert greeks['delta'] < 0.99
    
    def test_nke_near_atm_call(self):
        """Test with NKE 65C near ATM parameters."""
        # NKE: S~65.46, K=65, T~28 days
        greeks = calculate_greeks(
            S=65.46,
            K=65.0,
            T=28/365.0,
            r=0.0425,
            sigma=0.30,
            option_type='call'
        )
        # Slightly ITM, should have good delta
        assert 0.5 < greeks['delta'] < 0.75
        # ATM should have visible gamma
        assert greeks['gamma'] > 0.01


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
