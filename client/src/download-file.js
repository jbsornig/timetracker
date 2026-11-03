// Downloads a file from the API using the signed-in user's token, keeping the server's filename.

const API_BASE = process.env.REACT_APP_API_URL || '';

function getFilenameFromResponse(response, fallbackName) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  return match ? match[1] : fallbackName;
}

export async function downloadFile(path, fallbackName) {
  const token = localStorage.getItem('tt_token');
  const response = await fetch(`${API_BASE}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const text = await response.text();
    let message = `HTTP ${response.status}`;
    try { message = JSON.parse(text).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = getFilenameFromResponse(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

const EXPORT_YEARS_SHOWN = 5;

// Year choices for data exports: "All years" first, then the most recent years
export function getExportYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: EXPORT_YEARS_SHOWN }, (_, index) => String(currentYear - index));
  return [{ value: 'all', label: 'All years' }, ...years.map(year => ({ value: year, label: year }))];
}
