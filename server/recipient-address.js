// The invoice "Bill To" block, laid out so invoice-reading systems (Basware and similar)
// can pick the recipient out as its own region. Those readers often join the PDF's text
// lines with no break, so every line but the last ends in a comma: "Bruselas, 30, 28108"
// instead of "Bruselas, 3028108".
const { escapeHtml } = require('./po-line-billing');

const LINE_END_PUNCTUATION = /[,;:]$/;
// Each line carries a real trailing space so joined text reads "S.A.U. CIF", not "S.A.U.CIF"
const KEEP_TRAILING_SPACE = 'white-space: pre-wrap;';

function formatRecipientLines(customerName, address) {
  const lines = [customerName, ...String(address || '').split(/\r?\n/)]
    .map(line => String(line || '').trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    const isNameOrLast = index === 0 || index === lines.length - 1;
    return isNameOrLast || LINE_END_PUNCTUATION.test(line) ? line : `${line},`;
  });
}

function renderRecipientBlockHtml(customerName, address) {
  const [name, ...addressLines] = formatRecipientLines(customerName, address).map(escapeHtml);
  return `
    <div style="border: 1px solid #999; border-radius: 4px; padding: 8px 14px; min-width: 260px; max-width: 360px;">
      <div style="font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #444; margin-bottom: 4px;">Bill To:</div>
      <div style="line-height: 1.5;">
        <div style="font-weight: bold; ${KEEP_TRAILING_SPACE}">${name || ''} </div>
        ${addressLines.map(line => `<div style="${KEEP_TRAILING_SPACE}">${line} </div>`).join('')}
      </div>
    </div>`;
}

module.exports = { formatRecipientLines, renderRecipientBlockHtml };
