# Volatility, Market-Time, and Option-Time Pricing

Dan,

The clean way to think about this is:

> Volatility is the clock speed of variance-time.
> Options do not price calendar time alone. They price expected future variance across calendar time.

```text
realized variance-time = accumulated realized variance
priced future variance-time = implied variance x time
```

## 1. Price to Returns

```text
r_t = ln(P_t / P_{t-1})
```

Where:

```text
P_t       = current price
P_{t-1}   = prior price
r_t       = log return
```

Price is converted into a series of proportional changes.

## 2. Realized Variance

```text
RV_N = sum(r_t^2)
```

Realized variance is accumulated squared movement over `N` periods.

```text
higher RV = more variance-time occurred
lower RV  = less variance-time occurred
```

This is the "market-time" that actually happened.

## 3. Realized Volatility

```text
sigma_realized = sqrt(RV_N / N)
```

Annualized historical volatility is usually:

```text
HV_N = stdev(r_t over N trading days) x sqrt(252)
```

Volatility is not time itself. It is the rate at which variance accumulates through time.

## 4. Calendar Time

```text
T = DTE / 365
```

or, when using trading-day conventions:

```text
T = trading days to expiration / 252
```

Calendar time is the container. Variance is what options are actually pricing.

The key is consistency: if IV is annualized, `T` must be expressed in years using the same convention.

## 5. Implied Variance

```text
Implied Variance = IV^2 x T
```

Where:

```text
IV = annualized implied volatility
T  = time to expiration in years
```

This is the core option-time equation.

An option's implied volatility becomes economically meaningful when converted into total implied variance over the life of the option.

## 6. Expected Move

```text
Expected Move ~= S x IV x sqrt(T)
```

Where:

```text
S  = current underlying price
IV = annualized implied volatility
T  = time to expiration in years
```

This converts implied volatility into an approximate one-standard-deviation price range.

## 7. Forward Volatility Between Expirations

```text
Forward Variance = (IV_2^2 x T_2 - IV_1^2 x T_1) / (T_2 - T_1)
```

```text
Forward IV = sqrt(Forward Variance)
```

This isolates the volatility priced between two expiration dates.

It answers:

```text
How much variance is the market pricing specifically between expiration 1 and expiration 2?
```

## 8. Variance Consumed

```text
Variance Consumed = RV_realized / (IV^2 x T)
```

Interpretation:

```text
< 1  = realized movement has been less than priced variance
> 1  = realized movement has exceeded priced variance
```

This only works when the numerator and denominator use comparable horizons.

For example:

```text
realized variance since trade entry
vs
implied variance priced over that same elapsed window
```

or:

```text
trailing realized variance over N days
vs
implied variance for an equivalent N-day horizon
```

This measures whether priced uncertainty is being used faster or slower than expected.

## 9. Variance Carry

```text
Variance Carry = IV^2 - HV^2
```

Interpretation:

```text
IV^2 > HV^2  = options price more variance than recent history
IV^2 < HV^2  = options price less variance than recent history
```

Variance carry compares implied variance to realized variance.

This is more precise than comparing IV to HV directly because options are fundamentally variance instruments.

## 10. Implied Variance Premium

```text
Implied Variance Premium = IV^2 x T - E[RV_future]
```

Interpretation:

```text
IV^2 x T > E[RV_future]  = options may be expensive relative to forecast variance
IV^2 x T < E[RV_future]  = options may be cheap relative to forecast variance
```

This is the scanner-level comparison.

Use "premium" rather than "mispricing" unless we have high confidence in the future realized variance estimate. Options can trade rich for valid reasons:

```text
earnings
macro events
jump risk
skew
liquidity
crash premium
positioning
dealer hedging pressure
```

## 11. Sweep Bot Interpretation

For the options sweep bot, a sweep should not be read only as directional call or put flow.

A large option buy is also a bet on the amount and speed of future movement.

```text
Sweep premium
-> option IV
-> implied variance
-> priced movement budget
-> compare against realized and forecast variance
```

The bot should ask:

```text
How much variance did the buyer pay for?
How much realized variance has the underlying recently produced?
How much future variance is plausible over the option's life?
Is the sweep paying a fair price for movement, or overpaying for time?
```

## Final Form

```text
Price Path
-> Returns
-> Realized Variance
-> Realized Variance-Time
```

```text
Option Price
-> Implied Volatility
-> Implied Variance
-> Priced Future Variance-Time
```

Core comparison:

```text
sum(r_t^2) vs IV^2 x T
```

Equivalent framing:

```text
realized variance-time vs priced future variance-time
```

## One-Line Summary

Volatility is the clock speed of variance-time. Options price expected future variance-time, not calendar time alone.
