// ============================================================================
// PURCHASE ORDER PRINT SERVICE — A4 COMMERCIAL SHEET + 58MM THERMAL ESC/POS
// Uses hidden iframe for A4 print/PDF (no window.open / popup blockers)
// ============================================================================

import { PurchaseOrder } from '../types';
import { getCurrentBranch, getCurrentCompany } from '../db/roomDatabase';
import { bluetoothPrinter, PaperWidth } from './bluetoothPrinter';

const escapeHtml = (val: unknown): string =>
  String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtMoney = (n: number): string =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildPurchaseOrderA4Html(po: PurchaseOrder): string {
  const company = getCurrentCompany();
  const branch = getCurrentBranch();
  const companyName = company?.company_name || 'Saimetric Retail Enterprise';
  const branchName = po.branchName || branch?.name || 'Main Store';
  const branchCode = branch?.code || po.branch_id || '';
  const isFinal = po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED' || po.status === 'RECEIVED';
  const statusLabel = String(po.status || 'DRAFT').replace(/_/g, ' ');

  const rowsHtml = (po.lines || [])
    .map((line, idx) => {
      const qtyParts: string[] = [];
      if (Number(line.orderCases || 0) > 0) {
        qtyParts.push(`${line.orderCases} cs (${line.unitsPerCase}/cs)`);
      }
      if (Number(line.orderSingles || 0) > 0) {
        qtyParts.push(`${line.orderSingles} singles`);
      }
      const qtyDisplay = qtyParts.length > 0 ? qtyParts.join(' + ') : `${line.totalUnits} units`;
      const receivedInfo =
        Number(line.receivedUnits || 0) > 0
          ? `<div class="sub-note">Received: ${line.receivedCases || 0} cs (${line.receivedUnits} u)</div>`
          : '';
      return `
        <tr>
          <td class="num">${idx + 1}</td>
          <td class="mono">${escapeHtml(line.code || line.itemId)}</td>
          <td>
            <div class="item-title">${escapeHtml(line.poDescription || line.masterDescription)}</div>
            ${line.notes ? `<div class="sub-note">Note: ${escapeHtml(line.notes)}</div>` : ''}
            ${receivedInfo}
          </td>
          <td class="num">${escapeHtml(qtyDisplay)}</td>
          <td class="num">${Number(line.totalUnits || 0).toLocaleString()}</td>
          <td class="num">${fmtMoney(line.caseCost)}</td>
          <td class="num bold">${fmtMoney(line.lineTotal)}</td>
        </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Purchase Order ${escapeHtml(po.poNumber)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 14mm 16mm 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 11px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet { max-width: 190mm; margin: 0 auto; position: relative; }
    .watermark {
      position: fixed;
      top: 42%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-32deg);
      font-size: 56px;
      font-weight: 800;
      letter-spacing: 0.12em;
      color: rgba(203, 213, 225, 0.35);
      pointer-events: none;
      text-transform: uppercase;
      white-space: nowrap;
      z-index: 0;
    }
    .content { position: relative; z-index: 1; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .company-name { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 2px 0; }
    .branch-line { font-size: 11px; color: #475569; margin: 0; }
    .doc-box { text-align: right; }
    .doc-title { font-size: 20px; font-weight: 900; letter-spacing: 0.04em; color: #0f172a; margin: 0; }
    .doc-no { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; font-weight: 700; margin-top: 2px; }
    .status-tag {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 8px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border: 1px solid ${isFinal ? '#059669' : '#d97706'};
      color: ${isFinal ? '#065f46' : '#92400e'};
      background: ${isFinal ? '#ecfdf5' : '#fffbeb'};
      border-radius: 4px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
    }
    .meta-card {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
      background: #f8fafc;
    }
    .meta-heading {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      margin: 0 0 6px 0;
    }
    .meta-primary { font-size: 13px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0; }
    .meta-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; margin-top: 3px; }
    .meta-label { color: #64748b; }
    .meta-val { font-weight: 600; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    thead th {
      background: #0f172a;
      color: #ffffff;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 7px 8px;
      text-align: left;
      border: 1px solid #0f172a;
    }
    thead th.num { text-align: right; }
    tbody td {
      padding: 7px 8px;
      border-bottom: 1px solid #e2e8f0;
      border-left: 1px solid #e2e8f0;
      border-right: 1px solid #e2e8f0;
      vertical-align: top;
    }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: #334155; white-space: nowrap; }
    .bold { font-weight: 700; }
    .item-title { font-weight: 700; color: #0f172a; }
    .sub-note { font-size: 9.5px; color: #64748b; margin-top: 2px; }
    .summary-wrap {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      margin-top: 8px;
    }
    .notes-box {
      flex: 1;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
      min-height: 76px;
    }
    .totals-box {
      width: 240px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
      background: #f8fafc;
    }
    .tot-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
    .tot-row.grand {
      border-top: 2px solid #0f172a;
      margin-top: 6px;
      padding-top: 7px;
      font-size: 14px;
      font-weight: 800;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-top: 26px;
      page-break-inside: avoid;
    }
    .sig-box {
      border-top: 1px solid #475569;
      padding-top: 6px;
    }
    .sig-role { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; }
    .sig-name { font-size: 11.5px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    .sig-date { font-size: 10px; color: #64748b; margin-top: 2px; }
    .footer-note {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 9.5px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  ${!isFinal ? `<div class="watermark">${escapeHtml(statusLabel)}</div>` : ''}
  <div class="sheet">
    <div class="content">
      <div class="header">
        <div>
          <h1 class="company-name">${escapeHtml(companyName)}</h1>
          <p class="branch-line">Branch: ${escapeHtml(branchName)}${branchCode ? ` (${escapeHtml(branchCode)})` : ''}</p>
          <p class="branch-line">Commercial Procurement Department</p>
        </div>
        <div class="doc-box">
          <div class="doc-title">PURCHASE ORDER</div>
          <div class="doc-no">${escapeHtml(po.poNumber)}</div>
          <div class="status-tag">${escapeHtml(statusLabel)}</div>
        </div>
      </div>

      <div class="meta-grid">
        <div class="meta-card">
          <div class="meta-heading">Supplier / Vendor</div>
          <div class="meta-primary">${escapeHtml(po.supplierName || 'Unspecified Supplier')}</div>
          ${po.supplierPhone ? `<div class="meta-row"><span class="meta-label">Phone:</span><span class="meta-val">${escapeHtml(po.supplierPhone)}</span></div>` : ''}
          ${po.supplierEmail ? `<div class="meta-row"><span class="meta-label">Email:</span><span class="meta-val">${escapeHtml(po.supplierEmail)}</span></div>` : ''}
          ${po.supplierAddress ? `<div class="meta-row"><span class="meta-label">Address:</span><span class="meta-val">${escapeHtml(po.supplierAddress)}</span></div>` : ''}
        </div>

        <div class="meta-card">
          <div class="meta-heading">Order Details</div>
          <div class="meta-row"><span class="meta-label">Order Date:</span><span class="meta-val">${escapeHtml(po.orderDate)}</span></div>
          <div class="meta-row"><span class="meta-label">Expected Delivery:</span><span class="meta-val">${escapeHtml(po.expectedDeliveryDate || 'As agreed')}</span></div>
          <div class="meta-row"><span class="meta-label">Payment Terms:</span><span class="meta-val">${escapeHtml(po.paymentTerms || 'Standard Terms')}</span></div>
          <div class="meta-row"><span class="meta-label">Deliver To:</span><span class="meta-val">${escapeHtml(branchName)}</span></div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th class="num" style="width:32px">#</th>
            <th style="width:92px">SKU / Code</th>
            <th>Description</th>
            <th class="num" style="width:110px">Order Qty</th>
            <th class="num" style="width:62px">Units</th>
            <th class="num" style="width:82px">Case Cost</th>
            <th class="num" style="width:92px">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="summary-wrap">
        <div class="notes-box">
          <div class="meta-heading">Instructions &amp; Delivery Notes</div>
          <div>${po.notes ? escapeHtml(po.notes) : 'Please quote the Purchase Order number above on all delivery notes and supplier invoices.'}</div>
        </div>
        <div class="totals-box">
          <div class="tot-row"><span>Line Items</span><span class="num bold">${(po.lines || []).length}</span></div>
          <div class="tot-row"><span>Total Quantity</span><span class="num">${po.totalCases || 0} cs / ${Number(po.totalUnits || 0).toLocaleString()} u</span></div>
          <div class="tot-row"><span>Subtotal</span><span class="num">${fmtMoney(po.subtotal)}</span></div>
          ${Number(po.taxAmount || 0) > 0 ? `<div class="tot-row"><span>Tax (${po.taxPercent || 0}%)</span><span class="num">${fmtMoney(po.taxAmount)}</span></div>` : ''}
          <div class="tot-row grand"><span>Grand Total</span><span class="num">${fmtMoney(po.grandTotal)}</span></div>
        </div>
      </div>

      <div class="signatures">
        <div class="sig-box">
          <div class="sig-role">Prepared By</div>
          <div class="sig-name">${escapeHtml(po.createdByName || 'Procurement Staff')}</div>
          <div class="sig-date">Created: ${po.createdAt ? escapeHtml(new Date(po.createdAt).toLocaleString()) : escapeHtml(po.orderDate)}</div>
        </div>
        <div class="sig-box">
          <div class="sig-role">Manager Authorization</div>
          <div class="sig-name">${po.approvedByName ? escapeHtml(po.approvedByName) : 'Pending Manager Approval'}</div>
          <div class="sig-date">${po.approvedAt ? `Approved: ${escapeHtml(new Date(po.approvedAt).toLocaleString())}` : 'Signature &amp; Date: _______________________'}</div>
        </div>
      </div>

      <div class="footer-note">
        <span>${escapeHtml(companyName)} &bull; ${escapeHtml(po.poNumber)}</span>
        <span>Printed ${escapeHtml(new Date().toLocaleString())}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function buildPurchaseOrderThermal58mmHtml(
  po: PurchaseOrder,
  paperWidth: PaperWidth = '58mm'
): string {
  const company = getCurrentCompany();
  const branch = getCurrentBranch();
  const companyName = company?.company_name || 'Saimetric Retail Enterprise';
  const branchName = po.branchName || branch?.name || 'Main Store';
  const statusLabel = String(po.status || 'DRAFT').replace(/_/g, ' ');
  const is80 = paperWidth === '80mm';
  const pageWidthMm = is80 ? '80mm' : '58mm';
  const contentWidthMm = is80 ? '74mm' : '54mm';

  const linesHtml = (po.lines || [])
    .map((line, idx) => {
      const desc = line.poDescription || line.masterDescription || 'Item';
      const qtyParts: string[] = [];
      if (Number(line.orderCases || 0) > 0) {
        qtyParts.push(`${line.orderCases}cs`);
      }
      if (Number(line.orderSingles || 0) > 0) {
        qtyParts.push(`${line.orderSingles}u`);
      }
      const qtyText = qtyParts.length > 0 ? qtyParts.join('+') : `${line.totalUnits || 0}u`;
      const unitRate =
        Number(line.orderCases || 0) > 0
          ? `${fmtMoney(line.caseCost)}/cs`
          : `${fmtMoney(line.unitCost)}/u`;

      return `
        <div class="line-item">
          <div class="line-desc">${idx + 1}. ${escapeHtml(desc)}</div>
          <div class="line-meta">
            <span>${escapeHtml(qtyText)} (${Number(line.totalUnits || 0)}u) @ ${escapeHtml(unitRate)}</span>
            <span class="bold">${fmtMoney(line.lineTotal)}</span>
          </div>
          ${line.notes ? `<div class="line-note">Note: ${escapeHtml(line.notes)}</div>` : ''}
        </div>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>PO ${escapeHtml(po.poNumber)} (${escapeHtml(paperWidth)})</title>
  <style>
    @page { size: ${pageWidthMm} auto; margin: 1.5mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Courier New", monospace;
      font-size: ${is80 ? '11px' : '10px'};
      line-height: 1.32;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ticket {
      width: ${contentWidthMm};
      max-width: 100%;
      margin: 0 auto;
      padding: 2mm 1mm 6mm 1mm;
    }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .company { font-size: ${is80 ? '13px' : '12px'}; font-weight: 800; text-transform: uppercase; }
    .doc-title { font-size: ${is80 ? '13px' : '12px'}; font-weight: 800; letter-spacing: 0.04em; margin-top: 2px; }
    .sub { font-size: ${is80 ? '10px' : '9px'}; }
    .divider { border-top: 1px dashed #000000; margin: 5px 0; }
    .divider-solid { border-top: 1.5px solid #000000; margin: 5px 0; }
    .kv { display: flex; justify-content: space-between; gap: 6px; margin: 1.5px 0; }
    .kv-label { flex-shrink: 0; }
    .kv-val { text-align: right; word-break: break-word; }
    .line-item { padding: 3px 0; border-bottom: 1px dotted #666666; }
    .line-item:last-child { border-bottom: none; }
    .line-desc { font-weight: 700; word-break: break-word; }
    .line-meta { display: flex; justify-content: space-between; gap: 4px; font-size: ${is80 ? '10px' : '9px'}; margin-top: 1px; }
    .line-note { font-size: 9px; margin-top: 1px; }
    .grand { font-size: ${is80 ? '13px' : '12px'}; font-weight: 800; }
    .notes-block { font-size: 9px; margin-top: 4px; word-break: break-word; }
    .sig-line { margin-top: 14px; border-top: 1px dashed #000000; padding-top: 2px; font-size: 9px; }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <div class="company">${escapeHtml(companyName)}</div>
      <div class="sub">${escapeHtml(branchName)}</div>
      <div class="divider-solid"></div>
      <div class="doc-title">PURCHASE ORDER</div>
      <div class="bold">${escapeHtml(po.poNumber)}</div>
      <div class="sub">[${escapeHtml(statusLabel)}]</div>
    </div>

    <div class="divider"></div>
    <div class="kv"><span class="kv-label">Supplier:</span><span class="kv-val bold">${escapeHtml(po.supplierName || 'Unspecified')}</span></div>
    ${po.supplierPhone ? `<div class="kv"><span class="kv-label">Phone:</span><span class="kv-val">${escapeHtml(po.supplierPhone)}</span></div>` : ''}
    <div class="kv"><span class="kv-label">Date:</span><span class="kv-val">${escapeHtml(po.orderDate)}</span></div>
    ${po.expectedDeliveryDate ? `<div class="kv"><span class="kv-label">Due:</span><span class="kv-val">${escapeHtml(po.expectedDeliveryDate)}</span></div>` : ''}
    ${po.paymentTerms ? `<div class="kv"><span class="kv-label">Terms:</span><span class="kv-val">${escapeHtml(po.paymentTerms)}</span></div>` : ''}

    <div class="divider-solid"></div>
    <div class="lines">
      ${linesHtml}
    </div>
    <div class="divider-solid"></div>

    <div class="kv"><span>Items / Qty:</span><span>${(po.lines || []).length} lines (${po.totalCases || 0}cs / ${Number(po.totalUnits || 0)}u)</span></div>
    <div class="kv"><span>Subtotal:</span><span>${fmtMoney(po.subtotal)}</span></div>
    ${Number(po.taxAmount || 0) > 0 ? `<div class="kv"><span>Tax (${po.taxPercent || 0}%):</span><span>${fmtMoney(po.taxAmount)}</span></div>` : ''}
    <div class="divider"></div>
    <div class="kv grand"><span>GRAND TOTAL</span><span>${fmtMoney(po.grandTotal)}</span></div>

    ${po.notes ? `<div class="divider"></div><div class="notes-block"><span class="bold">Notes:</span> ${escapeHtml(po.notes)}</div>` : ''}

    <div class="divider"></div>
    <div class="kv sub"><span>Prepared By:</span><span>${escapeHtml(po.createdByName || 'Staff')}</span></div>
    <div class="kv sub"><span>Approval:</span><span>${po.approvedByName ? escapeHtml(po.approvedByName) : 'Pending Approval'}</span></div>
    ${!po.approvedByName ? `<div class="sig-line">Manager Signature</div>` : ''}
    <div class="divider"></div>
    <div class="center sub">Printed ${escapeHtml(new Date().toLocaleString())}</div>
  </div>
</body>
</html>`;
}

function printHtmlInHiddenIframe(
  frameId: string,
  html: string
): { success: boolean; error?: string } {
  if (typeof document === 'undefined') {
    return { success: false, error: 'Printing is only available in a browser environment.' };
  }
  const existing = document.getElementById(frameId);
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const iframe = document.createElement('iframe');
  iframe.id = frameId;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    return { success: false, error: 'Could not initialize print frame.' };
  }

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.error(`[${frameId}] print error:`, err);
    }
    setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 60_000);
  };

  iframe.onload = triggerPrint;
  doc.open();
  doc.write(html);
  doc.close();

  // Fallback trigger in case onload already fired synchronously on doc.close()
  setTimeout(triggerPrint, 120);
  return { success: true };
}

/**
 * Prints an A4 commercial Purchase Order using a hidden iframe (iframe-safe, zero window.open).
 */
export function printPurchaseOrderA4(po: PurchaseOrder): { success: boolean; message: string } {
  const html = buildPurchaseOrderA4Html(po);
  const res = printHtmlInHiddenIframe('saimetric-po-a4-print-frame', html);
  if (!res.success) {
    return { success: false, message: res.error || 'Could not initialize A4 print frame.' };
  }
  return { success: true, message: `Opened A4 print dialog for ${po.poNumber}.` };
}

/**
 * Opens a 58mm (or 80mm) thermal-formatted browser/system print dialog using a hidden iframe.
 * Works with Android RawBT / Bluetooth Print Service / USB thermal / desktop system print dialogs.
 */
export function printPurchaseOrderThermalFallback(
  po: PurchaseOrder,
  paperWidth: PaperWidth = '58mm'
): { success: boolean; message: string } {
  const html = buildPurchaseOrderThermal58mmHtml(po, paperWidth);
  const res = printHtmlInHiddenIframe('saimetric-po-thermal-print-frame', html);
  if (!res.success) {
    return { success: false, message: res.error || `Could not initialize ${paperWidth} print frame.` };
  }
  return {
    success: true,
    message: `Opened ${paperWidth} thermal print dialog for ${po.poNumber}.`,
  };
}

export interface ThermalPrintResult {
  success: boolean;
  mode: 'bluetooth' | 'browser_fallback';
  bluetoothAvailable: boolean;
  message: string;
}

/**
 * Prints a Purchase Order to a 58mm (or 80mm) thermal printer.
 * - Uses direct Web Bluetooth ESC/POS when connected (or a saved printer silently reconnects).
 * - Automatically falls back to the 58mm thermal system/browser print dialog when Bluetooth is
 *   not paired/connected or unsupported (so pressing Print 58mm always produces immediate output).
 */
export async function printPurchaseOrderThermal(
  po: PurchaseOrder,
  paperWidth: PaperWidth = '58mm'
): Promise<ThermalPrintResult> {
  const bluetoothAvailable = !bluetoothPrinter.isInIframe() && bluetoothPrinter.isSupported();
  const canTryDirectBluetooth =
    bluetoothAvailable && (bluetoothPrinter.isConnected() || Boolean(bluetoothPrinter.getSavedPrinter()));

  if (canTryDirectBluetooth) {
    try {
      const btRes = await bluetoothPrinter.printPurchaseOrder(po, paperWidth);
      return {
        success: btRes.success,
        mode: 'bluetooth',
        bluetoothAvailable,
        message: btRes.message,
      };
    } catch (err) {
      console.warn('[printPurchaseOrderThermal] Bluetooth print unavailable, falling back to 58mm browser print:', err);
    }
  }

  const fallback = printPurchaseOrderThermalFallback(po, paperWidth);
  return {
    success: fallback.success,
    mode: 'browser_fallback',
    bluetoothAvailable,
    message: fallback.success
      ? bluetoothAvailable
        ? `Opened ${paperWidth} print dialog for ${po.poNumber}. Pair Bluetooth printer below for 1-tap direct printing.`
        : fallback.message
      : fallback.message,
  };
}
