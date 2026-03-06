// api.js
const BASE = process.env.REACT_APP_API_URL || '';

export async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('tt_token');
  const res = await fetch(`${BASE}/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  // Try to parse as JSON, with fallback for non-JSON responses
  let data;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Server error: ${res.status} ${res.statusText}`);
    }
    // Try parsing as JSON anyway in case content-type header is wrong
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected response: ${text.substring(0, 100)}`);
    }
  }

  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
