# Real Estate Page Outline

Purpose:
- Build a real-estate diagnostic page that feels consistent with Energy and Agriculture: one top-level read, a small set of causal charts, then slower structural context underneath.
- Keep the first version grounded in liquid public proxies and macro series before adding deeper property-level data.

Primary questions the page should answer:
- Is real estate under financing pressure or benefiting from easing conditions?
- Is stress showing up more in residential demand, commercial property, or listed real-estate equities?
- Are rates, credit spreads, and construction/supply data confirming the same regime?

Suggested page hierarchy:

1. Snapshot band
- Real Estate Pressure Score: 0-100 composite summarizing rates, affordability, credit, and listed-market breadth.
- Regime label: financing easing, financing stress, late-cycle squeeze, or mixed stabilization.
- Three high-signal tiles:
  - Affordability read: mortgage rate plus payment burden direction.
  - Financing read: REIT performance versus Treasury and credit backdrop.
  - Segment leadership: residential, commercial, or financing proxies leading/lagging.

2. Primary relationship band
- Mortgage pressure vs housing demand:
  - 30Y mortgage rate, payment proxy, and home-sales/homebuilder proxy in one chart.
  - Goal: show whether financing costs are overwhelming demand.
- Listed real-estate regime:
  - Composite history plus a radar or compact factor panel.
  - Factors can include REITs, homebuilders, mortgage spreads, regional-bank sensitivity, and construction inputs.

3. Market structure band
- Real-estate proxy table:
  - Residential/homebuilders: XHB, ITB.
  - Broad/listed REITs: VNQ, IYR, XLRE.
  - Commercial office stress proxy: a focused office REIT basket or representative names if coverage is reliable.
  - Financing sensitivity: KRE or bank-exposure proxy if used carefully.
- Group cards:
  - Residential demand.
  - Listed REITs.
  - Commercial/office stress.
  - Financing/credit transmission.

4. Transmission band
- Rates -> payments -> equities:
  - 10Y yield / 30Y mortgage / homebuilder ETF or home-sales proxy.
- Credit -> cap-rate pressure:
  - REIT ETF versus HY OAS / IG spreads or a real-estate credit proxy.
- Optional rental pressure panel:
  - Shelter CPI or rent inflation versus wage growth if the data stays clean and interpretable.

5. Longer-horizon context band
- Supply and construction:
  - Housing starts, building permits, completions.
- Price and affordability:
  - Case-Shiller or FHFA price index, payment burden proxy, mortgage applications.
- Segment context:
  - Residential versus commercial split with short notes on what is structural versus cyclical.

Suggested first-pass data sources:
- FRED:
  - 30-year mortgage rate.
  - 10Y Treasury yield.
  - Mortgage applications or home-sales proxies where available.
  - Housing starts, permits, completions.
  - House-price indexes and shelter/rent inflation series.
  - Credit spread series already used elsewhere in the project when relevant.
- Yahoo Finance:
  - VNQ, IYR, XLRE, XHB, ITB, KRE, and any approved office/property-type proxies.
- Existing internal market series:
  - Credit stress, rates, liquidity, and regional-bank context if already available through current services.

Composite design suggestion:
- 35% financing pressure:
  - mortgage rate level/trend, Treasury drift, credit-spread contribution.
- 30% listed-market confirmation:
  - REIT/homebuilder breadth and medium-term momentum.
- 20% demand and affordability:
  - payment burden, applications, sales trend.
- 15% supply balance:
  - starts/permits/completions relative trend.

Frontend shape:
- Follow the same ordering now used on the Energy page:
  - hero snapshot
  - primary relationship band
  - market structure band
  - transmission band
  - longer-horizon context band
- Reuse existing classes:
  - page-shell-wide
  - page-stack
  - surface-card
  - surface-card-strong or primary-card for the top band
  - page-badge and control-strip for meta state

Backend/API outline:
- `GET /real-estate/overview`
  - snapshot score, regime, summary, group scores, symbol table.
- `GET /real-estate/history`
  - composite history, factor history, optional radar history.
- `GET /real-estate/transmission`
  - mortgage rates, yields, price/payment proxies, credit overlays.
- `GET /real-estate/context`
  - longer-horizon housing supply, pricing, and affordability series.

Implementation order:
1. Build the overview payload and listed proxy table first.
2. Add the mortgage-pressure relationship chart.
3. Add grouped market-structure cards.
4. Add supply/affordability context.
5. Add deeper commercial-property slices only after the first version reads cleanly.

Guardrails:
- Keep the first version focused on interpretable public series.
- Avoid mixing residential and commercial narratives unless the module explicitly explains the difference.
- Make the page answer a small number of causal questions quickly instead of becoming a housing data dump.