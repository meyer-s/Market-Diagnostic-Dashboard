# Continuation Notes - Market Diagnostic Dashboard

Date: 2026-01-19
Branch: inspector
Last commit: 7755da6 ("Show full cards on hover with smooth expansions")

Current state
- REST is abstracted with mini charts + accent bars.
- Hover/focus shows full card content with height-lerp + fade-in.
- Click navigates to detail pages where applicable.
- Chart animations use CHART_ANIMATION easing/duration.
- Deployed to server and rebuilt with docker compose.

Key files touched in recent session
- frontend/src/components/widgets/SystemOverviewWidget.tsx
- frontend/src/components/widgets/DowTheoryWidget.tsx
- frontend/src/components/widgets/SectorDivergenceWidget.tsx
- frontend/src/components/widgets/AASWidget.tsx
- frontend/src/components/widgets/IndicatorCard.tsx
- frontend/src/pages/Dashboard.tsx
- frontend/src/utils/chartUtils.ts
- frontend/src/pages/IndicatorDetail.tsx
- frontend/src/pages/SectorProjections.tsx

Open tasks (next session)
- Implement global Expanded-All view as forced FOCUS across ALL pages.
  - Add shared state (context/store) to force FOCUS on cards.
  - Hook into useProgressiveCommitment to override state (rest -> focus).
- Finish System Breakdown refactor (REST signal only; move long copy to CLICK; remove hover-only tooltips).
- Archive bloat files (do not delete) + add archive/README.md and docs/cleanup-notes.md.
- Finalize API contract standardization and update docs/api-contract.md.
- Add 3-5 integration improvements (shared data freshness, error states, time-range sync, etc).
- Update frontend/docs/empathy-report.md to reflect final structure.

Color/contrast audit
- Ensure metric family colors are consistent across charts.
- Fix metals color inconsistencies (same metal color everywhere).
- Review low-contrast pairs and adjust metricColors palette.

Server notes
- SSH: ssh -i "C:\TempSSH\LightsailDefaultKey-us-east-1.pem" ubuntu@100.49.90.221
- Repo: /home/ubuntu/Market-Diagnostic-Dashboard (branch inspector)
- Docker: sudo docker compose up -d --build
- Backend health: http://127.0.0.1:8000/health (redirects, use -L)
- Frontend: https://www.marketdiagnostictool.com
- /api/health on www not proxied (serves frontend HTML). Consider nginx proxy pass.
