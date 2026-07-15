# Option list and rail design QA

- Source visual truth: conversation screenshot supplied July 15, 2026 (not exposed as a local file)
- Implementation screenshot: unavailable; no approved browser capture was available in this run
- Viewport: source screenshot approximately 2048 x 1114; implementation viewport not captured
- State: options portfolio rail with SJM selected and decision evidence expanded

## Full-view comparison evidence

The source screenshots and follow-up critique were inspected in the conversation. They show editing controls overpowering the selected interval and historical windows appearing only after interaction. The implementation could not be rendered and captured with the approved browser workflow, so no same-viewport side-by-side comparison is available.

## Focused region comparison evidence

Blocked for the same reason. The coded change restores a stronger filled active interval, lowers bracket and marker contrast until interaction, loads all historical ranges through one compact request, and adds a list-level refresh state in the existing summary header, but code inspection is not visual evidence.

## Findings

- [P1] Visual verification is blocked.
  - Location: position timeline rail.
  - Evidence: the source screenshot is visible only in the conversation, and no browser-rendered implementation screenshot was captured.
  - Impact: marker weight, outline contrast, and overlap behavior cannot be judged at the target viewport.
  - Fix: capture the deployed selected-row state in the user's chosen browser and compare it with the source screenshot.

## Required fidelity surfaces

- Fonts and typography: unchanged; not browser-verified.
- Spacing and layout rhythm: every rail uses the same compact height; not browser-verified.
- Colors and visual tokens: existing gray, sky, emerald, rose, amber, and slate tokens are reused; contrast is not browser-verified.
- Image quality and asset fidelity: no raster assets were added; the rail remains a native data visualization.
- Copy and content: the rail legend and accessible summary retain their current terminology; the refresh action uses Refreshing and Updated states.

## Comparison history

- Initial source finding: brackets and vertical markers carry more visual weight than the selected interval, while history depends on hover or selection.
- Fixes made: strengthened the active filled interval, returned all rails to one compact height, converted history from dashed editing outlines to quiet translucent onion skins, reduced bracket and marker opacity until interaction, loaded every stored historical range in one compact batch request, and added a forced whole-list refresh with an amber pending rail and brief green settled state.
- Post-fix visual evidence: unavailable.

## Implementation checklist

- Capture the deployed rail at the source viewport and selected-row state.
- Verify the active interval reads first at a glance and the brackets recede when idle.
- Verify every stored onion-skin range appears without hover and remains distinguishable when dates overlap.
- Verify hover and selection increase control contrast without changing rail geometry.
- Verify the refresh button, amber pending rail, and green settled state are legible without competing with portfolio metrics.
- Check hover titles and narrow or reversed historical windows.

final result: blocked
