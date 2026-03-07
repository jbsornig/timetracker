import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getNextSunday() {
  const d = new Date();
  const day = d.getDay();
  const diff = 7 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDayName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return DAYS[d.getDay()];
}

// Parse time input and default to AM for hours 1-11, PM for 12
function parseTimeInput(value) {
  if (!value) return '';

  // Already in HH:MM format
  if (/^\d{2}:\d{2}$/.test(value)) return value;

  // Remove any non-digits except colon
  let cleaned = value.replace(/[^\d:]/g, '');

  // Handle formats like "7", "07", "730", "0730", "7:30"
  let hours, minutes;

  if (cleaned.includes(':')) {
    [hours, minutes] = cleaned.split(':').map(Number);
  } else if (cleaned.length <= 2) {
    // Just hours: "7" or "07"
    hours = parseInt(cleaned, 10);
    minutes = 0;
  } else if (cleaned.length === 3) {
    // "730" -> 7:30
    hours = parseInt(cleaned[0], 10);
    minutes = parseInt(cleaned.slice(1), 10);
  } else if (cleaned.length === 4) {
    // "0730" -> 07:30
    hours = parseInt(cleaned.slice(0, 2), 10);
    minutes = parseInt(cleaned.slice(2), 10);
  } else {
    return value; // Return as-is if we can't parse
  }

  // Validate
  if (isNaN(hours) || isNaN(minutes) || hours > 23 || minutes > 59) {
    return value;
  }

  // For hours 1-11 entered without leading zero, assume AM (already correct in 24h)
  // For hour 12 entered alone, assume PM (noon) = 12:00 (already correct)
  // Hours 13-23 are already PM in 24h format

  // Format as HH:MM
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// Print view component for timesheet (matches invoice DailyTimeReport format)
function TimesheetPrintView({ ts, entries, settings }) {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Create entries map by date
  const entriesByDate = {};
  entries.forEach(e => {
    if (e.entry_date) entriesByDate[e.entry_date] = e;
  });

  // Get week dates (Monday through Sunday)
  const getWeekDates = () => {
    if (!ts.week_ending) return [];
    const weekEnd = new Date(ts.week_ending + 'T00:00:00');
    const dates = [];
    for (let i = -6; i <= 0; i++) {
      const d = new Date(weekEnd);
      d.setDate(weekEnd.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  };

  const weekDates = getWeekDates();
  const weekEnding = ts.week_ending
    ? new Date(ts.week_ending + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
    : '';

  // Calculate totals
  let totalST = 0;
  weekDates.forEach(date => {
    const entry = entriesByDate[date];
    if (entry && entry.hours) totalST += entry.hours;
  });
  const grandTotal = totalST;
  const rate = ts.pay_rate || 0;
  const laborSubtotal = grandTotal * rate;

  // Styles - compact to fit on one page
  const cellStyle = { border: '1px solid #000', padding: '1px 3px', fontSize: '7pt', height: '18px', verticalAlign: 'middle' };
  const headerCell = { ...cellStyle, fontWeight: 'bold', background: '#f5f5f5', textAlign: 'center', height: '16px' };
  const centerCell = { ...cellStyle, textAlign: 'center' };
  const rightCell = { ...cellStyle, textAlign: 'right' };
  const descRowStyle = { border: '1px solid #000', padding: '1px 3px', fontSize: '7pt', height: '65px', verticalAlign: 'top' };

  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${hour12}:${m} ${ampm}`;
  };

  return (
    <div className="daily-time-report" style={{ fontFamily: 'Arial, sans-serif', fontSize: '7pt', padding: 0, width: '100%' }}>
      {/* Header Section - compact */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', width: '100%' }}>
        {/* Left: Logo and Company Info */}
        <div style={{ flex: '0 0 auto', width: '180px', paddingRight: '10px' }}>
          {settings?.company_logo && (
            <img src={settings.company_logo} alt="Logo" style={{ maxWidth: '100px', maxHeight: '40px', marginBottom: '1px', display: 'block' }} />
          )}
          <div style={{ fontWeight: 'bold', fontStyle: 'italic', fontSize: '8pt', marginBottom: '1px' }}>
            {settings?.company_name || 'Company Name'}
          </div>
          <div style={{ fontSize: '6pt' }}>Service Required at:</div>
          <div style={{ fontSize: '6pt' }}><strong>Company:</strong> {ts.customer_name}</div>
          <div style={{ fontSize: '6pt' }}><strong>Location:</strong> {ts.location || ''}</div>
        </div>
        {/* Center: Title and Rate Info */}
        <div style={{ flex: '0 0 auto', width: '180px', textAlign: 'center', padding: '0 10px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '10pt', marginBottom: '1px' }}>Daily Time Report</div>
          <div style={{ fontSize: '6pt', lineHeight: '1.3' }}>
            Work week is Mon shift 1 through Sun shift 3<br/>
            ${rate.toFixed(2)}/hr Pay Rate<br/>
            ST = All &nbsp; OT = N/A &nbsp; PT = N/A<br/>
            No Travel time or Expenses
          </div>
        </div>
        {/* Right: Timesheet Info */}
        <div style={{ flex: '0 0 auto', width: '300px' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '6pt' }}>
            <tbody>
              <tr><td style={{ textAlign: 'right', paddingRight: '2px', whiteSpace: 'nowrap' }}>Week Ending:</td><td style={{ fontWeight: 'bold' }}>{weekEnding}</td></tr>
              <tr><td style={{ textAlign: 'right', paddingRight: '2px', whiteSpace: 'nowrap' }}>Engineer:</td><td>{ts.engineer_name}</td></tr>
              <tr><td style={{ textAlign: 'right', paddingRight: '2px', whiteSpace: 'nowrap' }}>Engineer ID:</td><td>{ts.eng_id || ''}</td></tr>
              <tr><td style={{ textAlign: 'right', paddingRight: '2px', whiteSpace: 'nowrap' }}>Work Order #:</td><td>{ts.po_number || ''}</td></tr>
              <tr><td style={{ textAlign: 'right', paddingRight: '2px', whiteSpace: 'nowrap' }}>Systems SO#:</td><td></td></tr>
              <tr><td style={{ textAlign: 'right', paddingRight: '2px', whiteSpace: 'nowrap' }}>Project Name:</td><td>{ts.project_name}</td></tr>
              <tr><td style={{ textAlign: 'right', paddingRight: '2px', whiteSpace: 'nowrap' }}>Startup SO#:</td><td></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily Entries Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
        <thead>
          <tr>
            <th style={{ ...headerCell, width: '55px' }}>Date</th>
            <th style={{ ...headerCell, width: '50px' }}>Travel To</th>
            <th style={{ ...headerCell, width: '55px' }}>Travel From</th>
            <th style={{ ...headerCell, width: '30px' }}>Shift</th>
            <th style={{ ...headerCell, width: '40px' }}>On Call</th>
            <th style={{ ...headerCell, width: '50px' }}>Start Time</th>
            <th style={{ ...headerCell, width: '50px' }}>End Time</th>
            <th style={{ ...headerCell, width: '28px' }}>ST</th>
            <th style={{ ...headerCell, width: '28px' }}>OT</th>
            <th style={{ ...headerCell, width: '28px' }}>PT</th>
            <th style={{ ...headerCell, width: '28px' }}>STT</th>
            <th style={{ ...headerCell, width: '28px' }}>OTT</th>
            <th style={{ ...headerCell, width: '35px' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {weekDates.map((date, idx) => {
            const entry = entriesByDate[date] || {};
            const dateObj = new Date(date + 'T00:00:00');
            const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
            const hours = entry.hours || 0;
            const st = hours > 0 ? hours.toFixed(1) : '0.0';

            return (
              <React.Fragment key={date}>
                {/* Time Row */}
                <tr>
                  <td style={{ ...centerCell, whiteSpace: 'nowrap' }}>{formattedDate} {dayNames[idx]}</td>
                  <td style={centerCell}>{ts.location || ''}</td>
                  <td style={centerCell}></td>
                  <td style={centerCell}>{entry.shift || '1'}</td>
                  <td style={centerCell}></td>
                  <td style={centerCell}>{formatTime(entry.start_time)}</td>
                  <td style={centerCell}>{formatTime(entry.end_time)}</td>
                  <td style={centerCell}>{hours > 0 ? st : '0.0'}</td>
                  <td style={centerCell}>0.0</td>
                  <td style={centerCell}>0.0</td>
                  <td style={centerCell}>0.0</td>
                  <td style={centerCell}>0.0</td>
                  <td style={{ ...centerCell, fontWeight: 'bold' }}>{hours > 0 ? st : '0.0'}</td>
                </tr>
                {/* Description Row */}
                <tr>
                  <td style={descRowStyle}><strong>Detailed Description of Work:</strong></td>
                  <td colSpan={12} style={descRowStyle}>{entry.description || ''}</td>
                </tr>
              </React.Fragment>
            );
          })}
          {/* Weekly Totals Row */}
          <tr style={{ background: '#f5f5f5' }}>
            <td colSpan={7} style={{ ...cellStyle, fontWeight: 'bold' }}>Weekly Totals:</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>{totalST.toFixed(1)}</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>0.0</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>0.0</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>0.0</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>0.0</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>{grandTotal.toFixed(1)}</td>
          </tr>
        </tbody>
      </table>

      {/* Bottom Section: Signatures and Pay Totals - compact */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            {/* Left: Signatures */}
            <td style={{ verticalAlign: 'top', width: '55%', paddingRight: '8px' }}>
              <div style={{ marginBottom: '4px' }}>
                <div style={{ borderBottom: '1px solid #000', height: '15px', marginBottom: '1px' }}></div>
                <div style={{ fontSize: '6pt' }}>Certified correct by: <span style={{ marginLeft: '40px' }}>Date: ___________</span></div>
                <div style={{ fontSize: '5pt', marginLeft: '15px' }}>{settings?.company_name || 'Company'} Site Lead</div>
              </div>
              <div>
                <div style={{ borderBottom: '1px solid #000', height: '15px', marginBottom: '1px' }}></div>
                <div style={{ fontSize: '6pt' }}>Approved by: <span style={{ marginLeft: '60px' }}>Date: ___________</span></div>
                <div style={{ fontSize: '5pt', marginLeft: '15px' }}>Customer Representative</div>
              </div>
            </td>
            {/* Right: Pay Summary */}
            <td style={{ verticalAlign: 'top', width: '45%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '6pt' }}>
                <tbody>
                  <tr>
                    <td colSpan={6} style={{ ...headerCell, textAlign: 'center', fontSize: '6pt' }}>Expenses</td>
                  </tr>
                  <tr>
                    <td style={rightCell}>Air:</td><td style={cellStyle}>$0.00</td>
                    <td style={rightCell}>Car/Taxi:</td><td style={cellStyle}>$0.00</td>
                    <td style={rightCell}>Mileage:</td><td style={cellStyle}></td>
                  </tr>
                  <tr>
                    <td style={rightCell}></td><td style={cellStyle}>$0.00</td>
                    <td style={rightCell}>Meals:</td><td style={cellStyle}>$0.00</td>
                    <td style={rightCell}>Parking:</td><td style={cellStyle}>$0.00</td>
                  </tr>
                  <tr>
                    <td style={rightCell}></td><td style={cellStyle}>$0.00</td>
                    <td style={rightCell}>Misc:</td><td style={cellStyle}>$0.00</td>
                    <td style={rightCell}></td><td style={cellStyle}></td>
                  </tr>
                  <tr>
                    <td colSpan={4}></td>
                    <td style={{ ...rightCell, fontWeight: 'bold' }}>Exp Subtotal:</td>
                    <td style={cellStyle}>$0.00</td>
                  </tr>
                  <tr>
                    <td colSpan={4}></td>
                    <td style={rightCell}>Pay Rate:</td>
                    <td style={cellStyle}>${rate.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4}></td>
                    <td style={{ ...rightCell, fontWeight: 'bold' }}>Labor Subtotal:</td>
                    <td style={cellStyle}>${laborSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  </tr>
                  <tr>
                    <td colSpan={4}></td>
                    <td style={{ ...rightCell, fontWeight: 'bold' }}>Total:</td>
                    <td style={{ ...cellStyle, fontWeight: 'bold' }}>${laborSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Timesheets() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [timesheets, setTimesheets] = useState([]);
  const [projects, setProjects] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('list');
  const [selectedTimesheet, setSelectedTimesheet] = useState(null);
  const [entries, setEntries] = useState([]);
  const [originalEntries, setOriginalEntries] = useState([]);
  const [modal, setModal] = useState(null);
  const [newForm, setNewForm] = useState({ project_id: '', week_ending: getNextSunday() });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState({ status: '', project_id: '', user_id: '' });

  // Check if entries have been modified
  const hasUnsavedChanges = useCallback(() => {
    if (viewMode !== 'edit' || !selectedTimesheet || selectedTimesheet.status === 'approved') {
      return false;
    }
    return JSON.stringify(entries) !== JSON.stringify(originalEntries);
  }, [viewMode, selectedTimesheet, entries, originalEntries]);

  // Warn on browser close/refresh if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const loadTimesheets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.project_id) params.append('project_id', filter.project_id);
      if (filter.user_id) params.append('user_id', filter.user_id);
      const queryString = params.toString();
      const data = await apiFetch(`/timesheets${queryString ? '?' + queryString : ''}`);
      setTimesheets(data);
    } catch (e) {
      setError(e.message);
    }
  }, [filter]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [ts, projs, printSettings] = await Promise.all([
          apiFetch('/timesheets'),
          apiFetch('/projects'),
          apiFetch('/settings/print'),
        ]);
        setTimesheets(ts);
        setProjects(projs);
        setSettings(printSettings);
        if (isAdmin) {
          const [users, fullSettings] = await Promise.all([
            apiFetch('/users'),
            apiFetch('/settings'),
          ]);
          setEngineers(users.filter((u) => u.role === 'engineer'));
          setSettings(fullSettings);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isAdmin]);

  useEffect(() => {
    if (!loading) {
      loadTimesheets();
    }
  }, [filter, loading, loadTimesheets]);

  const openNew = () => {
    setNewForm({ project_id: '', week_ending: getNextSunday() });
    setError('');
    setModal('new');
  };

  const handleCreateTimesheet = async (e) => {
    e.preventDefault();
    if (!newForm.project_id || !newForm.week_ending) {
      setError('Project and week ending are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await apiFetch('/timesheets', { method: 'POST', body: newForm });
      await loadTimesheets();
      setModal(null);
      openTimesheet(result.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openTimesheet = async (id) => {
    try {
      const ts = await apiFetch(`/timesheets/${id}`);
      setSelectedTimesheet(ts);
      const mappedEntries = ts.entries.map((e) => ({
        ...e,
        start_time: e.start_time || '',
        end_time: e.end_time || '',
        description: e.description || '',
        shift: e.shift || 1,
      }));
      setEntries(mappedEntries);
      setOriginalEntries(mappedEntries);
      setViewMode('edit');
    } catch (e) {
      alert('Error loading timesheet: ' + e.message);
    }
  };

  const handleEntryChange = (idx, field, value) => {
    setEntries((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      if (field === 'start_time' || field === 'end_time') {
        const start = field === 'start_time' ? value : updated[idx].start_time;
        const end = field === 'end_time' ? value : updated[idx].end_time;
        if (start && end) {
          const [sh, sm] = start.split(':').map(Number);
          const [eh, em] = end.split(':').map(Number);
          let hours = (eh * 60 + em - sh * 60 - sm) / 60;
          if (hours < 0) hours += 24;
          updated[idx].hours = hours;
        } else {
          updated[idx].hours = 0;
        }
      }
      return updated;
    });
  };

  const handleTimeBlur = (idx, field) => {
    setEntries((prev) => {
      const updated = [...prev];
      const parsed = parseTimeInput(updated[idx][field]);
      if (parsed !== updated[idx][field]) {
        updated[idx] = { ...updated[idx], [field]: parsed };
        // Recalculate hours
        const start = field === 'start_time' ? parsed : updated[idx].start_time;
        const end = field === 'end_time' ? parsed : updated[idx].end_time;
        if (start && end && start.includes(':') && end.includes(':')) {
          const [sh, sm] = start.split(':').map(Number);
          const [eh, em] = end.split(':').map(Number);
          let hours = (eh * 60 + em - sh * 60 - sm) / 60;
          if (hours < 0) hours += 24;
          updated[idx].hours = hours;
        }
      }
      return updated;
    });
  };

  const handleClearEntry = (idx) => {
    setEntries((prev) => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        start_time: '',
        end_time: '',
        hours: 0,
        description: '',
        shift: 1
      };
      return updated;
    });
  };

  const handleSaveEntries = async () => {
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/timesheets/${selectedTimesheet.id}/entries`, {
        method: 'PUT',
        body: { entries },
      });
      const ts = await apiFetch(`/timesheets/${selectedTimesheet.id}`);
      setSelectedTimesheet(ts);
      const mappedEntries = ts.entries.map((e) => ({
        ...e,
        start_time: e.start_time || '',
        end_time: e.end_time || '',
        description: e.description || '',
        shift: e.shift || 1,
      }));
      setEntries(mappedEntries);
      setOriginalEntries(mappedEntries);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!window.confirm('Submit this timesheet for approval?')) return;
    setSaving(true);
    try {
      await apiFetch(`/timesheets/${selectedTimesheet.id}/submit`, { method: 'PUT' });
      const ts = await apiFetch(`/timesheets/${selectedTimesheet.id}`);
      setSelectedTimesheet(ts);
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!window.confirm('Approve this timesheet?')) return;
    setSaving(true);
    try {
      await apiFetch(`/timesheets/${selectedTimesheet.id}/approve`, { method: 'PUT' });
      const ts = await apiFetch(`/timesheets/${selectedTimesheet.id}`);
      setSelectedTimesheet(ts);
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('Reject this timesheet and return to draft?')) return;
    setSaving(true);
    try {
      await apiFetch(`/timesheets/${selectedTimesheet.id}/reject`, { method: 'PUT' });
      const ts = await apiFetch(`/timesheets/${selectedTimesheet.id}`);
      setSelectedTimesheet(ts);
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleBackToList = async () => {
    if (hasUnsavedChanges()) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to leave? Your changes will be lost.'
      );
      if (!confirmed) return;
    }
    setViewMode('list');
    setSelectedTimesheet(null);
    setEntries([]);
    setOriginalEntries([]);
    // Reload timesheets to show updated hours
    await loadTimesheets();
  };

  const totalHours = entries.reduce((sum, e) => sum + (e.hours || 0), 0);

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

  if (viewMode === 'edit' && selectedTimesheet) {
    const ts = selectedTimesheet;
    const canEdit = ts.status !== 'approved';

    return (
      <div>
        <div className="page-header no-print">
          <div style={{ flex: 1 }}>
            <div className="page-title">Timesheet</div>
            <div className="page-subtitle">
              Week ending {formatDate(ts.week_ending)} · {ts.project_name}
            </div>
          </div>
          <div className="timesheet-desktop" style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleBackToList}>Back to List</button>
            <button className="btn btn-secondary" onClick={handlePrint}>Print</button>
            {canEdit && (
              <button className="btn btn-primary" onClick={handleSaveEntries} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
          <div className="timesheet-mobile" style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button className="btn btn-secondary" onClick={handleBackToList} style={{ flex: 1 }}>← Back</button>
            <button className="btn btn-secondary" onClick={handlePrint} style={{ flex: 1 }}>Print</button>
          </div>
        </div>

        {error && <div className="alert alert-error no-print">{error}</div>}

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Engineer</div>
              <div style={{ fontWeight: 600 }}>{ts.engineer_name}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{ts.eng_id || 'No ID'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Project</div>
              <div style={{ fontWeight: 600 }}>{ts.project_name}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{ts.po_number || 'No PO'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Customer</div>
              <div style={{ fontWeight: 600 }}>{ts.customer_name}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{ts.location || 'No location'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Status</div>
              <span className={`badge badge-${ts.status}`}>{ts.status}</span>
            </div>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="card timesheet-desktop">
          <div className="table-wrap">
            <table className="timesheet-grid">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Day</th>
                  <th style={{ width: 100 }}>Date</th>
                  <th style={{ width: 100 }}>Start</th>
                  <th style={{ width: 100 }}>End</th>
                  <th style={{ width: 80 }}>Hours</th>
                  <th style={{ width: 60 }}>Shift</th>
                  <th>Description</th>
                  {canEdit && <th style={{ width: 60 }}></th>}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <tr key={entry.id} className="day-row">
                    <td style={{ fontWeight: 600 }}>{getDayName(entry.entry_date)}</td>
                    <td>{formatShortDate(entry.entry_date)}</td>
                    <td>
                      <input
                        className="time-input"
                        type="text"
                        value={entry.start_time}
                        onChange={(e) => handleEntryChange(idx, 'start_time', e.target.value)}
                        onBlur={() => handleTimeBlur(idx, 'start_time')}
                        disabled={!canEdit}
                        placeholder="7:00"
                      />
                    </td>
                    <td>
                      <input
                        className="time-input"
                        type="text"
                        value={entry.end_time}
                        onChange={(e) => handleEntryChange(idx, 'end_time', e.target.value)}
                        onBlur={() => handleTimeBlur(idx, 'end_time')}
                        disabled={!canEdit}
                        placeholder="15:30"
                      />
                    </td>
                    <td className="hours-display">{(entry.hours || 0).toFixed(2)}</td>
                    <td>
                      <input
                        className="time-input"
                        type="number"
                        min="1"
                        max="9"
                        value={entry.shift}
                        onChange={(e) => handleEntryChange(idx, 'shift', parseInt(e.target.value) || 1)}
                        disabled={!canEdit}
                        style={{ width: 50 }}
                      />
                    </td>
                    <td>
                      <input
                        className="form-input"
                        value={entry.description}
                        onChange={(e) => handleEntryChange(idx, 'description', e.target.value)}
                        disabled={!canEdit}
                        placeholder="Work description..."
                        style={{ fontSize: 13 }}
                      />
                    </td>
                    {canEdit && (
                      <td>
                        {entry.hours > 0 && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleClearEntry(idx)}
                            style={{ padding: '4px 8px', fontSize: 11 }}
                          >
                            Clear
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={4} style={{ textAlign: 'right' }}>Total Hours:</td>
                  <td style={{ textAlign: 'center' }}>{totalHours.toFixed(2)}</td>
                  <td colSpan={canEdit ? 3 : 2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile Card View */}
        <div className="timesheet-mobile">
          {entries.map((entry, idx) => (
            <div key={entry.id} className={`timesheet-day-card ${entry.hours > 0 ? 'has-hours' : ''}`}>
              <div className="timesheet-day-header">
                <div>
                  <div className="timesheet-day-name">{getDayName(entry.entry_date)}</div>
                  <div className="timesheet-day-date">{formatShortDate(entry.entry_date)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="timesheet-day-hours">{(entry.hours || 0).toFixed(2)} hrs</div>
                  {canEdit && entry.hours > 0 && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleClearEntry(idx)}
                      style={{ padding: '4px 8px', fontSize: 11 }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="timesheet-time-row">
                <div>
                  <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Start Time</label>
                  <input
                    className="timesheet-time-input"
                    type="text"
                    inputMode="numeric"
                    value={entry.start_time}
                    onChange={(e) => handleEntryChange(idx, 'start_time', e.target.value)}
                    onBlur={() => handleTimeBlur(idx, 'start_time')}
                    disabled={!canEdit}
                    placeholder="7:00"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>End Time</label>
                  <input
                    className="timesheet-time-input"
                    type="text"
                    inputMode="numeric"
                    value={entry.end_time}
                    onChange={(e) => handleEntryChange(idx, 'end_time', e.target.value)}
                    onBlur={() => handleTimeBlur(idx, 'end_time')}
                    disabled={!canEdit}
                    placeholder="15:30"
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Description</label>
                <input
                  className="timesheet-desc-input"
                  value={entry.description}
                  onChange={(e) => handleEntryChange(idx, 'description', e.target.value)}
                  disabled={!canEdit}
                  placeholder="What did you work on?"
                />
              </div>
            </div>
          ))}

          <div className="timesheet-total-card">
            <div className="timesheet-total-label">Total Hours This Week</div>
            <div className="timesheet-total-hours">{totalHours.toFixed(2)}</div>
          </div>

          <div className="mobile-actions">
            {canEdit && (
              <button className="btn btn-primary" onClick={handleSaveEntries} disabled={saving}>
                {saving ? 'Saving...' : 'Save Timesheet'}
              </button>
            )}
            {ts.status === 'draft' && (
              <button className="btn btn-success" onClick={handleSubmit} disabled={saving}>
                Submit for Approval
              </button>
            )}
            {isAdmin && ts.status === 'submitted' && (
              <>
                <button className="btn btn-success" onClick={handleApprove} disabled={saving}>
                  Approve Timesheet
                </button>
                <button className="btn btn-danger" onClick={handleReject} disabled={saving}>
                  Reject Timesheet
                </button>
              </>
            )}
          </div>
        </div>

        {/* Desktop action buttons */}
        <div className="no-print timesheet-desktop" style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {ts.status === 'draft' && (
            <button className="btn btn-success" onClick={handleSubmit} disabled={saving}>
              Submit for Approval
            </button>
          )}
          {isAdmin && ts.status === 'submitted' && (
            <>
              <button className="btn btn-danger" onClick={handleReject} disabled={saving}>
                Reject
              </button>
              <button className="btn btn-success" onClick={handleApprove} disabled={saving}>
                Approve
              </button>
            </>
          )}
        </div>

        {/* Print-only section - Daily Time Report format (matches invoice format) */}
        <div className="print-only timesheet-print-page" style={{ display: 'none' }}>
          <style>
            {`
              .print-only { display: none; }
              @media print {
                .print-only { display: block !important; }
                .no-print, .sidebar, .mobile-header, .page-header, .timesheet-desktop, .timesheet-mobile { display: none !important; }
                body { background: white !important; padding: 0 !important; margin: 0 !important; font-size: 8pt !important; }
                .main-content { margin: 0 !important; padding: 0 !important; }
                .card { display: none !important; }
                .timesheet-print-page { page-break-inside: avoid; padding: 10px; }
                .daily-time-report { font-family: Arial, sans-serif; font-size: 7pt; padding: 0; display: flex; flex-direction: column; height: 100%; }
                .daily-time-report table { border-collapse: collapse; width: 100%; }
                .daily-time-report th, .daily-time-report td { border: 1px solid #000; padding: 2px 4px; }
                .daily-time-report th { background: #f5f5f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
              @page { margin: 0.25in; size: letter; }
            `}
          </style>
          <TimesheetPrintView ts={ts} entries={entries} settings={settings} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Timesheets</div>
          <div className="page-subtitle">{isAdmin ? 'Manage all timesheets' : 'My timesheets'}</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Timesheet</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0, minWidth: 150 }}>
            <label className="form-label">Status</label>
            <select
              className="form-select"
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            >
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, minWidth: 180 }}>
            <label className="form-label">Project</label>
            <select
              className="form-select"
              value={filter.project_id}
              onChange={(e) => setFilter({ ...filter, project_id: e.target.value })}
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {isAdmin && (
            <div className="form-group" style={{ margin: 0, minWidth: 180 }}>
              <label className="form-label">Engineer</label>
              <select
                className="form-select"
                value={filter.user_id}
                onChange={(e) => setFilter({ ...filter, user_id: e.target.value })}
              >
                <option value="">All Engineers</option>
                {engineers.map((eng) => (
                  <option key={eng.id} value={eng.id}>{eng.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="card timesheet-desktop">
        {timesheets.length === 0 ? (
          <div className="empty-state">
            <h3>No timesheets found</h3>
            <p>Create a new timesheet to get started.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Week Ending</th>
                  {isAdmin && <th>Engineer</th>}
                  <th>Project</th>
                  <th>Hours</th>
                  <th>Status</th>
                  <th style={{ width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {timesheets.map((ts) => (
                  <tr key={ts.id}>
                    <td>{formatDate(ts.week_ending)}</td>
                    {isAdmin && (
                      <td>
                        <strong>{ts.engineer_name}</strong>
                      </td>
                    )}
                    <td>
                      <strong>{ts.project_name}</strong>
                      <br />
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{ts.customer_name}</span>
                    </td>
                    <td style={{ fontFamily: 'DM Mono, monospace' }}>{(ts.total_hours || 0).toFixed(2)}</td>
                    <td>
                      <span className={`badge badge-${ts.status}`}>{ts.status}</span>
                    </td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => openTimesheet(ts.id)}>
                        {ts.status === 'draft' ? 'Edit' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile Card List View */}
      <div className="timesheet-mobile">
        {timesheets.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <h3>No timesheets found</h3>
              <p>Create a new timesheet to get started.</p>
            </div>
          </div>
        ) : (
          timesheets.map((ts) => (
            <div
              key={ts.id}
              className="timesheet-day-card"
              onClick={() => openTimesheet(ts.id)}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                    Week of {formatDate(ts.week_ending)}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 14 }}>
                    {ts.project_name}
                  </div>
                  {isAdmin && (
                    <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
                      {ts.engineer_name}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>
                    {(ts.total_hours || 0).toFixed(1)}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>hours</div>
                  <span className={`badge badge-${ts.status}`} style={{ marginTop: 8 }}>{ts.status}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {modal === 'new' && (
        <Modal
          title="New Timesheet"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateTimesheet} disabled={saving}>
                {saving ? 'Creating...' : 'Create Timesheet'}
              </button>
            </>
          }
        >
          <form onSubmit={handleCreateTimesheet}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Project *</label>
              <select
                className="form-select"
                value={newForm.project_id}
                onChange={(e) => setNewForm({ ...newForm, project_id: e.target.value })}
              >
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.customer_name})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Week Ending (Sunday) *</label>
              <input
                className="form-input"
                type="date"
                value={newForm.week_ending}
                onChange={(e) => setNewForm({ ...newForm, week_ending: e.target.value })}
              />
              <div className="form-hint">Select the Sunday that ends your work week</div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
