import React from 'react';

// Invoice "Bill To" block. Mirrors server/recipient-address.js so the on-screen invoice
// matches the emailed PDF: a boxed, labeled region, and every line but the last ends in a
// comma so invoice readers that join lines (e.g. Basware) keep the parts apart.

const LINE_END_PUNCTUATION = /[,;:]$/;

export function formatRecipientLines(customerName, address) {
  const lines = [customerName, ...String(address || '').split(/\r?\n/)]
    .map(line => String(line || '').trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    const isNameOrLast = index === 0 || index === lines.length - 1;
    return isNameOrLast || LINE_END_PUNCTUATION.test(line) ? line : `${line},`;
  });
}

export default function RecipientBlock({ customerName, customerAddress }) {
  const [name, ...addressLines] = formatRecipientLines(customerName, customerAddress);
  return (
    <div style={{ border: '1px solid #999', borderRadius: 4, padding: '8px 14px', minWidth: 260, maxWidth: 360 }}>
      <div style={{ fontWeight: 'bold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#444', marginBottom: 4 }}>Bill To:</div>
      <div style={{ lineHeight: 1.5 }}>
        <div style={{ fontWeight: 'bold', whiteSpace: 'pre-wrap' }}>{`${name || ''} `}</div>
        {addressLines.map((line, i) => <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{`${line} `}</div>)}
      </div>
    </div>
  );
}
