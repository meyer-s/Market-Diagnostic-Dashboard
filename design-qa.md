# Option list and rail mobile-width design QA

- Source visual truth: mobile conversation screenshot supplied July 15, 2026 (not exposed as a local file)
- Implementation screenshot: unavailable; no approved browser capture was available in this run
- Viewport: narrow mobile layout shown at approximately 2x device pixel density; implementation viewport not captured
- State: open-position list with timeline rails and one selected row

## Full-view comparison evidence

The source screenshot shows the fixed 155px identity column consuming roughly half of each mobile row and compressing the useful timeline. The implementation now uses a 120px identity track and tighter mobile padding/gaps, returning the recovered width to the rail. At `sm` and above, the established 155px and desktop layouts are unchanged. The implementation could not be rendered and captured with the approved browser workflow, so no same-viewport side-by-side comparison is available.

## Focused region comparison evidence

Blocked for the same reason. Code inspection confirms that the header and every data row use the same responsive tracks, so labels and rails remain aligned, but code inspection is not visual evidence.

## Findings

- [P1] Visual verification is blocked.
  - Location: position list at the mobile breakpoint.
  - Evidence: the source screenshot is visible only in the conversation, and no browser-rendered implementation screenshot was captured.
  - Impact: marker weight, outline contrast, and overlap behavior cannot be judged at the target viewport.
  - Fix: capture the deployed selected-row state in the user's chosen browser and compare it with the source screenshot.

## Required fidelity surfaces

- Fonts and typography: unchanged; not browser-verified.
- Spacing and layout rhythm: mobile identity width changes from 155px to 120px, the column gap from 8px to 6px, and horizontal row padding from 8px to 6px; not browser-verified.
- Colors and visual tokens: existing gray, sky, emerald, rose, amber, and slate tokens are reused; contrast is not browser-verified.
- Image quality and asset fidelity: no raster assets were added; the rail remains a native data visualization.
- Copy and content: the rail legend and accessible summary retain their current terminology; the refresh action uses Refreshing and Updated states.

## Comparison history

- Initial source finding: the timeline rail is unnecessarily narrow on mobile because the fixed identity column and desktop-like spacing consume too much of the row.
- Fixes made: reduced only the mobile identity track and spacing, preserving the existing `sm` and desktop grids and all timeline behavior.
- Post-fix visual evidence: unavailable.

## Implementation checklist

- Capture the deployed list at a 390px-wide viewport and the source selected-row state.
- Verify the timeline gains visible width without hiding the symbol or making contract text misleading.
- Verify header and row columns remain aligned.
- Verify there is no horizontal page overflow at 360px and 390px.
- Verify the existing `sm`, tablet, and desktop layouts are unchanged.

final result: blocked
