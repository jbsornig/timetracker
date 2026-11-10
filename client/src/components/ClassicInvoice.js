import React from 'react';

// "Classic" invoice page: mirrors server/classic-invoice-page.js (the pre-TimeTracker 2024
// layout) so the on-screen and printed invoice match the emailed PDF.
// Table rules use !important because the app's global table styles (index.css), including
// its print rules, are !important and would otherwise add padding, borders and capitals.

const STYLES = `
  .classic-invoice { font-family: Tahoma, Verdana, Arial, sans-serif; font-size: 8pt; color: #000; background: #fff;
    display: flex; flex-direction: column; min-height: 9in; }
  .classic-invoice table { font-size: 8pt !important; border-collapse: collapse; }
  .classic-invoice table td, .classic-invoice table th { font-size: 8pt !important; padding: 0 8px 2px 0 !important; border: none !important;
    background: transparent !important; color: #000; text-transform: none; letter-spacing: normal; white-space: normal;
    vertical-align: top; line-height: 1.3; font-weight: normal; }
  .classic-invoice .ci-header { display: flex; padding-left: 1.1in; }
  .classic-invoice .ci-header > div { flex: 1; }
  .classic-invoice h1 { font-family: Arial, sans-serif; font-size: 16pt; font-weight: bold; margin: 0 0 10px 0; color: #000; }
  .classic-invoice .ci-fields { width: auto !important; }
  .classic-invoice .ci-invoice .ci-fields td.ci-label { width: 1.6in; font-weight: bold; }
  .classic-invoice hr { border: 0; border-top: 1px solid #ccc; margin: 20px 0 22px 0; width: 100%; }
  .classic-invoice .ci-to { padding-left: 1.1in; min-height: 1.45in; }
  .classic-invoice .ci-to .ci-label { font-weight: bold; margin-bottom: 8px; }
  .classic-invoice .ci-to div { line-height: 1.3; }
  .classic-invoice .ci-grid { width: 100% !important; margin-bottom: 0.5in; }
  .classic-invoice .ci-grid td { border: 1px solid #ccc !important; padding: 3px 6px !important; width: 25%; }
  .classic-invoice .ci-grid td.ci-key { font-weight: bold; }
  .classic-invoice .ci-items-area { flex: 1 1 auto; display: flex; min-height: 3in; }
  .classic-invoice .ci-items { width: 100% !important; }
  .classic-invoice .ci-items th { background: #000 !important; color: #fff; padding: 6px !important; font-weight: bold; text-align: left; height: 14px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .classic-invoice .ci-items td { border-left: 1px solid #ccc !important; border-right: 1px solid #ccc !important; padding: 6px !important; height: 1px; }
  .classic-invoice .ci-items tr.ci-filler td { height: auto; border-bottom: 1px solid #ccc !important; }
  .classic-invoice .ci-num { text-align: right; }
  .classic-invoice .ci-notes { margin-top: 8px; white-space: pre-wrap; }
  .classic-invoice .ci-footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 12px; }
  .classic-invoice .ci-totals { width: auto !important; }
  .classic-invoice .ci-totals td { padding: 1px 0 1px 30px !important; font-weight: bold; }
  .classic-invoice .ci-totals td.ci-value { font-weight: normal; text-align: right; }
`;

function FieldRow({ label, value }) {
  return (
    <tr>
      <td className="ci-label">{label}</td>
      <td>{value}</td>
    </tr>
  );
}

function CompanyBlock({ settings }) {
  return (
    <div>
      <h1>{settings.company_name || 'Your Company Name'}</h1>
      <table className="ci-fields">
        <tbody>
          {settings.company_address && <tr><td colSpan={2}>{settings.company_address}</td></tr>}
          {settings.company_city_state_zip && <tr><td colSpan={2}>{settings.company_city_state_zip}</td></tr>}
          {settings.company_phone && <FieldRow label="Phone:" value={settings.company_phone} />}
          {settings.company_fax && <FieldRow label="Fax:" value={settings.company_fax} />}
          {settings.company_email && <FieldRow label="E-mail:" value={settings.company_email} />}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceFields({ invoice }) {
  return (
    <div className="ci-invoice">
      <h1>Invoice</h1>
      <table className="ci-fields">
        <tbody>
          <FieldRow label="Invoice no:" value={invoice.invoiceNumber} />
          <FieldRow label="Invoice date:" value={invoice.invoiceDate} />
          <FieldRow label="Due date:" value={invoice.dueDate} />
          {invoice.supplierNumber && <FieldRow label="Supplier no:" value={invoice.supplierNumber} />}
          <FieldRow label="Job name:" value={invoice.poNumber || invoice.projectName} />
        </tbody>
      </table>
    </div>
  );
}

function Recipient({ name, address }) {
  const lines = [name, ...String(address || '').split(/\r?\n/)].map(line => String(line || '').trim()).filter(Boolean);
  return (
    <div className="ci-to">
      <div className="ci-label">To:</div>
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );
}

function LineItems({ rows }) {
  return (
    <div className="ci-items-area">
      <table className="ci-items">
        <tbody>
          <tr>
            <th style={{ width: '6%' }}>Qty.</th>
            <th style={{ width: '13%' }}>Item</th>
            <th style={{ width: '28%' }}>Description</th>
            <th style={{ width: '13%' }}>Unit Price</th>
            <th style={{ width: '12%' }}>Discount</th>
            <th>Line Total</th>
          </tr>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="ci-num">{row.qty}</td>
              <td>{row.item}</td>
              <td>{row.description}</td>
              <td className="ci-num">{row.unitPrice}</td>
              <td></td>
              <td className="ci-num">{row.lineTotal}</td>
            </tr>
          ))}
          <tr className="ci-filler"><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
    </div>
  );
}

// invoice: display-ready text fields; rows: [{ qty, item, description, unitPrice, lineTotal }]
export default function ClassicInvoice({ settings, invoice, rows }) {
  return (
    <div className="classic-invoice">
      <style>{STYLES}</style>
      <div className="ci-header">
        <CompanyBlock settings={settings} />
        <InvoiceFields invoice={invoice} />
      </div>
      <hr />
      <Recipient name={invoice.customerName} address={invoice.customerAddress} />
      <table className="ci-grid">
        <tbody>
          <tr>
            <td className="ci-key">Sales Person</td><td>{settings.invoice_sales_person || settings.company_name}</td>
            <td className="ci-key">Contact name</td><td>{invoice.contactName}</td>
          </tr>
          <tr>
            <td className="ci-key">Delivery date</td><td></td>
            <td className="ci-key">Payment terms</td><td>{invoice.paymentTerms}</td>
          </tr>
        </tbody>
      </table>
      <LineItems rows={rows} />
      {invoice.printNotes && <div className="ci-notes"><strong>Notes:</strong>{'\n'}{invoice.printNotes}</div>}
      <div className="ci-footer">
        <div>Page 1/1</div>
        <table className="ci-totals">
          <tbody>
            <tr><td>Subtotal</td><td className="ci-value">{invoice.total}</td></tr>
            <tr><td>Sales tax</td><td className="ci-value">{invoice.salesTax}</td></tr>
            <tr><td>Total</td><td className="ci-value">{invoice.total}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
