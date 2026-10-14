# Mobile-First Ergonomics for Procurement Hub, Purchase Orders, and Goods Received Vouchers

Transform the Procurement & Reorder Planning Hub, Commercial Purchase Order Generator, Goods Received Voucher (GRV), and Direct Supplies Received Voucher into high-efficiency, mobile-first touch interfaces that allow store clerks, inventory managers, and cashiers to manage orders, adjust quantities, select suppliers, and receive deliveries seamlessly on smartphones and handheld bay terminals.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following core user preferences have been confirmed from Phase 1 clarifying questions and will govern the mobile architecture:

- **Confirmed Decision 1 (Table vs Card Presentation)**: Dual-Mode presentation (Option 1 & 2 hybrid). By default on small screens ($< 640\text{px}$), items render as rich mobile cards with collapsible details and 44px+ touch steppers. A persistent toggle allows clerks to switch to a compact horizontal-scroll table with a sticky product name column when auditing line items side-by-side.
- **Confirmed Decision 2 (Barcode Scanning)**: Lightweight and instant search/autocomplete (Option 2). Rather than forcing camera permissions and high-battery video feeds, the mobile search bar provides sub-50ms instant indexing across product names, SKU codes, and barcodes, with quick-select results.
- **Confirmed Decision 3 (Commercial PO Presentation)**: Stacked Mobile Card Voucher with One-Tap Actions (Option 1 & 3 hybrid). On mobile screens, the Purchase Order renders as a clean, stacked summary card optimized for handheld reading and thumb taps, with prominent actions for WhatsApp dispatch, Direct GRV transfer, and CSV export. The formal paper slip remains formatted for standard thermal/A4 printing when the print action is triggered.

---

### 1. Overview & Core Concept

- **What It Does**: Upgrades all inventory procurement, purchase ordering, and goods receiving interfaces to work with ergonomic, thumb-friendly touch interactions on smartphones (375px–430px) without sacrificing desktop multi-column data density.
- **Target Audience / Persona**: 
  - **Stock Clerks at the Loading Dock**: Rapidly inspecting cases and singles, updating batch numbers, verifying supplier delivery notes directly on a mobile phone without needing a desktop terminal.
  - **Procurement Officers on the Go**: Reviewing stockout predictions, adjusting reorder cases with finger taps, and dispatching orders to suppliers via WhatsApp while on the move.
  - **Cashiers at the Till**: Performing Direct Goods Received allocations with till drawer payments and supervisor PIN confirmations on mobile or POS touch screens.
- **Key Value**: Eliminates horizontal clipping, awkward micro-inputs, and rigid desktop dialogs, allowing full warehouse and retail store mobility.

---

### 2. User Experience & Visual Design

#### A. Key User Flows

```
[ FLOW 1: MOBILE REORDER PLANNING & PO DISPATCH ]
Mobile Device -> Header with KPI Drawer -> Search or Filter Supplier
   -> Review Product Cards (Priority Tier, Stockout Days, Velocity)
   -> Tap +/- Steppers to adjust Reorder Cases
   -> Floating Sticky Dispatch Bar updates in real time ($ Total, Items)
   -> Tap "Create PO" -> Fullscreen Mobile Sheet opens
   -> Select/Add Supplier via Bottom Combobox -> Tap "Copy WhatsApp Order" or "Send to Direct GRV"

[ FLOW 2: MOBILE GOODS RECEIVING (GRV & DIRECT GRV) ]
Receiving Bay -> Open GRV on Mobile -> Unsaved Draft Auto-Detected & Restored
   -> Tap "+ Add Product" -> Full-width searchable bottom picker
   -> Tap item -> Product Card added with Cases/Singles touch steppers
   -> Enter Invoice Ref & Delivery Note -> Sticky Bottom Bar calculates Total Cost
   -> Tap "Post Voucher" / "Submit for Approval" -> Success vibration & instant sync
```

#### B. Visual Identity & Theme

- **Aesthetic Direction**: Utilitarian, high-contrast industrial mobile ergonomics with clean typographic hierarchy (no cluttered pill enclosures).
- **Color Palette & Mood**:
  - Background: Crisp neutral slate (`bg-slate-50` light / `bg-slate-950` dark).
  - Status Indicators: Emerald-600 (Healthy / Received), Amber-500 (Urgent / Pending), Rose-600 (Critical / Deficit).
  - Primary Touch Accents: Indigo-600 (`#4f46e5`) for procurement flows, Amber-500 (`#f59e0b`) for Direct GRV.
- **Typography & Touch Hierarchy**:
  - Font Pairing: Clean Sans-Serif (`Inter` / system-ui) with high-legibility tabular mono font (`font-mono`) for monetary values, SKUs, and case counts.
  - Minimum Touch Target: All tap triggers, increment/decrement buttons, and dropdown rows meet the **$44 \times 44\text{px}$** standard.
  - Safe Area & 15% Sticky Cap: Fixed header and floating action bars are capped below 15% of viewport height to ensure at least 85% vertical scrolling space.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual View Toggle (Card Mode vs Compact Table Mode)**
  - *Chosen Approach*: On screens under 640px, provide a segmented toggle `[ Cards | Table ]`. Card mode displays expandable rows with large stepper controls. Table mode keeps a sticky left column for the product name while enabling smooth horizontal scrolling for quantitative columns.
  - *Why*: Experienced clerks auditing 50-line invoices prefer scanning tables horizontally, while warehouse receivers handling physical boxes prefer big tap buttons. Providing both maximizes user velocity.
  - *Alternatives Considered*: Forcing horizontal scrolling only (causes touch conflict with vertical scroll); forcing cards only (slower to audit long lists).

- **Decision 2: Fullscreen Dialogs on Mobile Viewports**
  - *Chosen Approach*: Replace centered, floating desktop modals (`fixed inset-0 flex items-center justify-center p-6`) with fullscreen responsive modal sheets (`fixed inset-0 z-50 bg-white sm:rounded-3xl sm:max-w-4xl sm:my-6`) featuring a sticky header and bottom action dock.
  - *Why*: Centered floating modals on mobile get cropped by the on-screen virtual keyboard and leave useless margins. Fullscreen sheets maximize readable space and thumb accessibility.

- **Decision 3: Sticky Bottom Summary & Floating Dispatch Dock**
  - *Chosen Approach*: Implement a fixed bottom bar on mobile (`fixed bottom-0 left-0 right-0 p-3 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-xl`) that displays total spend, item count, and primary action button.
  - *Why*: Keeps the final call-to-action within the natural thumb zone regardless of scroll position.

---

### 4. Technical Architecture & Data Strategy

#### System & Component Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RESPONSIVE VIEWPORT ENGINE                      │
│     (Tailwind Breakpoints: <640px Mobile, 640-1024px Tablet, >1024px)   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ ProcurementHub   │      │ PurchaseOrder    │      │ GRV & Direct GRV │
│ - Mobile KPI Bar │      │ - Fullscreen     │      │ - Dual-Mode Card │
│ - Dual Card/Table│      │   Sheet Modal    │      │   / Table Rows   │
│ - +/- Steppers   │      │ - Touch Combobox │      │ - Touch Steppers │
│ - Sticky Dock    │      │ - WhatsApp/Print │      │ - Till Pay Sheet │
└────────┬─────────┘      └────────┬─────────┘      └────────┬─────────┘
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   ▼
         ┌───────────────────────────────────────────────────┐
         │ Persistent Draft Auto-Save Engine (localStorage)  │
         │ - PO Draft: saimetric_draft_purchase_order        │
         │ - GRV Draft: saimetric_draft_goods_received...    │
         │ - Direct GRV Draft: saimetric_draft_direct_grv    │
         └───────────────────────────────────────────────────┘
```

#### Detailed Component Changes

1. **`ProcurementReorderHub.tsx`**:
   - Header Controls: Convert the 12-column horizon/budget/window grid into responsive collapsing controls (`flex flex-col sm:grid sm:grid-cols-12`).
   - KPI Cards: Responsive 2-column grid on mobile (`grid grid-cols-2 lg:grid-cols-4`).
   - Supplier Filter Tabs: Horizontal scrollable strip with touch snapping (`overflow-x-auto scrollbar-none flex gap-2`).
   - View Mode Switcher: Add `[ Card View | Table View ]` segmented control for mobile.
   - Mobile Card View Component: Product name, SKU code, priority badge, velocity, stockout cover, and interactive `[-] [value] [+]` case adjustment buttons.
   - Mobile Compact Table: Responsive wrapper with sticky product column (`sticky left-0 bg-white z-10`).
   - Purchase Order Modal: Responsive modal container (`w-full h-full sm:h-auto sm:max-h-[92vh] sm:rounded-3xl`).
   - Floating Dispatch Bar: Refactor to sticky bottom bar with safe padding (`pb-safe`).

2. **`GoodsReceivedView.tsx`**:
   - Tab Bar: Convert desktop tab strip into a horizontally scrollable pill/tab bar on mobile.
   - Delivery Details Card: Stacked form inputs with 44px minimum tap height on mobile.
   - Dual-Mode Spreadsheet Entry:
     - Desktop: Full WPS Office-style spreadsheet table.
     - Mobile: Card-based receiving items with prominent Cases / Singles / Prepack toggles and steppers.
   - Product Selector: Full-screen mobile bottom sheet for searching and picking catalog items.
   - Sticky Actions: Sticky footer with real-time total invoice cost and "Post Voucher" CTA.

3. **`DirectGoodsReceivedView.tsx`**:
   - Mobile Form Stacking: Single-column stacked fields on `<640px` for voucher number, delivery date, supplier, and invoice number.
   - Mobile Receiving Rows: Touch card view with stepper controls for received quantities and selling prices.
   - Multi-Cashier Till Payments: Responsive card layout for cashier amount allocation, drawer selection, and PIN verification.
   - Sticky Bottom Summary: Live settled vs credit balance dock with 48px primary submit button.

---

### Verification & Testing Plan

1. **Mobile Viewport Emulation**:
   - Test on standard mobile viewports: iPhone SE (375px), iPhone 14/15 (390px), Android standard (360px & 412px), and iPad/Tablet (768px).
2. **Interactive Controls & Touch Ergonomics**:
   - Verify every stepper (`+` and `-`) updates cases, units, and line totals instantly without zoom or lag.
   - Verify combobox dropdowns open smoothly and do not get clipped by viewport boundaries.
   - Verify draft auto-save and recovery alert banners scale cleanly without overflowing mobile screens.
3. **Compilation & Build Validation**:
   - Run `lint_applet` and `compile_applet` to ensure zero TypeScript or syntax issues.
