"""
Dow Theory Market Strain Calculator
Translated from ThinkScript DowTheory_MarketStrain v3.0

Calculates:
- Market Direction composite from DJI/DJT indices
- Strain score from divergence and utility outperformance
- ETF proxy direction (DIA/IYT/XLU)
- Futures proxy direction (YM/CL/ZN)
- Modern direction from ETF proxies and alignment vs classic signal
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
    
    def calculate_historical(self, days: int = 90) -> List[Dict]:
        """Calculate historical Dow Theory metrics for charting."""
        # Fetch enough history to cover the requested date range + lookback
        fetch_days = max(days + self.trend_length + 10, 120)
        # Fetch index data with actual dates
        dji_data, dji_dates = self.fetch_data("^DJI", days=fetch_days, return_dates=True)
        djt_data, djt_dates = self.fetch_data("^DJT", days=fetch_days, return_dates=True)
        dju_data, dju_dates = self.fetch_data("^DJU", days=fetch_days, return_dates=True)
        # Fetch ETF proxies for modern Dow Theory
        dia_data = self.fetch_data("DIA", days=fetch_days)
        iyt_data = self.fetch_data("IYT", days=fetch_days)
        xlu_data = self.fetch_data("XLU", days=fetch_days)
        
        if any(d is None for d in [dji_data, djt_data, dju_data]):
            return []

        has_modern_data = all(d is not None for d in [dia_data, iyt_data, xlu_data])
        series_to_align = [dji_data, djt_data]
        if has_modern_data:
            series_to_align.extend([dia_data, iyt_data, xlu_data])
        min_len = min(len(series) for series in series_to_align)
        if min_len <= self.trend_length:
            return []

        dji_data = dji_data[-min_len:]
        djt_data = djt_data[-min_len:]
        dji_dates = dji_dates[-min_len:]
        if has_modern_data:
            dia_data = dia_data[-min_len:]
            iyt_data = iyt_data[-min_len:]
            xlu_data = xlu_data[-min_len:]
        
        history = []
        cutoff = datetime.utcnow() - timedelta(days=days)
        start_idx = self.trend_length

        for i in range(start_idx, len(dji_data)):
            dia_roc = self.compute_roc(dji_data[:i+1])
            djt_roc = self.compute_roc(djt_data[:i+1])
            
            base_trend = (dia_roc + djt_roc) / 2
            
            # Simplified alignment factor
            alignment_factor = 1.0
            dir_raw = base_trend * alignment_factor

            modern_dir = None
            direction_spread = None
            if has_modern_data:
                dia_etf_roc = self.compute_roc(dia_data[:i+1])
                iyt_etf_roc = self.compute_roc(iyt_data[:i+1])
                xlu_roc = self.compute_roc(xlu_data[:i+1])
                modern_base = (dia_etf_roc + iyt_etf_roc + xlu_roc) / 3
                modern_dir = modern_base
                direction_spread = modern_dir - dir_raw
            
            # Use actual date from the data
            timestamp = dji_dates[i].to_pydatetime()
            timestamp_naive = timestamp.replace(tzinfo=None)

            if timestamp_naive < cutoff:
                continue

            history.append({
                "timestamp": timestamp_naive.isoformat(),
                "market_direction": round(dir_raw, 2),
                "modern_direction": round(modern_dir, 2) if modern_dir is not None else None,
                "direction_spread": round(direction_spread, 2) if direction_spread is not None else None,
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
        dji_roc = self.compute_roc(dji_data)
        djt_roc = self.compute_roc(djt_data)
        dju_roc = self.compute_roc(dju_data)
        
        # Calculate slopes
        dji_slope = self.compute_slope(dji_data)
        djt_slope = self.compute_slope(djt_data)
        
        # Determine trend states
        dji_up = dji_roc > 0 and dji_slope > 0
        dji_down = dji_roc < 0 and dji_slope < 0
        djt_up = djt_roc > 0 and djt_slope > 0
        djt_down = djt_roc < 0 and djt_slope < 0
        
        # Alignment score
        dia_score = 1 if dji_up else (-1 if dji_down else 0)
        djt_score = 1 if djt_up else (-1 if djt_down else 0)
        align_score = dia_score + djt_score
        
        # Strain components
        divergence = abs(dji_roc - djt_roc)
        util_outperformance = max(0, dju_roc - dji_roc)
        raw_strain = (divergence + util_outperformance) * self.strain_scale
        strain_score = min(100, raw_strain)
        
        # Market direction
        base_trend = (dji_roc + djt_roc) / 2
        
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
            h_dji_roc = self.compute_roc(dji_data[:idx] if idx < -1 else dji_data)
            h_djt_roc = self.compute_roc(djt_data[:idx] if idx < -1 else djt_data)
            h_base = (h_dji_roc + h_djt_roc) / 2
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

        modern_direction = 0.0
        modern_dir_state = "UNKNOWN"
        modern_signal_strength = "WEAK"
        modern_divergence = 0.0
        modern_defensive_outperformance = 0.0
        modern_align_score = 0
        modern_components = {
            "dia_roc": 0.0,
            "iyt_roc": 0.0,
            "xlu_roc": 0.0,
            "alignment_score": 0,
        }

        has_modern_data = all(d is not None for d in [dia_data, iyt_data, xlu_data])
        if has_modern_data:
            dia_etf_roc = self.compute_roc(dia_data)
            iyt_etf_roc = self.compute_roc(iyt_data)
            xlu_roc = self.compute_roc(xlu_data)
            modern_base = (dia_etf_roc + iyt_etf_roc + xlu_roc) / 3

            dia_etf_slope = self.compute_slope(dia_data)
            iyt_etf_slope = self.compute_slope(iyt_data)
            dia_etf_up = dia_etf_roc > 0 and dia_etf_slope > 0
            dia_etf_down = dia_etf_roc < 0 and dia_etf_slope < 0
            iyt_etf_up = iyt_etf_roc > 0 and iyt_etf_slope > 0
            iyt_etf_down = iyt_etf_roc < 0 and iyt_etf_slope < 0

            modern_align_score = (1 if dia_etf_up else (-1 if dia_etf_down else 0)) + (
                1 if iyt_etf_up else (-1 if iyt_etf_down else 0)
            )
            if modern_align_score == 2:
                modern_alignment_factor = 1.15
            elif modern_align_score == -2:
                modern_alignment_factor = 1.05
            elif modern_align_score == 0:
                modern_alignment_factor = 0.90
            else:
                modern_alignment_factor = 1.0

            modern_dir_raw = modern_base * modern_alignment_factor
            modern_history = []
            for i in range(min(self.smooth_length, len(dia_data) - self.trend_length)):
                idx = -(i + 1)
                h_dia_roc = self.compute_roc(dia_data[:idx] if idx < -1 else dia_data)
                h_iyt_roc = self.compute_roc(iyt_data[:idx] if idx < -1 else iyt_data)
                h_xlu_roc = self.compute_roc(xlu_data[:idx] if idx < -1 else xlu_data)
                h_base = (h_dia_roc + h_iyt_roc + h_xlu_roc) / 3
                modern_history.append(h_base * modern_alignment_factor)

            modern_history.reverse()
            modern_history.append(modern_dir_raw)
            modern_direction = self.exp_average(np.array(modern_history), self.smooth_length)

            if modern_direction > self.dir_threshold:
                modern_dir_state = "UP"
            elif modern_direction < -self.dir_threshold:
                modern_dir_state = "DOWN"
            else:
                modern_dir_state = "NEUTRAL"

            abs_modern = abs(modern_direction)
            if abs_modern > 2.0:
                modern_signal_strength = "STRONG"
            elif abs_modern > 1.0:
                modern_signal_strength = "MODERATE"
            else:
                modern_signal_strength = "WEAK"

            modern_divergence = abs(dia_etf_roc - iyt_etf_roc)
            modern_defensive_outperformance = max(0, xlu_roc - dia_etf_roc)
            modern_components = {
                "dia_roc": round(dia_etf_roc, 2),
                "iyt_roc": round(iyt_etf_roc, 2),
                "xlu_roc": round(xlu_roc, 2),
                "alignment_score": modern_align_score,
            }

        if has_modern_data:
            direction_spread = modern_direction - market_dir
            theory_alignment_score = max(0.0, min(100.0, 100.0 - abs(direction_spread) * 10.0))
            if theory_alignment_score >= 70:
                theory_alignment_state = "ALIGNED"
            elif theory_alignment_score >= 45:
                theory_alignment_state = "MIXED"
            else:
                theory_alignment_state = "DIVERGENT"
        else:
            direction_spread = 0.0
            theory_alignment_score = 0.0
            theory_alignment_state = "UNKNOWN"
        
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
            "modern_direction": round(modern_direction, 2),
            "modern_direction_state": modern_dir_state,
            "modern_signal_strength": modern_signal_strength,
            "modern_divergence": round(modern_divergence, 2),
            "modern_defensive_outperformance": round(modern_defensive_outperformance, 2),
            "direction_spread": round(direction_spread, 2),
            "theory_alignment_score": round(theory_alignment_score, 1),
            "theory_alignment_state": theory_alignment_state,
            "components": {
                "dji_roc": round(dji_roc, 2),
                "djt_roc": round(djt_roc, 2),
                "dju_roc": round(dju_roc, 2),
                "alignment_score": align_score
            },
            "modern_components": modern_components,
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
            "modern_direction": 0.0,
            "modern_direction_state": "UNKNOWN",
            "modern_signal_strength": "WEAK",
            "modern_divergence": 0.0,
            "modern_defensive_outperformance": 0.0,
            "direction_spread": 0.0,
            "theory_alignment_score": 0.0,
            "theory_alignment_state": "UNKNOWN",
            "components": {
                "dji_roc": 0.0,
                "djt_roc": 0.0,
                "dju_roc": 0.0,
                "alignment_score": 0
            },
            "modern_components": {
                "dia_roc": 0.0,
                "iyt_roc": 0.0,
                "xlu_roc": 0.0,
                "alignment_score": 0,
            },
        }


# Singleton instance
_calculator = None


def get_dow_theory_data() -> Dict:
    """Get current Dow Theory metrics."""
    global _calculator
    if _calculator is None:
        _calculator = DowTheoryCalculator()
    
    return _calculator.calculate()


def get_dow_theory_history(days: int = 90) -> List[Dict]:
    """Get historical Dow Theory metrics for charting."""
    global _calculator
    if _calculator is None:
        _calculator = DowTheoryCalculator()
    
    return _calculator.calculate_historical(days=days)
