# Sirius Worker Management - Address Management UI Design Guidelines

## Design Approach

**System Selected**: shadcn/ui + Tailwind CSS ecosystem  
**Rationale**: Established component library for data-dense professional applications with excellent accessibility and developer experience

**Design Principles**:
- Information clarity: Technical data (coordinates, JSON) presented in scannable, digestible format
- Progressive disclosure: Complex data revealed through purposeful interactions
- Visual confidence: Status indicators and badges communicate accuracy at a glance
- Spatial efficiency: Dense information without feeling cramped

## Typography System

**Font Family**: Inter (via Google Fonts CDN)

**Hierarchy**:
- Page Headers: text-2xl font-semibold tracking-tight
- Section Labels: text-sm font-medium text-muted-foreground uppercase tracking-wide
- Primary Data: text-base font-medium
- Secondary/Meta Data: text-sm text-muted-foreground
- Technical Data (coordinates, JSON): font-mono text-sm
- Badge Text: text-xs font-medium

## Layout & Spacing

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, and 8 for consistency
- Component padding: p-4 or p-6
- Section gaps: space-y-4 or space-y-6
- Grid gaps: gap-4
- Card spacing: p-6
- Modal padding: p-6
- Dense data rows: py-2

**Container Strategy**:
- Main content: max-w-7xl mx-auto px-6
- Modals: max-w-2xl for coordinate viewer, max-w-4xl for JSON viewer
- Data cards: Full width within containers

## Core Component Specifications

### Address Accuracy Badges

**Visual Treatment**:
- Pill-shaped badges with icon + text combination
- Size: h-6 inline-flex items-center px-3 rounded-full
- Icon: Left-aligned from Heroicons (map-pin, check-circle, exclamation-circle)
- Typography: text-xs font-medium

**Accuracy Levels** (use semantic naming):
- Rooftop: Success variant with check-circle icon
- Range Interpolated: Warning variant with map-pin icon  
- Geometric Center: Info variant with location-marker icon
- Approximate: Neutral/secondary variant with exclamation-circle icon

**Placement**: Display inline with address headers or as metadata row beneath primary address text

### Coordinate Display Modal

**Structure**:
- Header: "Address Coordinates" with close button (top-right)
- Primary Content Area divided into two columns:
  - Left Column: Address context (full formatted address, accuracy badge)
  - Right Column: Coordinate data grid

**Coordinate Data Grid**:
- Two-column layout: Label | Value
- Labels: text-sm text-muted-foreground font-medium
- Values: font-mono text-base with copy-to-clipboard button
- Rows: Latitude, Longitude, Accuracy Type, Place ID
- Row spacing: py-3 with border-b divider between rows
- Copy buttons: Small ghost variant with clipboard icon, positioned inline with values

**Footer**: 
- "View Full API Response" button (secondary variant)
- Dismiss action button (primary variant)

### JSON Response Viewer

**Modal Layout**:
- Header: "Geocoding API Response" with metadata (timestamp, request type)
- Full-width code block area with syntax highlighting
- Toolbar above code block: Copy All, Download JSON, Format/Minify toggle

**Code Display**:
- Background: Subtle contrast from modal background
- Border: Rounded border with 1px solid border
- Padding: p-4
- Font: font-mono text-sm
- Max height: max-h-[600px] with overflow-y-auto
- Line numbers: Optional left gutter with text-muted-foreground
- Syntax colors: Use minimal palette - keys, strings, numbers, booleans in distinct but subtle shades

**Enhanced Features**:
- Collapsible JSON sections for nested objects
- Search/filter input at top to highlight keys
- "Pretty Print" vs "Compact" view toggle

### Action Buttons Integration

**"View Coordinates" Button**:
- Variant: Ghost or outline
- Size: sm (h-8 px-3)
- Icon: map-pin from Heroicons
- Placement: Inline with address row or in actions menu dropdown

**"View API Response" Button**:
- Variant: Ghost with subtle border
- Size: sm
- Icon: code-bracket from Heroicons  
- Placement: Modal footer or data panel actions area

## Data Table/List Integration

**Address Management Table**:
- Columns: Worker Name | Address | Accuracy Badge | Coordinates Preview | Actions
- Row height: h-14 for comfortable scanning
- Hover state: Subtle background change
- Coordinates preview: Display truncated lat/lng in font-mono text-xs text-muted-foreground
- Actions column: Dropdown menu with coordinate and JSON viewer options

**Alternative: Card Layout** (for mobile-friendly design):
- Card per address: p-4 rounded-lg border
- Header row: Address + accuracy badge
- Metadata row: Worker name, coordinates preview
- Action row: View buttons aligned right

## Accessibility Implementation

**Focus Management**:
- Modal traps focus when open
- Clear focus rings on all interactive elements: ring-2 ring-offset-2
- ESC key closes modals
- Coordinate copy buttons announce success to screen readers

**ARIA Labels**:
- Badges include aria-label describing accuracy level
- Copy buttons announce "Copy latitude coordinate" etc.
- JSON viewer has role="region" with aria-label

**Keyboard Navigation**:
- Tab order: Header controls → Content → Footer actions
- Enter/Space activate buttons
- Arrow keys navigate JSON tree when expanded

## Icons

**Library**: Heroicons (via CDN)  
**Usage**:
- map-pin: Accuracy badges, coordinate indicators
- check-circle: Success states, rooftop accuracy
- exclamation-circle: Warnings, approximate accuracy
- clipboard-document: Copy actions
- code-bracket: JSON viewer triggers
- x-mark: Close modals
- chevron-down/up: Collapsible JSON sections

**Size**: w-4 h-4 for inline icons, w-5 h-5 for standalone buttons

## Images

**Not Applicable**: This is a data management interface without hero imagery or decorative elements. Focus remains on information clarity and functional design.

## Animation & Transitions

**Minimal Motion Philosophy**:
- Modal entry/exit: Simple fade + scale (duration-200)
- Copy success feedback: Brief scale pulse on button
- Collapsible JSON sections: Smooth height transition (duration-300)
- No scroll-triggered animations or complex transitions