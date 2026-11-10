const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderClassicInvoicePageHtml, normalizeInvoiceLayout } = require('./classic-invoice-page');

const SETTINGS = {
  company_name: 'Unlimited Technologies Consulting LLC',
  company_address: '4048 Heron Drive',
  company_city_state_zip: 'Lapeer, MI, 48446',
  company_phone: '810-441-9255',
  company_fax: '',
  company_email: 'accountspayable@utechconsulting.net',
  invoice_sales_person: 'James B. Sornig',
};

const INVOICE = {
  invoice_number: '5349',
  customer_name: 'Mercedes-Benz España, S.A.U.',
  customer_address: 'CIF A-79380465\nAvda. de Bruselas, 30\n28108 Alcobendas (Madrid)',
  supplier_number: '15891579',
  po_number: 'PO 1157504889',
  project_name: 'PO 1157504889 - MB Espana',
  contact_name: 'Jon Andoni Bueno Mendieta',
  payment_terms: 'Net 30',
  total_amount: 1785,
};

const ROWS = [{ qty: '21.00', item: 'PO 1157504889', description: 'iPortal Development - Brad Gilliam - 4/6/2026 to 4/12/2026', unitPrice: '€85.00', lineTotal: '€1,785.00' }];

function render(overrides = {}) {
  return renderClassicInvoicePageHtml({
    invoice: { ...INVOICE, ...overrides.invoice },
    settings: { ...SETTINGS, ...overrides.settings },
    rows: overrides.rows || ROWS,
    invoiceDateStr: '11/10/2026',
    dueDateStr: '12/10/2026',
    formatCurrency: (amount) => `€${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
  });
}

// Visible text in document order, the way an invoice reader sees it
function textOf(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
}

describe('classic-invoice-page', () => {
  describe('normalizeInvoiceLayout', () => {
    it('accepts classic and defaults everything else to standard', () => {
      assert.equal(normalizeInvoiceLayout('classic'), 'classic');
      assert.equal(normalizeInvoiceLayout('standard'), 'standard');
      assert.equal(normalizeInvoiceLayout(undefined), 'standard');
      assert.equal(normalizeInvoiceLayout('fancy'), 'standard');
    });
  });

  describe('renderClassicInvoicePageHtml', () => {
    it('prints the 2024 header labels with their values', () => {
      const text = textOf(render());
      [['Invoice no:', '5349'], ['Invoice date:', '11/10/2026'], ['Due date:', '12/10/2026'], ['Supplier no:', '15891579'], ['Job name:', 'PO 1157504889']]
        .forEach(([label, value]) => assert.equal(text[text.indexOf(label) + 1], value, label));
    });

    it('prints the recipient as plain lines under "To:" with nothing joined', () => {
      const text = textOf(render());
      const start = text.indexOf('To:');
      assert.deepEqual(text.slice(start, start + 5), ['To:', 'Mercedes-Benz España, S.A.U.', 'CIF A-79380465', 'Avda. de Bruselas, 30', '28108 Alcobendas (Madrid)']);
    });

    it('fills the sales person, contact and terms grid', () => {
      const text = textOf(render());
      assert.equal(text[text.indexOf('Sales Person') + 1], 'James B. Sornig');
      assert.equal(text[text.indexOf('Contact name') + 1], 'Jon Andoni Bueno Mendieta');
      assert.equal(text[text.indexOf('Payment terms') + 1], 'Net 30');
    });

    it('falls back to the company name when no sales person is set', () => {
      const text = textOf(render({ settings: { invoice_sales_person: '' } }));
      assert.equal(text[text.indexOf('Sales Person') + 1], 'Unlimited Technologies Consulting LLC');
    });

    it('uses the project name as job name when there is no PO number', () => {
      const text = textOf(render({ invoice: { po_number: '' } }));
      assert.equal(text[text.indexOf('Job name:') + 1], 'PO 1157504889 - MB Espana');
    });

    it('leaves out the supplier number row when the customer has none', () => {
      assert.ok(!textOf(render({ invoice: { supplier_number: '' } })).includes('Supplier no:'));
    });

    it('renders every line item and the totals', () => {
      const text = textOf(render());
      ['21.00', 'iPortal Development - Brad Gilliam - 4/6/2026 to 4/12/2026', '€85.00'].forEach(value => assert.ok(text.includes(value), value));
      assert.equal(text[text.indexOf('Subtotal') + 1], '€1,785.00');
      assert.equal(text[text.indexOf('Sales tax') + 1], '€0.00');
      assert.equal(text[text.indexOf('Total') + 1], '€1,785.00');
    });

    it('escapes customer text', () => {
      const html = render({ invoice: { customer_name: 'A & B <Co>', contact_name: '<script>' } });
      assert.match(html, /A &amp; B &lt;Co&gt;/);
      assert.doesNotMatch(html, /<script>/);
    });

    it('scopes its styles so the timesheet pages after it are untouched', () => {
      const css = render().match(/<style>([\s\S]*?)<\/style>/)[1];
      const selectors = css.split('}').map(rule => rule.split('{')[0].trim()).filter(Boolean);
      selectors.forEach(selector => assert.match(selector, /^\.classic-invoice/, selector));
    });
  });
});
