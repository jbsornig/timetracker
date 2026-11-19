// Line items from a Mercedes (proQ) purchase order in the "Document Number:" layout.
//
// Each item reads: "Item N / Description / <text> / Quantity / <qty> <unit> /
// Price Per Unit / <price> USD / <per> <unit> / [Delivery Date / <date>] / Total Net Price / <amount> USD".
// Items can be split by the header that repeats at the top of every page, so that is removed first.

const PAGE_HEADER_PATTERN = /\n*Purchase Order\nDocument Number:\n\d+\nSupplier No\.:[^\n]*\nDate:[^\n]*\nName:[^\n]*\nPage: \d+\/\d+\n/g;

const ITEM_PATTERN = new RegExp([
  'Item (\\d+)[^\\S\\n]*\\n',
  'Description\\n([\\s\\S]+?)\\n',
  'Quantity\\n([\\d,.]+)\\s+([^\\n]+)\\n',
  'Price Per Unit\\n([\\d,.]+)\\s*USD(?:\\s*/\\s*([\\d,.]+))?[^\\n]*\\n',
  '(?:Delivery Date\\n[^\\n]*\\n)?',
  'Total Net Price\\n([\\d,.]+)\\s*USD',
].join(''), 'g');

const UNIT_CODES = {
  each: 'EA', ea: 'EA', piece: 'EA', pieces: 'EA',
  hour: 'HR', hours: 'HR', hr: 'HR', hrs: 'HR', h: 'HR',
  lot: 'LO', lots: 'LO',
  month: 'MON', months: 'MON',
};

function toNumber(text) {
  return parseFloat(String(text).replace(/,/g, ''));
}

function toUnitCode(unit) {
  const word = unit.trim().toLowerCase();
  return UNIT_CODES[word] || word.toUpperCase();
}

function parseMercedesItems(text) {
  const body = text.replace(PAGE_HEADER_PATTERN, '\n');
  return [...body.matchAll(ITEM_PATTERN)].map((match) => {
    const [, number, description, quantity, unit, price, per, total] = match;
    const priceUnits = per ? toNumber(per) : 1;
    return {
      line_number: parseInt(number, 10),
      description: description.split('\n').map(part => part.trim()).filter(Boolean).join(' '),
      quantity: toNumber(quantity),
      uom: toUnitCode(unit),
      unit_price: priceUnits > 0 ? toNumber(price) / priceUnits : toNumber(price),
      po_line_amount: toNumber(total),
    };
  });
}

// "Your technical contact person:" is followed by the name, an optional phone line in any
// format (e.g. "+1 205 534-0278"), then the email.
const CONTACT_PATTERN = /Your technical contact person:\s*\n([^\n]+)\n(?:[^\n@]*\n)?\s*([\w.+-]+@[\w.-]+)/;

function parseMercedesContact(text) {
  const match = text.match(CONTACT_PATTERN);
  return match ? { name: match[1].trim(), email: match[2].trim() } : { name: '', email: '' };
}

module.exports = { parseMercedesItems, parseMercedesContact };
