# Frontend bundle budgets

`npm run build` runs `check-bundle-budget.mjs` after Vite and fails the release
when any budget is exceeded. `npm run check:bundle-budget` can recheck an
existing `dist` directory without rebuilding.

| Asset group | Raw limit | Gzip limit |
| --- | ---: | ---: |
| Initial JavaScript, including module preloads | 500 KiB | 160 KiB |
| Initial CSS | 200 KiB | 40 KiB |
| Each deferred JavaScript chunk | 350 KiB | 110 KiB |

The check also requires every supported page module to be emitted as a deferred
route chunk. That protects the route boundaries from being accidentally
collapsed back into the entry bundle.

The full-site audit baseline was 1,527.42 kB raw / 412.13 kB gzip for the
initial JavaScript bundle. The first route-split build measured 188.60 kB raw /
61.67 kB gzip in Vite's build report, an 87.7% raw and 85.0% gzip reduction.
