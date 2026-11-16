// Document generation (jsPDF + AutoTable) and spreadsheet export (SheetJS).
// All libraries are bundled locally so these work offline.
import { loadScript, moneyPlain, fmtDate, download, todayISO } from './utils.js';
import { openModal, html, icon, toast } from './ui.js';
import { getState } from './state.js';
import { MEASUREMENT_FIELDS } from './core/defaults.js';
import { convertLength, round } from './core/calc.js';

const NAVY = [17, 27, 49];
const GOLD = [197, 154, 60];
const GREY = [110, 116, 128];

async function pdfLib() {
  if (!window.jspdf) await loadScript('js/vendor/jspdf.umd.min.js');
  if (!window.jspdf.jsPDF.API.autoTable) await loadScript('js/vendor/jspdf.plugin.autotable.min.js');
  return window.jspdf.jsPDF;
}
async function xlsxLib() {
  if (!window.XLSX) await loadScript('js/vendor/xlsx.full.min.js');
  return window.XLSX;
}

const safeName = (s) => String(s).replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
/** jsPDF core fonts are Latin-1 only; replace characters they cannot draw. */
const t = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/₦/g, 'NGN ').replace(/[^\x00-\xFF]/g, '');

function header(doc, title, subtitle = '') {
  const b = getState().business || {};
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 34, 'F');
  let x = 14;
  if (b.logo) {
    try { doc.addImage(b.logo, b.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', 14, 7, 20, 20, undefined, 'FAST'); x = 38; } catch { /* unsupported image */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(t(b.name || 'Fabriqon'), x, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.setTextColor(200, 206, 220);
  const contact = [b.address, [b.city, b.state].filter(Boolean).join(', '), [b.phone, b.email].filter(Boolean).join('  ·  ')].filter(Boolean);
  contact.slice(0, 2).forEach((line, i) => doc.text(t(line), x, 21 + i * 4.5));
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text(t(title), W - 14, 16, { align: 'right' });
  if (subtitle) { doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(220, 224, 232); doc.text(t(subtitle), W - 14, 23, { align: 'right' }); }
  doc.setTextColor(30, 34, 41);
  return 46;
}

function footer(doc, note = 'Thank you for your patronage.') {
  const pages = doc.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4); doc.line(14, H - 16, W - 14, H - 16);
    doc.setFontSize(8); doc.setTextColor(...GREY);
    doc.text(t(note), 14, H - 10);
    doc.text(`Generated with Fabriqon · page ${i} of ${pages}`, W - 14, H - 10, { align: 'right' });
  }
}

function block(doc, x, y, title, lines) {
  doc.setFontSize(8); doc.setTextColor(...GREY); doc.setFont('helvetica', 'bold');
  doc.text(t(title.toUpperCase()), x, y);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 34, 41); doc.setFontSize(10);
  lines.filter(Boolean).forEach((l, i) => doc.text(t(l), x, y + 5.5 + i * 5));
  return y + 5.5 + lines.filter(Boolean).length * 5;
}

const tableStyle = {
  theme: 'grid',
  styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 2.6, lineColor: [229, 225, 216], lineWidth: 0.2, textColor: [30, 34, 41] },
  headStyles: { fillColor: [243, 241, 236], textColor: [86, 93, 107], fontStyle: 'bold', fontSize: 8.5 },
  alternateRowStyles: { fillColor: [251, 250, 248] },
  margin: { left: 14, right: 14 },
};

/** Shows a generated PDF with Download and Print options. */
function present(doc, filename) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const wide = window.innerWidth > 700;
  const m = openModal({
    title: filename, size: 'lg',
    body: wide ? html`<iframe src="${url}" title="PDF preview" style="width:100%;height:65vh;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>` : html`<p class="muted">Your document is ready.</p>`,
    footer: html`<span class="spacer"></span><button class="btn btn-secondary" data-print>${icon('printer', 16)} Open to print</button><button class="btn btn-primary" data-dl>${icon('download', 16)} Download PDF</button>`,
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000),
  });
  m.dialog.querySelector('[data-dl]').addEventListener('click', () => { download(blob, filename); toast('PDF downloaded.', { type: 'success' }); });
  m.dialog.querySelector('[data-print]').addEventListener('click', () => {
    const w = window.open(url, '_blank');
    if (!w) download(blob, filename);
  });
}

export async function invoicePdf(order, customer) {
  const JsPDF = await pdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const invNo = `INV-${order.number.replace('ORD-', '')}`;
  let y = header(doc, 'INVOICE', invNo);
  const W = doc.internal.pageSize.getWidth();
  block(doc, 14, y, 'Bill to', [customer?.name || 'Customer', customer?.phone, customer?.email, customer?.address]);
  block(doc, W / 2 + 10, y, 'Details', [`Invoice date: ${fmtDate(todayISO())}`, `Order: ${order.number}`, `Order date: ${fmtDate(order.orderDate)}`, order.dueDate ? `Delivery: ${fmtDate(order.dueDate)}` : '']);
  y += 34;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(t(order.title), 14, y); y += 4;
  doc.autoTable({
    ...tableStyle, startY: y,
    head: [['Description', 'Qty', 'Unit price', 'Amount']],
    body: order.items.map(i => [t(i.description), i.qty, moneyPlain(i.unitPrice), moneyPlain(i.unitPrice * i.qty)]),
    columnStyles: { 1: { halign: 'right', cellWidth: 16 }, 2: { halign: 'right', cellWidth: 36 }, 3: { halign: 'right', cellWidth: 38 } },
  });
  y = doc.lastAutoTable.finalY + 8;
  const rows = [
    ['Subtotal', moneyPlain(order.total + (order.discount || 0))],
    ...(order.discount ? [['Discount', `- ${moneyPlain(order.discount)}`]] : []),
    ['Total', moneyPlain(order.total)],
    ['Amount paid', moneyPlain(order.paid)],
    [order.credit > 0 ? 'Credit' : 'Balance due', moneyPlain(order.credit > 0 ? order.credit : order.balance)],
  ];
  rows.forEach(([k, v], i) => {
    const last = i === rows.length - 1;
    if (last) { doc.setFillColor(...NAVY); doc.rect(W - 98, y - 5, 84, 9, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); }
    else { doc.setTextColor(30, 34, 41); doc.setFont('helvetica', k === 'Total' ? 'bold' : 'normal'); }
    doc.setFontSize(10);
    doc.text(t(k), W - 95, y); doc.text(t(v), W - 17, y, { align: 'right' });
    y += 8;
  });
  doc.setTextColor(30, 34, 41);
  if (order.payments.length) {
    y += 4;
    doc.autoTable({ ...tableStyle, startY: y, head: [['Receipt', 'Date', 'Method', 'Amount']], body: order.payments.map(p => [p.receiptNo, fmtDate(p.date), t(p.method), `${p.type === 'refund' ? '- ' : ''}${moneyPlain(p.amount)}`]), columnStyles: { 3: { halign: 'right' } } });
  }
  footer(doc);
  present(doc, `${invNo}-${safeName(customer?.name || '')}.pdf`);
}

export async function receiptPdf(payment, order, customer) {
  const JsPDF = await pdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a5' });
  const W = doc.internal.pageSize.getWidth();
  let y = header(doc, payment.type === 'refund' ? 'REFUND' : 'RECEIPT', payment.receiptNo);
  doc.setFontSize(10);
  y = block(doc, 14, y, 'Received from', [customer?.name || 'Customer', customer?.phone]) + 6;
  doc.setFillColor(246, 237, 217); doc.roundedRect(14, y, W - 28, 20, 2, 2, 'F');
  doc.setFontSize(9); doc.setTextColor(...GREY); doc.text(payment.type === 'refund' ? 'AMOUNT REFUNDED' : 'AMOUNT RECEIVED', 19, y + 7);
  doc.setFontSize(17); doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.text(moneyPlain(payment.amount), 19, y + 15.5);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 34, 41);
  y += 30;
  doc.autoTable({ ...tableStyle, theme: 'plain', startY: y, styles: { ...tableStyle.styles, fontSize: 9.5 },
    body: [['Date', fmtDate(payment.date)], ['Method', t(payment.method)], ['Reference', t(payment.reference || '-')], ['Order', `${order?.number || ''} · ${t(order?.title || '')}`], ['Order total', moneyPlain(order?.total || 0)], ['Total paid to date', moneyPlain(order?.paid || 0)], ['Balance remaining', moneyPlain(order?.balance || 0)]],
    columnStyles: { 0: { textColor: GREY, cellWidth: 40 }, 1: { fontStyle: 'bold' } },
  });
  footer(doc);
  present(doc, `${payment.receiptNo}.pdf`);
}

export async function measurementSheetPdf(m, customer, tpl, unit = m.unit) {
  const JsPDF = await pdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = header(doc, 'MEASUREMENTS', `${m.templateName} · v${m.version}`);
  block(doc, 14, y, 'Customer', [customer?.name || '', customer?.phone, customer?.code]);
  block(doc, W / 2 + 10, y, 'Record', [`Taken: ${fmtDate(m.takenAt)}`, `Unit: ${unit === 'cm' ? 'centimetres' : 'inches'}`, m.unit !== unit ? `(converted from ${m.unit})` : '']);
  y += 30;
  const label = (k) => tpl?.labels?.[k] || MEASUREMENT_FIELDS[k]?.label || k;
  const body = [
    ...Object.entries(m.values).map(([k, v]) => [t(label(k)), k === 'age' ? `${v} yrs` : `${round(convertLength(v, m.unit, unit), 2)} ${unit}`]),
    ...m.custom.map(c => [t(c.label), `${round(convertLength(c.value, m.unit, unit), 2)} ${unit}`]),
  ];
  const half = Math.ceil(body.length / 2);
  const rows = Array.from({ length: half }, (_, i) => [...body[i], ...(body[i + half] || ['', ''])]);
  doc.autoTable({ ...tableStyle, startY: y, head: [['Measurement', 'Value', 'Measurement', 'Value']], body: rows, columnStyles: { 1: { halign: 'right', fontStyle: 'bold' }, 3: { halign: 'right', fontStyle: 'bold' } } });
  y = doc.lastAutoTable.finalY + 10;
  if (m.notes) { doc.setFontSize(9); doc.setTextColor(...GREY); doc.text('NOTES', 14, y); doc.setTextColor(30, 34, 41); doc.setFontSize(10); doc.text(doc.splitTextToSize(t(m.notes), W - 28), 14, y + 6); y += 20; }
  doc.setDrawColor(200); doc.line(14, y + 18, 80, y + 18); doc.line(W - 80, y + 18, W - 14, y + 18);
  doc.setFontSize(8.5); doc.setTextColor(...GREY); doc.text('Measured by', 14, y + 23); doc.text('Customer signature', W - 80, y + 23);
  footer(doc, 'Please check your measurements. Changes after cutting may attract extra charges.');
  present(doc, `measurements-${safeName(customer?.name || 'customer')}-v${m.version}.pdf`);
}

export async function quotationPdf({ customerName, items, notes, validDays = 14 }) {
  const JsPDF = await pdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const no = `QT-${Date.now().toString().slice(-6)}`;
  let y = header(doc, 'QUOTATION', no);
  block(doc, 14, y, 'Prepared for', [customerName || 'Customer']);
  block(doc, W / 2 + 10, y, 'Details', [`Date: ${fmtDate(todayISO())}`, `Valid for ${validDays} days`]);
  y += 24;
  const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  doc.autoTable({ ...tableStyle, startY: y, head: [['Description', 'Qty', 'Unit price', 'Amount']], body: items.map(i => [t(i.description), i.qty, moneyPlain(i.unitPrice), moneyPlain(i.qty * i.unitPrice)]), foot: [['', '', 'Total', moneyPlain(total)]], footStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold' }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
  y = doc.lastAutoTable.finalY + 10;
  if (notes) { doc.setFontSize(10); doc.text(doc.splitTextToSize(t(notes), W - 28), 14, y); }
  footer(doc, 'Prices are estimates and may change if the design or fabric changes.');
  present(doc, `${no}.pdf`);
}

/** Generic report PDF: sections of { title, kv: [[k,v]] } or { title, head, body }. */
export async function reportPdf(title, subtitle, sections) {
  const JsPDF = await pdfLib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  let y = header(doc, title.toUpperCase(), subtitle);
  for (const s of sections) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY); doc.text(t(s.title), 14, y);
    doc.setTextColor(30, 34, 41);
    doc.autoTable({ ...tableStyle, startY: y + 3, head: s.head ? [s.head.map(t)] : undefined, body: (s.kv || s.body).map(r => r.map(c => t(c))), columnStyles: s.kv ? { 0: { textColor: GREY, cellWidth: 70 }, 1: { fontStyle: 'bold', halign: 'right' } } : {} });
    y = doc.lastAutoTable.finalY + 10;
  }
  footer(doc, 'Figures are calculated from records stored in Fabriqon on this device.');
  present(doc, `${safeName(title)}-${todayISO()}.pdf`);
}

// ---------- Spreadsheets ----------
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // prevent CSV formula injection
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};
export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return [cols.map(csvCell).join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n');
}

export async function exportWorkbook(name, sheets) {
  const XLSX = await xlsxLib();
  const wb = XLSX.utils.book_new();
  for (const [sheet, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No records' }]);
    const cols = Object.keys(rows[0] || { Note: '' });
    ws['!cols'] = cols.map(c => ({ wch: Math.min(40, Math.max(c.length, ...rows.slice(0, 200).map(r => String(r[c] ?? '').length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  }
  XLSX.writeFile(wb, `${safeName(name)}-${todayISO()}.xlsx`);
}

/** Asks for a format, then exports rows as Excel or CSV. */
export function exportRows(name, rows) {
  if (!rows.length) { toast('Nothing to export yet.', { type: 'warning' }); return; }
  const m = openModal({
    title: `Export ${name.replace(/-/g, ' ')}`, size: 'sm',
    body: html`<p class="muted small mb-3">${rows.length} row(s). Choose a format:</p><div class="stack-sm">
      <button class="btn btn-secondary btn-block" data-f="xlsx">${icon('file-spreadsheet', 16)} Excel (.xlsx)</button>
      <button class="btn btn-secondary btn-block" data-f="csv">${icon('file-text', 16)} CSV (.csv)</button></div>`,
  });
  m.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    try {
      if (b.dataset.f === 'xlsx') await exportWorkbook(name, { [name.slice(0, 31)]: rows });
      else download(`﻿${toCsv(rows)}`, `${safeName(name)}-${todayISO()}.csv`, 'text/csv;charset=utf-8');
      toast('Export downloaded.', { type: 'success' });
      m.close();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
}

