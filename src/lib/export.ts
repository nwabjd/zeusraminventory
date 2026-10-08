/* ===========================================================================
   Export helpers: CSV, Excel (SpreadsheetML) and print-to-PDF.
   ---------------------------------------------------------------------------
   All three run entirely in the frontend - ZEUS is offline-first, so there is
   no server to stream a file from. "PDF" opens the print dialog with the print
   stylesheet applied, which is exactly what a shop owner expects from Ctrl+P.
   =========================================================================== */

import { amount, fileStamp, money } from "./format";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Right-align in CSV/Excel and use a numeric cell. */
  numeric?: boolean;
  width?: number;
}

export interface ExportOptions<T> {
  filename: string;
  title: string;
  subtitle?: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Rendered into the print/PDF header. */
  meta?: { label: string; value: string }[];
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/* ------------------------------------------------------------------ CSV -- */

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv<T>(opts: ExportOptions<T>): string {
  const lines: string[] = [];
  lines.push(csvEscape(opts.title));
  if (opts.subtitle) lines.push(csvEscape(opts.subtitle));
  if (opts.meta?.length) {
    lines.push(csvEscape(opts.meta.map((m) => `${m.label}: ${m.value}`).join("   |   ")));
  }
  lines.push("");
  lines.push(opts.columns.map((c) => csvEscape(c.header)).join(","));
  for (const row of opts.rows) {
    lines.push(opts.columns.map((c) => csvEscape(cell(c.value(row)))).join(","));
  }
  // Excel on Windows needs the BOM to detect UTF-8.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/* ---------------------------------------------------------------- Excel -- */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Control characters are illegal in XML and make Excel refuse the file.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/**
 * SpreadsheetML 2003 - a single `.xls` file Excel opens natively with no
 * add-in, no library, and no network. Chosen over a zip-based `.xlsx` because
 * writing a zip in the browser would mean shipping a compression library for a
 * feature a shop owner uses once a month.
 */
export function toExcelXml<T>(opts: ExportOptions<T>): string {
  const headerCells = opts.columns
    .map(
      (c) =>
        `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEscape(c.header)}</Data></Cell>`,
    )
    .join("");

  const bodyRows = opts.rows
    .map((row) => {
      const cells = opts.columns
        .map((c, i) => {
          const v = cell(c.value(row));
          if (c.numeric && v !== "" && Number.isFinite(Number(v))) {
            return `<Cell ss:StyleID="num" ss:Index="${i + 1}"><Data ss:Type="Number">${Number(v)}</Data></Cell>`;
          }
          return `<Cell ss:StyleID="txt" ss:Index="${i + 1}"><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  const metaRows = (opts.meta ?? [])
    .map(
      (m) =>
        `<Row><Cell ss:StyleID="txt"><Data ss:Type="String">${xmlEscape(`${m.label}: ${m.value}`)}</Data></Cell><Cell/></Row>`,
    )
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10"/>
  </Style>
  <Style ss:ID="hdr">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1D3ED8" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
  </Style>
  <Style ss:ID="txt">
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="num" ss:Parent="txt">
   <NumberFormat ss:Format="#,##0.00"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="title">
   <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#101828"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${xmlEscape(opts.title.slice(0, 30))}">
  <Table>
   <Column ss:Width="40"/><Column ss:Width="40"/>
   ${opts.columns
     .map((c, i) => `<Column ss:Index="${i + 3}" ss:Width="${c.numeric ? 110 : 200}"/>`)
     .join("")}
   <Row ss:Height="24"><Cell ss:Index="1" ss:StyleID="title"><Data ss:Type="String">${xmlEscape(opts.title)}</Data></Cell></Row>
   ${
     opts.subtitle
       ? `<Row><Cell ss:Index="1" ss:StyleID="txt"><Data ss:Type="String">${xmlEscape(opts.subtitle)}</Data></Cell></Row>`
       : ""
   }
   ${metaRows}
   <Row ss:Height="20"><Cell ss:Index="1"/><Cell ss:Index="2"/></Row>
   <Row ss:Height="26">${headerCells}</Row>
   ${bodyRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/><SplitHorizontal>1</SplitHorizontal>
   <TopRowBottomPane>${opts.columns.length + 4}</TopRowBottomPane>
   <ActivePane>2</ActivePane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

/* -------------------------------------------------------------- printing -- */

export interface PrintOptions<T> extends ExportOptions<T> {
  business?: { name: string; tagline?: string; phone?: string; trn?: string };
}

function printableHtml<T>(opts: PrintOptions<T>): string {
  const head = opts.columns.map((c) => `<th class="${c.numeric ? "num" : ""}">${xmlEscape(c.header)}</th>`).join("");
  const body = opts.rows
    .map(
      (row) =>
        `<tr>${opts.columns
          .map((c) => `<td class="${c.numeric ? "num" : ""}">${xmlEscape(cell(c.value(row)))}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  const numericCols = opts.columns
    .map((c, i) => (c.numeric ? i : -1))
    .filter((i) => i >= 0);
  const totals = numericCols
    .map((i) => {
      const sum = opts.rows.reduce(
        (acc, r) => acc + (Number(opts.columns[i].value(r)) || 0),
        0,
      );
      return `<td class="num">${xmlEscape(amount(sum))}</td>`;
    })
    .join("");
  const blank = opts.columns
    .map((_, i) => (numericCols.includes(i) ? "" : ""))
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${xmlEscape(opts.title)}</title>
<style>
  @page { margin: 14mm; size: A4 landscape; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Inter, Calibri, Arial, sans-serif; color: #101828; margin: 0; font-size: 11px; }
  header { border-bottom: 2px solid #1d3ed8; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: 2px; color: #1d3ed8; }
  .tagline { font-size: 10px; color: #5a6784; letter-spacing: 1px; text-transform: uppercase; margin-top: 2px; }
  .contact { text-align: right; font-size: 10px; color: #5a6784; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .sub { color: #5a6784; font-size: 11px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 10px 0 12px; font-size: 10px; }
  .meta span { color: #5a6784; }
  .meta b { color: #101828; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #101828; color: #fff; text-align: left; padding: 6px 7px; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
  tbody td { padding: 5px 7px; border-bottom: 1px solid #e3e8f0; }
  tbody tr:nth-child(even) { background: #f7f9fc; }
  tfoot td { padding: 7px; border-top: 2px solid #101828; font-weight: 700; background: #f2f5f9; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e3e8f0; display: flex; justify-content: space-between; font-size: 9px; color: #8c98b4; }
</style></head><body>
<header>
  <div>
    <div class="brand">${xmlEscape(opts.business?.name ?? "ZEUS")}</div>
    <div class="tagline">${xmlEscape(opts.business?.tagline ?? "RAM INVENTORY MANAGEMENT")}</div>
  </div>
  <div class="contact">
    ${opts.business?.phone ? `<div>${xmlEscape(opts.business.phone)}</div>` : ""}
    ${opts.business?.trn ? `<div>TRN ${xmlEscape(opts.business.trn)}</div>` : ""}
    <div>Printed ${new Date().toLocaleString("en-GB")}</div>
  </div>
</header>
<h1>${xmlEscape(opts.title)}</h1>
${opts.subtitle ? `<div class="sub">${xmlEscape(opts.subtitle)}</div>` : ""}
<div class="meta">${(opts.meta ?? []).map((m) => `<span>${xmlEscape(m.label)}: <b>${xmlEscape(m.value)}</b></span>`).join("")}</div>
<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${body || `<tr><td colspan="${opts.columns.length}">No records matched these filters.</td></tr>`}</tbody>
  ${opts.rows.length ? `<tfoot><tr>${blank}${totals}</tr></tfoot>` : ""}
</table>
<footer><span>${xmlEscape(opts.business?.name ?? "ZEUS")} - ${xmlEscape(opts.title)}</span><span>${opts.rows.length} record(s)</span></footer>
</body></html>`;
}

/* ------------------------------------------------------------- downloads -- */

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so Safari/Edge has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportCsv<T>(opts: ExportOptions<T>): string {
  const name = `${opts.filename}-${fileStamp()}.csv`;
  download(name, toCsv(opts), "text/csv;charset=utf-8");
  return name;
}

export function exportExcel<T>(opts: ExportOptions<T>): string {
  const name = `${opts.filename}-${fileStamp()}.xls`;
  download(name, toExcelXml(opts), "application/vnd.ms-excel;charset=utf-8");
  return name;
}

/**
 * Opens a print-ready window with the report laid out for A4 landscape. The
 * user chooses "Microsoft Print to PDF" - which is how every Windows shop
 * already produces a PDF.
 */
export function exportPdf<T>(opts: PrintOptions<T>): boolean {
  const win = window.open("", "_blank", "width=1100,height=760");
  if (!win) return false;
  win.document.open();
  win.document.write(printableHtml(opts));
  win.document.close();
  const kick = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === "complete") setTimeout(kick, 250);
  else win.addEventListener("load", () => setTimeout(kick, 250));
  return true;
}

/** In-window print of a rendered DOM node, using the app's print stylesheet. */
export function printElement(elementId: string): void {
  document.body.classList.add("printing-node");
  const el = document.getElementById(elementId);
  if (el) {
    const style = document.createElement("style");
    style.id = "zeus-print-scope";
    style.textContent = `@media print { body * { visibility: hidden !important; } #${elementId}, #${elementId} * { visibility: visible !important; } #${elementId} { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; } .no-print { display: none !important; } }`;
    document.head.appendChild(style);
  }
  window.print();
  setTimeout(() => {
    document.getElementById("zeus-print-scope")?.remove();
    document.body.classList.remove("printing-node");
  }, 300);
}

/** Convenience for money columns - keeps `ExportColumn` declarations short. */
export function moneyColumn<T>(
  header: string,
  value: (row: T) => number,
  currency = "AED",
): ExportColumn<T> {
  return { header, value: (row) => money(value(row), currency), numeric: true };
}
