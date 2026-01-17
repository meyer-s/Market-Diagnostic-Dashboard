# Responsive Design Test Checklist

## Test Date: January 5, 2026

### Device Breakpoints to Test
- [ ] Mobile (320px - 480px) - iPhone SE, small phones
- [ ] Mobile Large (481px - 767px) - iPhone 12/13/14, standard phones
- [ ] Tablet (768px - 1024px) - iPad, Android tablets
- [ ] Desktop Small (1025px - 1440px) - Laptops
- [ ] Desktop Large (1441px+) - Large monitors

---

## Pages to Test

### 1. Stock Analysis Page (`/stock-analysis`)

#### Chart Area (-3M to 12M)
- [ ] **Mobile (320-480px)**
  - [ ] X-axis labels (-3M, T, 3M, 6M, 12M) are readable and don't overlap
  - [ ] SVG viewBox scales correctly without horizontal scroll
  - [ ] Line and points are visible and appropriately sized
  - [ ] Vertical "T" separator line is visible
  - [ ] Uncertainty cone gradient renders properly
  
- [ ] **Mobile Large (481-767px)**
  - [ ] Chart maintains aspect ratio
  - [ ] All 5 data points are clearly visible
  - [ ] Line fade effect (6M→12M) renders smoothly
  
- [ ] **Tablet (768-1024px)**
  - [ ] Chart uses full available width
  - [ ] Grid lines and labels properly spaced
  - [ ] Historical segment (-3M to T) clearly distinguished
  
- [ ] **Desktop (1025px+)**
  - [ ] Chart renders at optimal size (not too stretched)
  - [ ] All visual elements proportional

#### Score Breakdown Cards
- [ ] **Mobile**: Stack vertically, full width
- [ ] **Tablet**: 2-column grid or appropriate breakpoint
- [ ] **Desktop**: Optimal layout without excessive whitespace

---

### 2. Sector Projections Page (`/sector-projections`)

#### Chart Area (-3M to 12M)
- [ ] **Mobile (320-480px)**
  - [ ] X-axis labels (-3M, T, 3M, 6M, 12M) readable without overlap
  - [ ] SVG viewBox scales correctly (0 0 800 300)
  - [ ] All 11 sector lines render without performance issues
  - [ ] Click-to-select functionality works on touch devices
  - [ ] Vertical "T" separator visible
  
- [ ] **Mobile Large (481-767px)**
  - [ ] Uncertainty cones expand smoothly when sector selected
  - [ ] Legend buttons wrap appropriately
  - [ ] No horizontal scroll on chart
  
- [ ] **Tablet (768-1024px)**
  - [ ] Interactive hover/click states work properly
  - [ ] Selected sector highlights clearly visible
  - [ ] Multiple sectors can be compared easily
  
- [ ] **Desktop (1025px+)**
  - [ ] Chart uses available space efficiently
  - [ ] All 11 sector colors are distinguishable

#### Sector Cards
- [ ] **Mobile**: Single column, full width, collapsible
- [ ] **Tablet**: 2 columns with proper spacing
- [ ] **Desktop**: Optimal grid layout (2-3 columns)

---

### 3. Dashboard Page (`/`)

#### Widget Grid
- [ ] **Mobile (320-480px)**
  - [ ] System Overview widget: Text scales appropriately
  - [ ] Dow Theory widget: Chart readable
  - [ ] Sector Divergence widget: 2-card grid (Regime + Breadth)
  - [ ] Alerts within Sector Divergence render properly
  - [ ] All widgets stack vertically
  
- [ ] **Tablet (768-1024px)**
  - [ ] 2-column widget grid on medium screens
  - [ ] Chart elements maintain visibility
  
- [ ] **Desktop (1025px+)**
  - [ ] 3-column widget grid (System, Dow, Sector)
  - [ ] Integrated alerts section fits within Sector Divergence

#### System Overview Widget
- [ ] **All Sizes**: Purpose box removed (cleaner appearance)
- [ ] **Mobile**: Composite score and trend bars fit properly
- [ ] **Desktop**: No excessive whitespace

#### Sector Divergence Widget
- [ ] **All Sizes**: System State card removed (2-card grid only)
- [ ] **Mobile**: Alerts stack and fit in available width
- [ ] **Tablet/Desktop**: Alert cards display inline metrics properly

---

## Specific Elements to Verify

### Charts with -3M Historical Data

#### Stock Projections Chart
```
Structure: -3M ---- T ---- 3M ---- 6M ---- 12M
           (hist) (now) (future projections)
```
- [ ] Historical line (-3M to T) renders solid blue
- [ ] Vertical yellow dashed "T" line at correct position
- [ ] Future line (T to 6M) solid opacity
- [ ] Future line (6M to 12M) fades into cone
- [ ] 5 data point circles at correct positions
- [ ] Circle at T has yellow outline
- [ ] Uncertainty cone starts at T and expands
- [ ] Gradient fills render correctly on all devices

#### Sector Projections Chart
```
Same structure but with 11 overlapping lines
```
- [ ] Historical segments visible for all sectors
- [ ] Only one "T" separator line (not 11!)
- [ ] Click-to-select works on all devices
- [ ] Selected sector shows uncertainty cone
- [ ] Non-selected sectors fade to low opacity
- [ ] Touch targets large enough on mobile (min 44px)

---

## Browser Testing

### Desktop Browsers
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

### Mobile Browsers
- [ ] iOS Safari
- [ ] Chrome Mobile (Android)
- [ ] Samsung Internet

---

## Performance Checks

### Chart Rendering
- [ ] SVG renders in <1 second on mobile
- [ ] No janky scrolling with charts visible
- [ ] Smooth animations/transitions
- [ ] No memory leaks on page navigation

### Data Loading
- [ ] Loading states display properly
- [ ] Error states handled gracefully
- [ ] Network failures don't break layout

---

## Accessibility

- [ ] All charts have proper ARIA labels
- [ ] Keyboard navigation works for interactive elements
- [ ] Color contrast meets WCAG AA standards
- [ ] Touch targets minimum 44x44px on mobile
- [ ] Focus indicators visible

---

## Known Issues / Notes

### Historical Data (-3M)
⚠️ **IMPORTANT**: The -3M historical data points are currently **simulated** (current score - 8).

Test results show significant discrepancies:
- AAPL: 14 points off
- TSLA: 36 points off  
- DVLT: 69 points off
- SPY: 12 points off

**Recommendation**: Update backend to return actual historical scores for accuracy.

### Visual Fidelity
- Line fade effect (6M→12M) uses CSS gradients - verify on older browsers
- Uncertainty cone bezier curves - ensure smooth on all devices
- Multiple overlapping paths in sector chart - test on low-end devices

---

## Testing Tools

### Browser DevTools
```bash
# Chrome DevTools Device Emulation
Cmd+Shift+M (Mac) / Ctrl+Shift+M (Windows)

# Responsive Design Mode
- Toggle device toolbar
- Test various presets
- Custom dimensions
```

### Real Device Testing
- Use actual phones/tablets when possible
- Test touch interactions
- Verify rendering on real hardware

### Automated Testing
```bash
# Run Lighthouse audit
npm run lighthouse

# Check responsive breakpoints
npm run test:responsive
```

---

## Sign-off

- [ ] All critical breakpoints tested
- [ ] Charts render correctly on all devices
- [ ] No layout breaks or horizontal scroll
- [ ] Interactive elements work on touch devices
- [ ] Performance acceptable on low-end devices

**Tested by**: ________________
**Date**: ________________
**Notes**: ________________
