import React, { useState } from 'react';
import { downloadFile, getExportYearOptions } from '../download-file';

// Year picker plus a button that downloads an engineer's Excel data export.
// buildPath receives the chosen year ("all" or "YYYY") and returns the API path.
export default function DataExportControls({ buildPath, buttonLabel = 'Download Excel', small = false }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadFile(buildPath(year), 'TimeTracker Data.xlsx');
    } catch (err) {
      setError(`Download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="form-select"
          value={year}
          onChange={e => setYear(e.target.value)}
          style={{ width: 'auto' }}
          aria-label="Year to export"
        >
          {getExportYearOptions().map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className={`btn btn-secondary${small ? ' btn-sm' : ''}`} type="button" onClick={handleDownload} disabled={downloading}>
          {downloading ? 'Preparing...' : buttonLabel}
        </button>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
