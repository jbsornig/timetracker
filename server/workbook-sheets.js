// Shared helpers for building Excel workbooks with the xlsx library.

const XLSX = require('xlsx');

const CURRENCY_FORMAT = '#,##0.00';
const MAX_COLUMN_WIDTH = 40;

function roundToCents(amount) {
  return Math.round((amount || 0) * 100) / 100;
}

function sumColumn(rows, column) {
  return roundToCents(rows.reduce((total, row) => total + (Number(row[column]) || 0), 0));
}

function addSheet(workbook, name, rows, currencyColumns = [], emptyMessage = 'No records for this year') {
  const sheet = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([[emptyMessage]]);
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    sheet['!cols'] = headers.map(header => ({
      wch: Math.min(MAX_COLUMN_WIDTH, Math.max(header.length, ...rows.map(row => String(row[header] ?? '').length)) + 2),
    }));
    applyCurrencyFormat(sheet, headers, rows.length, currencyColumns);
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function applyCurrencyFormat(sheet, headers, rowCount, currencyColumns) {
  for (const column of currencyColumns) {
    const columnIndex = headers.indexOf(column);
    if (columnIndex < 0) continue;
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (cell && cell.t === 'n') cell.z = CURRENCY_FORMAT;
    }
  }
}

function newWorkbook() {
  return XLSX.utils.book_new();
}

function writeWorkbook(workbook) {
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function toSafeFilenamePart(text, fallback) {
  return String(text || '').replace(/[^A-Za-z0-9 ]/g, '').trim() || fallback;
}

module.exports = { roundToCents, sumColumn, addSheet, newWorkbook, writeWorkbook, toSafeFilenamePart };
