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
  const statusLabel = po.status.replace(/_/g, ' ');

  const rowsHtml = (po.lines || [])
    .map((line, idx) => {
      const hasCustomDesc =
        line.poDescription &&
        line.masterDescription &&
        line.poDescription.trim().toLowerCase() !== line.masterDescription.trim().toLowerCase();
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
            ${hasCustomDesc ? `<div class="sub-note">Master Ref: ${escapeHtml(line.masterDescription)}</div>` : ''}
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
            <th>Description / Flavour Specification</th>
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

/**
 * Prints an A4 commercial Purchase Order using a hidden iframe (iframe-safe, zero window.open).
 */
export function printPurchaseOrderA4(po: PurchaseOrder): { success: boolean; message: string } {
  if (typeof document === 'undefined') {
    return { success: false, message: 'Printing is only available in a browser environment.' };
  }
  const html = buildPurchaseOrderA4Html(po);
  const existing = document.getElementById('saimetric-po-a4-print-frame');
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'saimetric-po-a4-print-frame';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    return { success: false, message: 'Could not initialize A4 print frame.' };
  }
  doc.open();
  doc.write(html);
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.error('[printPurchaseOrderA4] print error:', err);
    }
    setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 60_000);
  };

  if (iframe.contentWindow) {
    setTimeout(triggerPrint, 250);
  }
  return { success: true, message: `Opened A4 print dialog for ${po.poNumber}.` };
}

/**
 * Prints a Purchase Order to a 58mm (or 80mm) Bluetooth ESC/POS thermal printer.
 */
export async function printPurchaseOrderThermal(
  po: PurchaseOrder,
  paperWidth: PaperWidth = '58mm'
): Promise<{ success: boolean; message: string }> {
  return bluetoothPrinter.printPurchaseOrder(po, paperWidth);
}
