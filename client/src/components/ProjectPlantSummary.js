import React from 'react';
import { summarizeBoxesByPlant } from '../project-search';

// Per-plant box totals for the projects matching the current search and filters.
export default function ProjectPlantSummary({ projects }) {
  const rows = summarizeBoxesByPlant(projects);
  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (sum, row) => ({ projects: sum.projects + row.projects, boxes: sum.boxes + row.boxes, uncounted: sum.uncounted + row.uncounted }),
    { projects: 0, boxes: 0, uncounted: 0 },
  );

  return (
    <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>Boxes by plant</strong>
        <span style={{ fontSize: 12, color: '#64748b' }}>For the {totals.projects} matching project{totals.projects === 1 ? '' : 's'} below</span>
      </div>
      <div className="table-wrap">
        <table style={{ width: 'auto', minWidth: 420 }}>
          <thead>
            <tr>
              <th>Plant</th>
              <th style={{ textAlign: 'right' }}>Projects</th>
              <th style={{ textAlign: 'right' }}>Boxes</th>
              <th style={{ textAlign: 'right' }}>No box count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.plant}>
                <td>{row.plant}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.projects}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.boxes}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: row.uncounted > 0 ? '#d97706' : '#94a3b8' }}>
                  {row.uncounted > 0 ? row.uncounted : '—'}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600 }}>
              <td>Total</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totals.projects}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totals.boxes}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: totals.uncounted > 0 ? '#d97706' : '#94a3b8' }}>
                {totals.uncounted > 0 ? totals.uncounted : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {totals.uncounted > 0 && (
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
          Box totals are incomplete: {totals.uncounted} project{totals.uncounted === 1 ? ' has' : 's have'} no box count. Click Edit on a project to set its Box Count.
        </div>
      )}
    </div>
  );
}
