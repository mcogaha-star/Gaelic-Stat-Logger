import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export const REPORT_EXPORT_WIDTH = 1440;
export const REPORT_EXPORT_TABLE_ROW_LIMIT = 15;

export function sanitizeExportFilePart(value, fallback = 'report') {
  const text = String(value || fallback).trim().toLowerCase();
  return (text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback).slice(0, 80);
}

function waitForFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function expandScrollableNodes(root) {
  if (!(root instanceof HTMLElement)) return;
  root.querySelectorAll('*').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const style = window.getComputedStyle(node);
    const hasScrollableOverflow = ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)
      || ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX);
    if (!hasScrollableOverflow) return;
    node.style.overflow = 'visible';
    node.style.overflowX = 'visible';
    node.style.overflowY = 'visible';
    node.style.maxHeight = 'none';
    node.style.height = 'auto';
  });
}

function trimTables(root, maxRows = REPORT_EXPORT_TABLE_ROW_LIMIT) {
  if (!(root instanceof HTMLElement)) return;
  root.querySelectorAll('table').forEach((table) => {
    if (!(table instanceof HTMLTableElement)) return;
    let trimmed = false;
    table.querySelectorAll('tbody').forEach((body) => {
      if (!(body instanceof HTMLTableSectionElement)) return;
      const rows = Array.from(body.querySelectorAll(':scope > tr'));
      if (rows.length <= maxRows) return;
      rows.slice(maxRows).forEach((row) => row.remove());
      trimmed = true;
    });
    if (!trimmed) return;
    if (table.parentElement?.querySelector(':scope > [data-export-table-trim-note="true"]')) return;
    const note = document.createElement('div');
    note.dataset.exportTableTrimNote = 'true';
    note.className = 'mt-2 text-xs font-medium text-slate-500';
    note.textContent = `Top ${maxRows} rows shown`;
    table.insertAdjacentElement('afterend', note);
  });
}

function normalizeCloneForExport(root) {
  if (!(root instanceof HTMLElement)) return;
  root.style.width = '100%';
  root.style.maxWidth = '100%';
  root.style.minWidth = '0';
  root.style.height = 'auto';
  root.style.maxHeight = 'none';
  root.style.overflow = 'visible';
  root.style.background = '#ffffff';
  expandScrollableNodes(root);
  trimTables(root);
}

function createCaptureShell({ title, subtitle, sectionLabel, clonedNode }) {
  const shell = document.createElement('div');
  shell.style.width = `${REPORT_EXPORT_WIDTH}px`;
  shell.style.background = '#ffffff';
  shell.style.color = '#0f172a';
  shell.style.padding = '28px';
  shell.style.boxSizing = 'border-box';
  shell.style.fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'flex-start';
  header.style.gap = '20px';
  header.style.marginBottom = '20px';

  const headerLeft = document.createElement('div');
  const titleNode = document.createElement('div');
  titleNode.textContent = title;
  titleNode.style.fontSize = '28px';
  titleNode.style.fontWeight = '700';
  titleNode.style.lineHeight = '1.15';
  const subtitleNode = document.createElement('div');
  subtitleNode.textContent = subtitle;
  subtitleNode.style.marginTop = '8px';
  subtitleNode.style.fontSize = '14px';
  subtitleNode.style.color = '#475569';
  headerLeft.appendChild(titleNode);
  headerLeft.appendChild(subtitleNode);

  const sectionNode = document.createElement('div');
  sectionNode.textContent = sectionLabel;
  sectionNode.style.fontSize = '14px';
  sectionNode.style.fontWeight = '600';
  sectionNode.style.color = '#0f172a';
  sectionNode.style.whiteSpace = 'nowrap';

  header.appendChild(headerLeft);
  header.appendChild(sectionNode);
  shell.appendChild(header);
  shell.appendChild(clonedNode);

  normalizeCloneForExport(shell);
  return shell;
}

async function renderElementToCanvas(shell) {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-20000px';
  host.style.top = '0';
  host.style.width = `${REPORT_EXPORT_WIDTH}px`;
  host.style.zIndex = '-1';
  host.style.pointerEvents = 'none';
  host.style.background = '#ffffff';
  host.appendChild(shell);
  document.body.appendChild(host);
  await waitForFrame();
  await waitForFrame();
  const canvas = await html2canvas(shell, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false,
    width: REPORT_EXPORT_WIDTH,
    windowWidth: REPORT_EXPORT_WIDTH,
  });
  host.remove();
  return canvas;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function canvasToJpegBlob(canvas, quality = 0.92) {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create JPEG blob'));
    }, 'image/jpeg', quality);
  });
}

export async function captureReportPaneCanvas(sourceElement, options = {}) {
  if (!(sourceElement instanceof HTMLElement)) {
    throw new Error('Export source not found');
  }
  const clonedNode = sourceElement.cloneNode(true);
  const shell = createCaptureShell({
    title: options.reportTitle || 'GaeliQ Report',
    subtitle: options.reportSubtitle || '',
    sectionLabel: options.sectionLabel || 'Section',
    clonedNode,
  });
  return await renderElementToCanvas(shell);
}

export async function exportReportTargetsAsJpegs(targets, options = {}) {
  const failures = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    try {
      const canvas = await captureReportPaneCanvas(target.element, {
        reportTitle: options.reportTitle,
        reportSubtitle: options.reportSubtitle,
        sectionLabel: target.sectionLabel,
      });
      const blob = await canvasToJpegBlob(canvas);
      downloadBlob(blob, target.fileName);
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (error) {
      failures.push({ target, error });
    }
  }
  return { ok: failures.length === 0, failures };
}

export async function exportReportTargetsAsPdf(targets, options = {}) {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const printableWidth = pageWidth - (margin * 2);
  const printableHeight = pageHeight - (margin * 2);

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const canvas = await captureReportPaneCanvas(target.element, {
      reportTitle: options.reportTitle,
      reportSubtitle: options.reportSubtitle,
      sectionLabel: target.sectionLabel,
    });
    const imageData = canvas.toDataURL('image/jpeg', 0.94);
    const imageHeight = (canvas.height * printableWidth) / canvas.width;
    let heightLeft = imageHeight;
    let positionY = margin;

    if (index > 0) pdf.addPage();
    pdf.addImage(imageData, 'JPEG', margin, positionY, printableWidth, imageHeight, undefined, 'FAST');
    heightLeft -= printableHeight;

    while (heightLeft > 0) {
      pdf.addPage();
      positionY = margin - (imageHeight - heightLeft);
      pdf.addImage(imageData, 'JPEG', margin, positionY, printableWidth, imageHeight, undefined, 'FAST');
      heightLeft -= printableHeight;
    }
  }

  pdf.save(options.fileName || 'gaeliq_report_export.pdf');
  return { ok: true };
}
