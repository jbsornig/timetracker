const test = require('node:test');
const assert = require('node:assert');
const { parseMercedesItems, parseMercedesContact } = require('./mercedes-po');

const PAGE_BREAK = '\n\nPurchase Order\nDocument Number:\n1013877091\nSupplier No.:15649390\nDate:18-Nov-2026\nName:Unlimited Technologies Consulting LLC\nPage: 5/7\n';

function item(number, description, quantity, price, total) {
  return `Item ${number}         \nDescription\n${description}\nQuantity\n${quantity} each\nPrice Per Unit\n${price} USD / 1 each\nDelivery Date\n31-Dec-2026\nTotal Net Price\n${total} USD\n`;
}

test('reads every item on a multi-item PO', () => {
  const text = 'Total Net Value\n15,000.00 USD\n'
    + item(1, 'Concept and PLC Interface Spec', '1,000', '1.00', '1,000.00')
    + item(2, 'IDPro Sealer Quality Inspection', '14,000', '1.00', '14,000.00');
  assert.deepStrictEqual(parseMercedesItems(text), [
    { line_number: 1, description: 'Concept and PLC Interface Spec', quantity: 1000, uom: 'EA', unit_price: 1, po_line_amount: 1000 },
    { line_number: 2, description: 'IDPro Sealer Quality Inspection', quantity: 14000, uom: 'EA', unit_price: 1, po_line_amount: 14000 },
  ]);
});

test('reads an item that is split across a page break', () => {
  const full = item(3, 'IDPro Show Position Acknowledge', '13,000', '1.00', '13,000.00');
  const [head, tail] = full.split('\nQuantity');
  const items = parseMercedesItems(`${head}${PAGE_BREAK}Quantity${tail}`);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].description, 'IDPro Show Position Acknowledge');
  assert.strictEqual(items[0].quantity, 13000);
});

test('joins a description that wraps onto two lines', () => {
  const items = parseMercedesItems(item(1, 'PLC Install, config,\nacceptance support', '5,500', '1.00', '5,500.00'));
  assert.strictEqual(items[0].description, 'PLC Install, config, acceptance support');
});

test('divides the price when it is quoted per more than one unit', () => {
  const text = 'Item 1\nDescription\nEngineering\nQuantity\n200 hours\nPrice Per Unit\n9,500.00 USD / 100 hours\nTotal Net Price\n19,000.00 USD\n';
  assert.deepStrictEqual(parseMercedesItems(text)[0], {
    line_number: 1, description: 'Engineering', quantity: 200, uom: 'HR', unit_price: 95, po_line_amount: 19000,
  });
});

test('returns no items when the PO has none in this layout', () => {
  assert.deepStrictEqual(parseMercedesItems('Document no. Date\n1157504889'), []);
});

test('reads the technical contact when the phone number has a dash', () => {
  const text = 'Your technical contact person:\nJohn Chryczyk\n+1 205 534-0278\njohn.j.chryczyk@mercedes-benz.com\nThis Purchase Order';
  assert.deepStrictEqual(parseMercedesContact(text), { name: 'John Chryczyk', email: 'john.j.chryczyk@mercedes-benz.com' });
});

test('reads the technical contact when the phone number is digits only', () => {
  const text = 'Your technical contact person:\nRoberto Luiz De Mello\n+1 205 8726197\nroberto.mello@mercedes-benz.com\n';
  assert.deepStrictEqual(parseMercedesContact(text), { name: 'Roberto Luiz De Mello', email: 'roberto.mello@mercedes-benz.com' });
});

test('reads the contact when no phone number is listed', () => {
  const text = 'Your technical contact person:\nAna Ruiz\nana.ruiz@mercedes-benz.com\n';
  assert.deepStrictEqual(parseMercedesContact(text), { name: 'Ana Ruiz', email: 'ana.ruiz@mercedes-benz.com' });
});

test('returns blanks when the PO has no technical contact', () => {
  assert.deepStrictEqual(parseMercedesContact('Document no. Date'), { name: '', email: '' });
});
