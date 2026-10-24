# Implementation Plan: Financial Accuracy, Cash Custody Balancing & Ledger Architecture

This plan resolves the six operational and financial issues across Sales Profit Reporting, Basket Analytics, Form 4 Cash Surrender Floats, Dual Custody Expense Flows, Account Transaction Ledgers, and Dashboard Optimization.

---

## 1. Problem Analysis & Proposed Architectural Solutions

### Issue 1: "Latest Price Profit" Calculation Using Average Cost
- **Current Behavior**: In `src/components/reports/SalesReport.tsx` and `src/utils/costResolver.ts`, `latestCostPerUnit` often falls back to `fallbackUnitCost` or `averageCostPerUnit` when older items or packaging variants lack an explicit replacement price. Consequently, Line 2 ("Latest Price Profit") duplicates Line 1 ("Average Cost Profit").
- **Solution**:
  - In `src/utils/costResolver.ts`, enhance `resolveItemCost` to resolve true latest purchase cost by inspecting the most recent `GoodsReceivedNote` / `SupplierInvoiceVoucher` line item for that specific product or variant whenever `latestCostPerUnit` is missing or equal to average cost.
  - In `src/components/reports/SalesReport.tsx`, ensure `prod.grossProfitLatest = prod.totalRevenue - (unitsSold * resolved.latestCost)` strictly reflects the actual replacement cost, clearly displaying the margin delta between blended AVCO and current wholesale replacement prices.

---

### Issue 2: Average Basket Metric Based on Sales Dollar Value Instead of Units
- **Current Behavior**: The KPI card in `SalesReport.tsx` is titled `Average Basket / Units` and reports ticket metrics primarily through unit counts (e.g., "2 units per receipt"), rather than retail standard ticket size.
- **Solution**:
  - Re-anchor the primary headline metric to **Average Basket Value ($)** (`totalRevenue / totalCompletedSales`, e.g., **$7.45** average spend per ticket).
  - Position **Average Units per Basket** (`totalUnitsSold / totalCompletedSales`, e.g., **2.3 units/ticket**) and total volume fulfilled as secondary supporting metrics underneath.

---

### Issue 3: Cashier Surrender & Dynamic Retained Float ($15, $20, $30) in Form 4 EOD
- **Current Behavior**: When a cashier counts $400 at EOD, the sweep button deducts a hardcoded default $20 float and sweeps $380 into the Safe. The cashier's physical $20 retained float is not recorded in their cashbox ledger, and the next morning Dual Custody issues *another* float from the Safe, creating duplicate withdrawals and balancing discrepancies. Furthermore, there is no way to accommodate varying retained floats (e.g., $15 or $30).
- **Solution**:
  - **Editable Retained Float per Cashier in Form 4 (`Form4Reconciliation.tsx`)**:
    - Add an editable `retainedFloat` input for each cashier row (defaulting to the store's configured float, e.g., $20.00, but freely adjustable to $15.00, $30.00, etc.).
    - Update the sweep calculation: `Swept to Vault = Counted Cash - Retained Float` (e.g., $400 counted − $15 retained = $385 swept).
  - **Automatic Next-Day Float Carryover (`cashCustodyService.ts` & `Form2CashLog.tsx`)**:
    - Record the exact retained amount in the cashier's physical cashbox record (`retainedCashboxFloat` with date and cashier ID).
    - In `Form2CashLog.tsx` (opening cash log for the cashier's next shift), detect the previous night's retained cashbox float and automatically populate it as their opening float, without requiring a redundant withdrawal from the Safe.
    - If a manager needs to top up a cashier's float (e.g., from $15 to $20), the existing "Float Adjustment" voucher can be used for the difference.

---

### Issue 4: Vault & Clerk Float Utility Expenses Linked to Profit & Loss
- **Current Behavior**: Expenses can only be recorded against cashier till drawers in Form 2. Major branch overheads (ZESA electricity, water/rates, generator fuel, shop rent, logistics) paid directly from the Branch Safe or Clerk Float cannot be logged and do not flow into the Profit & Loss statement (`IncomeStatement.tsx`).
- **Solution (aligned with User Option 2)**:
  - Add a **"Record Vault / Clerk Expense"** action in `AccountsClerkVoucherView.tsx`.
  - When recorded, it debits the source account (`Branch Safe` or `Clerk Float`), updates real-time custodial balances, and creates an `ExpenseEntry` via `saveExpense()` with `paymentMethod: 'Safe Vault Cash' | 'Clerk Float Cash'` and `staffId: 'BRANCH_SAFE_VAULT'`.
  - Because `IncomeStatement.tsx` calculates operating expenses by querying `getExpenses()`, these utility payments automatically flow into the Profit & Loss report under Operating Expenses.
  - Because cashier Form 2 only queries `getExpensesForStaffAndDate(cashierStaffId, date)`, cashier till logs remain completely uncluttered.

---

### Issue 5: Clickable Account Statements & Double-Entry Ledger (Safe, Clerk Float, Bank)
- **Current Behavior**: In `AccountsClerkVoucherView.tsx`, the balance cards for Branch Safe and Clerk Float are static text displays with no drill-down capability.
- **Solution**:
  - Make `Branch Safe`, `Clerk Float`, and `Commercial Bank` cards interactive and clickable.
  - Open a dedicated **Account Statement & Transaction Ledger Modal** with:
    - **Header**: Account Title, Custodian Name, Current Balance, and quick date filter (Today, Last 7 Days, This Month, All Time).
    - **Tabular Ledger**:
      - `Date & Time`
      - `Voucher / Ref #` (clickable to view voucher details)
      - `Description / Purpose` (e.g., "ZESA Electricity Token", "Till #1 EOD Cash Collection")
      - `In (+)` (emerald monospace)
      - `Out (-)` (rose monospace)
      - `Running Balance` (slate monospace)
      - `Authorized By` (staff name & role)
    - **Actions**: Export CSV and Print Statement buttons.

---

### Issue 6: Decluttering Unpaid GRVs in Dual Custody Dashboard
- **Current Behavior**: Inbound GRVs awaiting safe cash payout occupy an expansive multi-card grid at the top of `AccountsClerkVoucherView.tsx`, crowding out critical custodial tools.
- **Solution (aligned with User Option 1)**:
  - Replace the large multi-card section with a compact, modern ribbon banner:
    `[ 🚚 X Deliveries Pending Safe Cash Payout ($Y.YY) — Review & Pay Supplier → ]`
  - In the "Pay Supplier" modal, incorporate a searchable list of pending GRVs with line-item previews, invoice numbers, supplier names, and one-tap payout with dual-custody PIN authorization.

---

## 2. Proposed Changes by File

### 1. `src/utils/costResolver.ts`
- Enhance `resolveItemCost()`:
  - When `latestCostPerUnit` is missing or matches `averageCostPerUnit`, look up the latest receipt line in `getAllGoodsReceivedNotes()` or `getSupplierInvoices()` matching the item ID/SKU.
  - Ensure packaging variants (cases, packs, singles) scale the latest replacement cost accurately.

### 2. `src/components/reports/SalesReport.tsx`
- Refactor the KPI card at lines 679–695:
  - Display Average Basket Size in currency (`$X.XX`) as the main statistic.
  - Display units per ticket (`Y.Y units/ticket`) as a clean sub-label.
- Verify dual-cost table columns (lines 880–975) accurately display the gross profit and margin computed from `prod.grossProfitLatest`.

### 3. `src/components/forms/Form4Reconciliation.tsx`
- Add an editable `retainedFloat` input to each cashier row in the reconciliation table.
- Pass the custom `retainedFloat` ($15, $20, $30, etc.) into `handleExecuteHandover` and `handleSweepAllTills`.
- Update `totalAvailableSurplus` to compute based on each cashier's specified retained float.

### 4. `src/services/cashCustodyService.ts`
- In `handoverTillToSafe()`, persist the cashier's retained float in a new helper `saveCashierRetainedFloat(cashierId, date, amount)`.
- Add helper `getCashierRetainedFloat(cashierId, date)` to retrieve the overnight cashbox float.
- Add `recordCustodialExpense()` method:
  - Decrements `Branch Safe` or `Clerk Float` balance.
  - Creates a completed `CashTransfer` voucher of type `THIRD_PARTY_PAYOUT`.
  - Persists an `ExpenseEntry` via `saveExpense()` with category, payee, receipt ref, and notes.
- Add helper `getAccountTransactionHistory(accountId)` returning chronologically sorted movements with running balance calculation.

### 5. `src/components/forms/Form2CashLog.tsx`
- In the initial opening float logic, check `getCashierRetainedFloat(currentUser.id, yesterdayDate)`.
- If a retained float exists from the prior shift (e.g., $15 or $30), autofill it as the opening float.

### 6. `src/components/cashCustody/AccountsClerkVoucherView.tsx`
- Replace the large unpaid GRVs grid with a compact notification ribbon.
- Add interactive click handlers to `Branch Safe`, `Clerk Float`, and `Commercial Bank` cards.
- Add the **Account Statement & Ledger Modal** component.
- Add the **Record Vault / Clerk Expense Modal** with category selection (Utilities, Rent, Generator Fuel, Rates, Maintenance) and source account selection (Branch Safe vs. Clerk Float).
- Enhance the **Pay Supplier Modal** to allow selecting directly from unpaid GRVs.

---

## 3. Verification & Safety Plan

### Build Verification
- Execute `lint_applet` to check for syntax and type issues.
- Execute `compile_applet` to confirm a clean build (`tsc --noEmit` and Vite bundle).

### Manual Verification Steps
1. **Sales Report Dual Profit**:
   - Open Sales Report; verify Line 2 shows true replacement cost profit when latest purchase cost differs from AVCO.
   - Verify the Average Basket card prominently shows the sales dollar value (e.g., "$7.45") with units per ticket as a sub-metric.
2. **Form 4 Dynamic Retained Float & Sweep**:
   - In Form 4, adjust a cashier's retained float to $15 or $30.
   - Verify the sweep amount updates immediately (`Counted - Retained`).
   - Execute sweep; verify the vault receives the exact surplus and the retained float is logged.
3. **Overnight Cashbox Float in Form 2**:
   - Open Form 2 as the cashier for the following day; verify their opening float automatically displays the retained amount without requiring a new Safe withdrawal.
4. **Vault & Clerk Float Utilities in P&L**:
   - Record a $45 ZESA electricity expense from Branch Safe.
   - Verify Branch Safe balance decrements by $45.
   - Open Income Statement; verify the $45 appears under Operating Expenses.
   - Open cashier Form 2; verify the till cash log is unaffected.
5. **Account Statement & Ledger**:
   - Click the Branch Safe and Clerk Float cards; verify the full transaction ledger opens with `In`, `Out`, running balance, and voucher reference.
6. **Decluttered Dual Custody**:
   - Verify inbound GRVs appear as a compact ribbon banner.
   - Click "Pay Supplier"; verify GRVs can be reviewed and paid directly within the modal.
