"""
Dow Theory Market Strain Calculator
Translated from ThinkScript DowTheory_MarketStrain v3.0

Calculates:
- Market Direction composite from DJI/DJT indices
- Strain score from divergence and utility outperformance
- ETF proxy direction (DIA/IYT/XLU)
- Futures proxy direction (YM/CL/ZN)
"""

import yfinance as yf
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional


class DowTheoryCalculator:
    """Calculate Dow Theory metrics with market direction and strain."""
    
    def __init__(self, trend_length: int = 34, smooth_length: int = 13, strain_scale: float = 2.0):
        self.trend_length = trend_length
        self.smooth_length = smooth_length
        self.strain_scale = strain_scale
        self.dir_threshold = 0.25
        
    def fetch_data(self, symbol: str, days: int = 120, return_dates: bool = False):
        """Fetch historical closing prices for a symbol."""
        try:
            ticker = yf.Ticker(symbol)
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            hist = ticker.history(start=start_date, end=end_date)
            
            if hist.empty or len(hist) < self.trend_length:
                return None if not return_dates else (None, None)
            
            if return_dates:
                return hist['Close'].values, hist.index
            return hist['Close'].values
        except Exception as e:
            print(f"Error fetching {symbol}: {e}")
            return None if not return_dates else (None, None)
    
    def compute_roc(self, prices: np.ndarray) -> float:
        """Calculate rate of change over trend_length period."""
        if len(prices) < self.trend_length + 1:
            return 0.0
        
        current = prices[-1]
        past = prices[-(self.trend_length + 1)]
        
        if past == 0 or np.isnan(current) or np.isnan(past):
            return 0.0
        
        return ((current - past) / past) * 100
    
    def compute_slope(self, prices: np.ndarray) -> float:
        """Calculate slope of moving average."""
        if len(prices) < self.trend_length + 1:
            return 0.0
        
        ma = np.convolve(prices, np.ones(self.trend_length) / self.trend_length, mode='valid')
        
        if len(ma) < 2:
            return 0.0
        
        return ma[-1] - ma[-2]
    
    def exp_average(self, values: np.ndarray, length: int) -> float:
        """Calculate exponential moving average."""
        if len(values) == 0:
            return 0.0
        
        alpha = 2 / (length + 1)
        ema = values[0]
        
        for val in values[1:]:
            if not np.isnan(val):
                ema = alpha * val + (1 - alpha) * ema
        
        return ema
    
    def calculate_historical(self) -> List[Dict]:
        """Calculate historical Dow Theory metrics for charting."""
        # Fetch index data with actual dates
        dji_data, dji_dates = self.fetch_data("^DJI", return_dates=True)
        djt_data, djt_dates = self.fetch_data("^DJT", return_dates=True)
        dju_data, dju_dates = self.fetch_data("^DJU", return_dates=True)
        
        if any(d is None for d in [dji_data, djt_data, dju_data]):
            return []
        
        # Calculate for last 90 data points (or available data)
        history = []
        num_points = min(90, len(dji_data) - self.trend_length)
        start_idx = len(dji_data) - num_points
        
        for i in range(start_idx, len(dji_data)):
            dia_roc = self.compute_roc(dji_data[:i+1])
            djt_roc = self.compute_roc(djt_data[:i+1])
            
            base_trend = (dia_roc + djt_roc) / 2
            
            # Simplified alignment factor
            alignment_factor = 1.0
            dir_raw = base_trend * alignment_factor
            
            # Use actual date from the data
            timestamp = dji_dates[i].to_pydatetime()
            
            history.append({
                "timestamp": timestamp.isoformat(),
                "market_direction": round(dir_raw, 2),
            })
        
        return history
    
    def calculate(self) -> Dict:
        """Calculate all Dow Theory metrics."""
        # Fetch index data
        dji_data = self.fetch_data("^DJI")  # Dow Jones Industrials
        djt_data = self.fetch_data("^DJT")  # Dow Jones Transports
        dju_data = self.fetch_data("^DJU")  # Dow Jones Utilities
        
        # Fetch ETF proxies
        dia_data = self.fetch_data("DIA")   # SPDR Dow Jones Industrial Average ETF
        iyt_data = self.fetch_data("IYT")   # iShares Transportation Average ETF
        xlu_data = self.fetch_data("XLU")   # Utilities Select Sector SPDR Fund
        
        # Fetch futures proxies
        ym_data = self.fetch_data("YM=F")   # Mini Dow Futures
        cl_data = self.fetch_data("CL=F")   # Crude Oil Futures
        zn_data = self.fetch_data("ZN=F")   # 10-Year T-Note Futures
        
        has_data = all(d is not None for d in [dji_data, djt_data, dju_data])
        
        if not has_data:
            return self._empty_result()
        
        # Calculate ROCs
        dia_roc = self.compute_roc(dji_data)
        djt_roc = self.compute_roc(djt_data)
        dju_roc = self.compute_roc(dju_data)
        
        # Calculate slopes
        dia_slope = self.compute_slope(dji_data)
        djt_slope = self.compute_slope(djt_data)
        
        # Determine trend states
        dia_up = dia_roc > 0 and dia_slope > 0
        dia_down = dia_roc < 0 and dia_slope < 0
        djt_up = djt_roc > 0 and djt_slope > 0
        djt_down = djt_roc < 0 and djt_slope < 0
        
        # Alignment score
        dia_score = 1 if dia_up else (-1 if dia_down else 0)
        djt_score = 1 if djt_up else (-1 if djt_down else 0)
        align_score = dia_score + djt_score
        
        # Strain components
        divergence = abs(dia_roc - djt_roc)
        util_outperformance = max(0, dju_roc - dia_roc)
        raw_strain = (divergence + util_outperformance) * self.strain_scale
        strain_score = min(100, raw_strain)
        
        # Market direction
        base_trend = (dia_roc + djt_roc) / 2
        
        # Alignment factor
        if align_score == 2:
            alignment_factor = 1.15
        elif align_score == -2:
            alignment_factor = 1.05
        elif align_score == 0:
            alignment_factor = 0.90
        else:
            alignment_factor = 1.0
        
        dir_raw = base_trend * alignment_factor
        
        # Smoothed market direction (using historical ROCs)
        historical_rocs = []
        for i in range(min(self.smooth_length, len(dji_data) - self.trend_length)):
            idx = -(i + 1)
            h_dia_roc = self.compute_roc(dji_data[:idx] if idx < -1 else dji_data)
            h_djt_roc = self.compute_roc(djt_data[:idx] if idx < -1 else djt_data)
            h_base = (h_dia_roc + h_djt_roc) / 2
            historical_rocs.append(h_base * alignment_factor)
        
        historical_rocs.reverse()
        historical_rocs.append(dir_raw)
        market_dir = self.exp_average(np.array(historical_rocs), self.smooth_length)
        
        # ETF direction
        etf_dir = None
        if dia_data is not None and iyt_data is not None:
            dia_etf_roc = self.compute_roc(dia_data)
            iyt_etf_roc = self.compute_roc(iyt_data)
            etf_base = (dia_etf_roc + iyt_etf_roc) / 2
            etf_dir = etf_base  # Simplified, could add smoothing
        
        # Futures direction
        fut_dir = None
        if ym_data is not None and cl_data is not None and zn_data is not None:
            ym_roc = self.compute_roc(ym_data)
            cl_roc = self.compute_roc(cl_data)
            zn_roc = self.compute_roc(zn_data)
            fut_base = (ym_roc + cl_roc - zn_roc) / 3
            fut_dir = fut_base  # Simplified, could add smoothing
        
        # Direction state
        if market_dir > self.dir_threshold:
            dir_state = "UP"
        elif market_dir < -self.dir_threshold:
            dir_state = "DOWN"
        else:
            dir_state = "NEUTRAL"
        
        # Confirmation state
        bull_confirm = dia_up and djt_up
        bear_confirm = dia_down and djt_down
        
        if bull_confirm:
            confirm_state = "BULL"
        elif bear_confirm:
            confirm_state = "BEAR"
        else:
            confirm_state = "MIXED"
        
        # Strain level
        if strain_score < 25:
            strain_level = "LOW"
        elif strain_score < 50:
            strain_level = "MODERATE"
        elif strain_score < 75:
            strain_level = "HIGH"
        else:
            strain_level = "CRITICAL"
        
        # Signal strength
        abs_dir = abs(market_dir)
        if abs_dir > 2.0:
            signal_strength = "STRONG"
        elif abs_dir > 1.0:
            signal_strength = "MODERATE"
        else:
            signal_strength = "WEAK"
        
        return {
            "timestamp": datetime.now().isoformat(),
            "market_direction": round(market_dir, 2),
            "direction_state": dir_state,
            "signal_strength": signal_strength,
            "confirmation_state": confirm_state,
            "strain_score": round(strain_score, 1),
            "strain_level": strain_level,
            "divergence": round(divergence, 2),
            "util_outperformance": round(util_outperformance, 2),
            "etf_direction": round(etf_dir, 2) if etf_dir is not None else None,
            "futures_direction": round(fut_dir, 2) if fut_dir is not None else None,
            "components": {
                "dji_roc": round(dia_roc, 2),
                "djt_roc": round(djt_roc, 2),
                "dju_roc": round(dju_roc, 2),
                "alignment_score": align_score
            }
        }
    
    def _empty_result(self) -> Dict:
        """Return empty result structure when data is unavailable."""
        return {
            "timestamp": datetime.now().isoformat(),
            "market_direction": 0.0,
            "direction_state": "UNKNOWN",
            "signal_strength": "WEAK",
            "confirmation_state": "MIXED",
            "strain_score": 0.0,
            "strain_level": "UNKNOWN",
            "divergence": 0.0,
            "util_outperformance": 0.0,
            "etf_direction": None,
            "futures_direction": None,
            "components": {
                "dji_roc": 0.0,
                "djt_roc": 0.0,
                "dju_roc": 0.0,
                "alignment_score": 0
            }
        }


# Singleton instance
_calculator = None


def get_dow_theory_data() -> Dict:
    """Get current Dow Theory metrics."""
    global _calculator
    if _calculator is None:
        _calculator = DowTheoryCalculator()
    
    return _calculator.calculate()


def get_dow_theory_history() -> List[Dict]:
    """Get historical Dow Theory metrics for charting."""
    global _calculator
    if _calculator is None:
        _calculator = DowTheoryCalculator()
    
    return _calculator.calculate_historical()
