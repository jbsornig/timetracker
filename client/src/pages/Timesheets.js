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

function snapToSunday(dateStr) {
  if (!dateStr) return getNextSunday();
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  if (day === 0) return dateStr; // Already Sunday
  // Move forward to next Sunday
  d.setDate(d.getDate() + (7 - day));
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

  const allWeekDates = getWeekDates();

  // Filter to only dates within the billing month (based on week_ending's month)
  const weDate = ts.week_ending ? new Date(ts.week_ending + 'T00:00:00') : null;
  const printMonth = weDate ? weDate.getMonth() : 0;
  const printYear = weDate ? weDate.getFullYear() : 0;
  const weekDates = allWeekDates.filter(date => {
    const d = new Date(date + 'T00:00:00');
    return d.getMonth() === printMonth && d.getFullYear() === printYear;
  });

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
  const isFixedMonthly = ts.project_type === 'fixed_monthly';
  const rate = isFixedMonthly ? 0 : (ts.pay_rate || 0);
  const laborSubtotal = isFixedMonthly ? (ts.monthly_pay || 0) : (grandTotal * rate);

  // Styles - ultra compact to fit on one page even on mobile
  const cellStyle = { border: '1px solid #000', padding: '1px 2px', fontSize: '6pt', height: '14px', verticalAlign: 'middle' };
  const headerCell = { ...cellStyle, fontWeight: 'bold', background: '#f5f5f5', textAlign: 'center', height: '12px' };
  const centerCell = { ...cellStyle, textAlign: 'center' };
  const rightCell = { ...cellStyle, textAlign: 'right' };
  const descRowStyle = { border: '1px solid #000', padding: '1px 2px', fontSize: '6pt', height: '45px', verticalAlign: 'top' };

  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${hour12}:${m} ${ampm}`;
  };

  return (
    <div className="daily-time-report" style={{ fontFamily: 'Arial, sans-serif', fontSize: '6pt', padding: 0, width: '100%' }}>
      {/* Header Section - ultra compact */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px', width: '100%' }}>
        {/* Left: Logo and Company Info */}
        <div style={{ flex: '0 0 auto', width: '160px', paddingRight: '5px' }}>
          {settings?.company_logo && (
            <img src={settings.company_logo} alt="Logo" style={{ maxWidth: '80px', maxHeight: '30px', marginBottom: '1px', display: 'block' }} />
          )}
          <div style={{ fontWeight: 'bold', fontStyle: 'italic', fontSize: '7pt' }}>
            {settings?.company_name || 'Company Name'}
          </div>
          <div style={{ fontSize: '5pt' }}>Service at: <strong>{ts.customer_name}</strong></div>
          <div style={{ fontSize: '5pt' }}>Location: {ts.location || ''}</div>
        </div>
        {/* Center: Title and Rate Info */}
        <div style={{ flex: '0 0 auto', width: '160px', textAlign: 'center', padding: '0 5px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '9pt', marginBottom: '1px' }}>Daily Time Report</div>
          <div style={{ fontSize: '5pt', lineHeight: '1.2' }}>
            Mon shift 1 - Sun shift 3<br/>
            {isFixedMonthly ? 'Fixed Monthly' : `$${rate.toFixed(2)}/hr`} | ST = All | OT/PT = N/A
          </div>
        </div>
        {/* Right: Timesheet Info - compact */}
        <div style={{ flex: '0 0 auto', width: '180px', fontSize: '5pt', lineHeight: '1.1' }}>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Week Ending:</span><strong>{weekEnding}</strong></div>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Engineer:</span>{ts.engineer_name}</div>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Engineer ID:</span>{ts.eng_id || ''}</div>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Work Order #:</span>{ts.po_number || ''}</div>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Project:</span>{ts.project_name}</div>
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
          {weekDates.map((date) => {
            const entry = entriesByDate[date] || {};
            const dateObj = new Date(date + 'T00:00:00');
            const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
            const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
            const hours = entry.hours || 0;
            const st = hours > 0 ? hours.toFixed(1) : '0.0';

            return (
              <React.Fragment key={date}>
                {/* Time Row */}
                <tr>
                  <td style={{ ...centerCell, whiteSpace: 'nowrap' }}>{formattedDate} {dayName}</td>
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

      {/* Bottom Section: Signatures and Pay Totals - ultra compact */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '5pt', lineHeight: '1.1', marginTop: '2px' }}>
        {/* Left: Signatures */}
        <div style={{ width: '48%', paddingRight: '5px' }}>
          <div style={{ marginBottom: '2px' }}>
            <div style={{ borderBottom: '1px solid #000', height: '10px', marginBottom: '1px' }}></div>
            <div>Certified by: <span style={{ marginLeft: '20px' }}>Date: _______</span></div>
            <div style={{ fontSize: '4pt' }}>{settings?.company_name || 'Company'} Site Lead</div>
          </div>
          <div>
            <div style={{ borderBottom: '1px solid #000', height: '10px', marginBottom: '1px' }}></div>
            <div>Approved by: <span style={{ marginLeft: '20px' }}>Date: _______</span></div>
            <div style={{ fontSize: '4pt' }}>Customer Representative</div>
          </div>
        </div>
        {/* Right: Expenses/Pay Summary - compact */}
        <div style={{ width: '50%', border: '1px solid #000' }}>
          <div style={{ background: '#f5f5f5', textAlign: 'center', fontWeight: 'bold', borderBottom: '1px solid #000', padding: '0px 1px', fontSize: '5pt' }}>Expenses</div>
          <div style={{ display: 'flex', padding: '0px 2px', fontSize: '5pt' }}>
            <span>Air: $0 | Car: $0 | Meals: $0 | Parking: $0 | Misc: $0</span>
          </div>
          <div style={{ textAlign: 'right', padding: '0px 2px', fontSize: '5pt' }}><strong>Exp Subtotal:</strong> $0.00</div>
          <div style={{ textAlign: 'right', padding: '0px 2px', fontSize: '5pt' }}>
            {isFixedMonthly ? `Fixed Monthly | Hours: ${grandTotal.toFixed(1)}` : `Rate: $${rate.toFixed(2)}/hr | Hours: ${grandTotal.toFixed(1)}`}
          </div>
          <div style={{ textAlign: 'right', padding: '1px 2px', fontWeight: 'bold', fontSize: '6pt' }}>Total: ${laborSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
      </div>
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
  const [newForm, setNewForm] = useState({ project_id: '', week_ending: getNextSunday(), period_start: '', period_end: '', percentage: '', monthly_hours: '', description: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState({ status: '', project_id: '', user_id: '' });
  const [projectStatusFilter, setProjectStatusFilter] = useState('active');
  const [dateFilter, setDateFilter] = useState('current'); // 'all', 'current', or 'YYYY-MM'
  const [sortColumn, setSortColumn] = useState('period');
  const [sortDirection, setSortDirection] = useState('desc');

  // Generate month options for date filter (current month + past 12 months)
  const getMonthOptions = () => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 13; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      options.push({ value, label });
    }
    return options;
  };
  const monthOptions = getMonthOptions();

  // Handle column header click for sorting
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Build a set of project IDs matching the project status filter
  const projectStatusSet = projectStatusFilter
    ? new Set(projects.filter(p => p.status === projectStatusFilter).map(p => p.id))
    : null;

  // Filter timesheets by project status and date range
  const filteredByDate = timesheets.filter(ts => {
    if (projectStatusSet && !projectStatusSet.has(ts.project_id)) return false;
    if (dateFilter === 'all') return true;

    let filterMonth, filterYear;
    if (dateFilter === 'current') {
      const now = new Date();
      filterMonth = now.getMonth() + 1;
      filterYear = now.getFullYear();
    } else {
      const [y, m] = dateFilter.split('-');
      filterYear = parseInt(y);
      filterMonth = parseInt(m);
    }

    // Month boundaries
    const monthStart = new Date(filterYear, filterMonth - 1, 1);
    const monthEnd = new Date(filterYear, filterMonth, 0); // Last day of month

    // For weekly timesheets (week_ending is a Sunday), calculate the full week range
    // The week covers 6 days before week_ending through week_ending
    if (ts.week_ending && !ts.period_start) {
      const weekEnd = new Date(ts.week_ending + 'T00:00:00');
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6); // Monday of that week

      // Check if any day in the week falls within the selected month
      return weekStart <= monthEnd && weekEnd >= monthStart;
    }

    // For fixed price or monthly timesheets, use period_start/end
    const startDate = ts.period_start || ts.week_ending;
    const endDate = ts.period_end || ts.week_ending;
    if (!startDate) return true;

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');

    // Check if timesheet overlaps with the selected month
    return start <= monthEnd && end >= monthStart;
  });

  // Sort timesheets based on current sort settings
  const sortedTimesheets = [...filteredByDate].sort((a, b) => {
    let aVal, bVal;
    switch (sortColumn) {
      case 'period':
        aVal = a.period_start || a.week_ending || '';
        bVal = b.period_start || b.week_ending || '';
        break;
      case 'engineer':
        aVal = (a.engineer_name || '').toLowerCase();
        bVal = (b.engineer_name || '').toLowerCase();
        break;
      case 'project':
        aVal = (a.project_name || '').toLowerCase();
        bVal = (b.project_name || '').toLowerCase();
        break;
      case 'status':
        const statusOrder = { draft: 1, submitted: 2, approved: 3 };
        aVal = statusOrder[a.status] || 0;
        bVal = statusOrder[b.status] || 0;
        break;
      default:
        aVal = '';
        bVal = '';
    }
    // Primary sort
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    // Secondary sort by period (descending) when primary values are equal
    const aPeriod = a.period_start || a.week_ending || '';
    const bPeriod = b.period_start || b.week_ending || '';
    if (aPeriod < bPeriod) return 1;
    if (aPeriod > bPeriod) return -1;
    return 0;
  });

  // Quick Fill state
  const [quickFill, setQuickFill] = useState({
    start_time: '',
    end_time: '',
    lunch_break: '',
    description: '',
    days: { Sun: false, Mon: false, Tue: false, Wed: false, Thu: false, Fri: false, Sat: false }
  });

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

  // Check if we should open the new timesheet modal (from Dashboard button)
  useEffect(() => {
    if (!loading && localStorage.getItem('openNewTimesheet') === 'true') {
      localStorage.removeItem('openNewTimesheet');
      const today = new Date().toISOString().split('T')[0];
      setNewForm({ project_id: '', week_ending: getNextSunday(), period_start: today, period_end: today, percentage: '' });
      setError('');
      setModal('new');
    }
  }, [loading]);

  const openNew = () => {
    const today = new Date().toISOString().split('T')[0];
    setNewForm({ project_id: '', week_ending: getNextSunday(), period_start: today, period_end: today, percentage: '' });
    setError('');
    setModal('new');
  };

  const handleCreateTimesheet = async (e) => {
    e.preventDefault();
    const selectedProject = projects.find(p => String(p.id) === String(newForm.project_id));
    const isFixedPrice = selectedProject?.project_type === 'fixed_price';
    const isMonthly = !isFixedPrice && selectedProject?.requires_daily_logs === 0;

    if (!newForm.project_id) {
      setError('Project is required');
      return;
    }

    if (isFixedPrice) {
      if (!newForm.period_start || !newForm.period_end || !newForm.percentage) {
        setError('Period start, end, and percentage are required for fixed price projects');
        return;
      }
      const pct = parseInt(newForm.percentage);
      if (isNaN(pct) || pct < 1 || pct > 100) {
        setError('Percentage must be a whole number between 1 and 100');
        return;
      }
    } else if (isMonthly) {
      if (!newForm.period_start || !newForm.monthly_hours) {
        setError('Month and total hours are required');
        return;
      }
      const hours = parseFloat(newForm.monthly_hours);
      if (isNaN(hours) || hours <= 0) {
        setError('Hours must be a positive number');
        return;
      }
    } else {
      if (!newForm.week_ending) {
        setError('Week ending is required');
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      let body;
      if (isFixedPrice) {
        body = { project_id: newForm.project_id, period_start: newForm.period_start, period_end: newForm.period_end, percentage: parseInt(newForm.percentage) };
      } else if (isMonthly) {
        body = {
          project_id: newForm.project_id,
          week_ending: newForm.week_ending,
          period_start: newForm.period_start,
          period_end: newForm.period_end,
          monthly_hours: parseFloat(newForm.monthly_hours),
          description: newForm.description || ''
        };
      } else {
        body = { project_id: newForm.project_id, week_ending: newForm.week_ending };
      }
      const result = await apiFetch('/timesheets', { method: 'POST', body });
      await loadTimesheets();
      setModal(null);
      if (!isFixedPrice && !isMonthly) {
        openTimesheet(result.id);
      }
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
      if (field === 'start_time' || field === 'end_time' || field === 'lunch_break') {
        const start = field === 'start_time' ? value : updated[idx].start_time;
        const end = field === 'end_time' ? value : updated[idx].end_time;
        const lunch = field === 'lunch_break' ? (parseFloat(value) || 0) : (parseFloat(updated[idx].lunch_break) || 0);
        if (start && end) {
          const [sh, sm] = start.split(':').map(Number);
          const [eh, em] = end.split(':').map(Number);
          let hours = (eh * 60 + em - sh * 60 - sm) / 60;
          if (hours < 0) hours += 24;
          hours = Math.max(0, hours - lunch);
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
        const lunch = parseFloat(updated[idx].lunch_break) || 0;
        if (start && end && start.includes(':') && end.includes(':')) {
          const [sh, sm] = start.split(':').map(Number);
          const [eh, em] = end.split(':').map(Number);
          let hours = (eh * 60 + em - sh * 60 - sm) / 60;
          if (hours < 0) hours += 24;
          hours = Math.max(0, hours - lunch);
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
        lunch_break: 0,
        hours: 0,
        description: '',
        shift: 1
      };
      return updated;
    });
  };

  const handleQuickFillApply = () => {
    const { start_time, end_time, lunch_break, description, days } = quickFill;
    const parsedStart = parseTimeInput(start_time);
    const parsedEnd = parseTimeInput(end_time);
    const lunch = parseFloat(lunch_break) || 0;

    // Calculate hours
    let hours = 0;
    if (parsedStart && parsedEnd && parsedStart.includes(':') && parsedEnd.includes(':')) {
      const [sh, sm] = parsedStart.split(':').map(Number);
      const [eh, em] = parsedEnd.split(':').map(Number);
      hours = (eh * 60 + em - sh * 60 - sm) / 60;
      if (hours < 0) hours += 24;
      hours = Math.max(0, hours - lunch);
    }

    setEntries((prev) => {
      const updated = [...prev];
      updated.forEach((entry, idx) => {
        const dayName = getDayName(entry.entry_date);
        if (days[dayName]) {
          updated[idx] = {
            ...entry,
            start_time: parsedStart,
            end_time: parsedEnd,
            lunch_break: lunch,
            hours: hours,
            description: description
          };
        }
      });
      return updated;
    });
  };

  const handleQuickFillSelectMF = () => {
    setQuickFill(prev => ({
      ...prev,
      days: { Sun: false, Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: false }
    }));
  };

  const handleQuickFillSelectAll = () => {
    setQuickFill(prev => ({
      ...prev,
      days: { Sun: true, Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: true }
    }));
  };

  const handleQuickFillSelectNone = () => {
    setQuickFill(prev => ({
      ...prev,
      days: { Sun: false, Mon: false, Tue: false, Wed: false, Thu: false, Fri: false, Sat: false }
    }));
  };

  const handleSaveEntries = async () => {
    setSaving(true);
    setError('');
    try {
      // Clear data for entries outside the billing month (based on week_ending's month)
      const weekEnd = new Date(selectedTimesheet.week_ending + 'T00:00:00');
      const bMonth = weekEnd.getMonth();
      const bYear = weekEnd.getFullYear();
      const cleanedEntries = entries.map(e => {
        const d = new Date(e.entry_date + 'T00:00:00');
        if (d.getMonth() !== bMonth || d.getFullYear() !== bYear) {
          return { ...e, start_time: '', end_time: '', hours: 0, description: '', lunch_break: 0 };
        }
        return e;
      });
      await apiFetch(`/timesheets/${selectedTimesheet.id}/entries`, {
        method: 'PUT',
        body: { entries: cleanedEntries },
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

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this timesheet? This cannot be undone.')) return;
    try {
      await apiFetch(`/timesheets/${id}`, { method: 'DELETE' });
      await loadTimesheets();
      if (selectedTimesheet && selectedTimesheet.id === id) {
        setSelectedTimesheet(null);
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // Submit timesheet from list view (works for any timesheet type)
  const handleSubmitFromList = async (id) => {
    if (!window.confirm('Submit this timesheet for approval?')) return;
    try {
      await apiFetch(`/timesheets/${id}/submit`, { method: 'PUT' });
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // Fixed price timesheet handlers
  const handleSubmitFixedPrice = async (id) => {
    if (!window.confirm('Submit this invoice for approval?')) return;
    try {
      await apiFetch(`/timesheets/${id}/submit`, { method: 'PUT' });
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleApproveFixedPrice = async (id) => {
    if (!window.confirm('Approve this invoice?')) return;
    try {
      await apiFetch(`/timesheets/${id}/approve`, { method: 'PUT' });
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleRejectFixedPrice = async (id) => {
    if (!window.confirm('Reject this invoice and return to draft?')) return;
    try {
      await apiFetch(`/timesheets/${id}/reject`, { method: 'PUT' });
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleApproveFromList = async (id) => {
    if (!window.confirm('Approve this timesheet?')) return;
    try {
      await apiFetch(`/timesheets/${id}/approve`, { method: 'PUT' });
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleRejectFromList = async (id) => {
    if (!window.confirm('Reject this timesheet and return to draft?')) return;
    try {
      await apiFetch(`/timesheets/${id}/reject`, { method: 'PUT' });
      await loadTimesheets();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const [editFixedPriceModal, setEditFixedPriceModal] = useState(null);
  const [editFixedPriceForm, setEditFixedPriceForm] = useState({ period_start: '', period_end: '', percentage: '' });

  const openEditFixedPrice = (ts) => {
    setEditFixedPriceForm({
      id: ts.id,
      period_start: ts.period_start || '',
      period_end: ts.period_end || '',
      percentage: ts.percentage || '',
      total_payment: ts.total_payment || 0
    });
    setEditFixedPriceModal(true);
  };

  const handleSaveFixedPrice = async () => {
    const pct = parseInt(editFixedPriceForm.percentage);
    if (isNaN(pct) || pct < 1 || pct > 100) {
      alert('Percentage must be a whole number between 1 and 100');
      return;
    }
    try {
      await apiFetch(`/timesheets/${editFixedPriceForm.id}/fixed-price`, {
        method: 'PUT',
        body: {
          period_start: editFixedPriceForm.period_start,
          period_end: editFixedPriceForm.period_end,
          percentage: pct
        }
      });
      await loadTimesheets();
      setEditFixedPriceModal(null);
    } catch (e) {
      alert('Error: ' + e.message);
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

    // Determine billing month from week_ending's month
    const weekEndDate = new Date(ts.week_ending + 'T00:00:00');
    const billingMonth = weekEndDate.getMonth();
    const billingYear = weekEndDate.getFullYear();
    const isOutsideBillingMonth = (dateStr) => {
      const d = new Date(dateStr + 'T00:00:00');
      return d.getMonth() !== billingMonth || d.getFullYear() !== billingYear;
    };

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
          <div className="timesheet-mobile" style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleBackToList} style={{ flex: '1 1 45%' }}>← Back</button>
            <button className="btn btn-secondary" onClick={handlePrint} style={{ flex: '1 1 45%' }}>Print</button>
            {canEdit && (
              <button className="btn btn-primary" onClick={handleSaveEntries} disabled={saving} style={{ flex: '1 1 45%' }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            )}
            {ts.status === 'draft' && (
              <button className="btn btn-success" onClick={handleSubmit} disabled={saving} style={{ flex: '1 1 45%' }}>
                Submit
              </button>
            )}
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

        {/* Quick Fill Section - only show for draft timesheets being edited */}
        {ts.status === 'draft' && (
          <div className="card no-print" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12, color: '#374151' }}>Quick Fill</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Start Time</label>
                <input
                  className="time-input"
                  type="text"
                  value={quickFill.start_time}
                  onChange={(e) => setQuickFill(prev => ({ ...prev, start_time: e.target.value }))}
                  onBlur={() => setQuickFill(prev => ({ ...prev, start_time: parseTimeInput(prev.start_time) }))}
                  placeholder="7:00"
                  style={{ width: 80 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>End Time</label>
                <input
                  className="time-input"
                  type="text"
                  value={quickFill.end_time}
                  onChange={(e) => setQuickFill(prev => ({ ...prev, end_time: e.target.value }))}
                  onBlur={() => setQuickFill(prev => ({ ...prev, end_time: parseTimeInput(prev.end_time) }))}
                  placeholder="15:30"
                  style={{ width: 80 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Lunch (hrs)</label>
                <input
                  className="time-input"
                  type="number"
                  step="0.25"
                  min="0"
                  max="4"
                  value={quickFill.lunch_break}
                  onChange={(e) => setQuickFill(prev => ({ ...prev, lunch_break: e.target.value }))}
                  placeholder="0.5"
                  style={{ width: 70 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Description</label>
                <input
                  className="form-input"
                  value={quickFill.description}
                  onChange={(e) => setQuickFill(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Work description..."
                  style={{ fontSize: 13 }}
                />
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#64748b', marginRight: 4 }}>Days:</span>
                {DAYS.map(day => (
                  <label key={day} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={quickFill.days[day]}
                      onChange={(e) => setQuickFill(prev => ({
                        ...prev,
                        days: { ...prev.days, [day]: e.target.checked }
                      }))}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontSize: 13 }}>{day}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={handleQuickFillSelectMF}>M-F</button>
                <button className="btn btn-secondary btn-sm" onClick={handleQuickFillSelectAll}>All</button>
                <button className="btn btn-secondary btn-sm" onClick={handleQuickFillSelectNone}>None</button>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleQuickFillApply}
                disabled={!quickFill.start_time || !quickFill.end_time || !Object.values(quickFill.days).some(v => v)}
              >
                Apply to Selected Days
              </button>
            </div>
          </div>
        )}

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
                  <th style={{ width: 70 }}>Lunch</th>
                  <th style={{ width: 80 }}>Hours</th>
                  <th style={{ width: 60 }}>Shift</th>
                  <th>Description</th>
                  {canEdit && <th style={{ width: 60 }}></th>}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const outsideMonth = isOutsideBillingMonth(entry.entry_date);
                  return (
                  <tr key={entry.id} className="day-row" style={outsideMonth ? { opacity: 0.4, background: '#f8fafc' } : undefined}>
                    <td style={{ fontWeight: 600 }}>{getDayName(entry.entry_date)}</td>
                    <td>{formatShortDate(entry.entry_date)}</td>
                    <td>
                      {outsideMonth ? <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span> : (
                      <input
                        className="time-input"
                        type="text"
                        value={entry.start_time}
                        onChange={(e) => handleEntryChange(idx, 'start_time', e.target.value)}
                        onBlur={() => handleTimeBlur(idx, 'start_time')}
                        disabled={!canEdit}
                        placeholder="7:00"
                      />
                      )}
                    </td>
                    <td>
                      {outsideMonth ? <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span> : (
                      <input
                        className="time-input"
                        type="text"
                        value={entry.end_time}
                        onChange={(e) => handleEntryChange(idx, 'end_time', e.target.value)}
                        onBlur={() => handleTimeBlur(idx, 'end_time')}
                        disabled={!canEdit}
                        placeholder="15:30"
                      />
                      )}
                    </td>
                    <td>
                      {outsideMonth ? <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span> : (
                      <input
                        className="time-input"
                        type="number"
                        step="0.25"
                        min="0"
                        max="4"
                        value={entry.lunch_break || ''}
                        onChange={(e) => handleEntryChange(idx, 'lunch_break', e.target.value)}
                        disabled={!canEdit}
                        placeholder="0"
                        style={{ width: 55 }}
                      />
                      )}
                    </td>
                    <td className="hours-display">{outsideMonth ? '' : (entry.hours || 0).toFixed(2)}</td>
                    <td>
                      {outsideMonth ? '' : (
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
                      )}
                    </td>
                    <td>
                      {outsideMonth ? '' : (
                      <input
                        className="form-input"
                        value={entry.description}
                        onChange={(e) => handleEntryChange(idx, 'description', e.target.value)}
                        disabled={!canEdit}
                        placeholder="Work description..."
                        style={{ fontSize: 13 }}
                      />
                      )}
                    </td>
                    {canEdit && (
                      <td>
                        {!outsideMonth && entry.hours > 0 && (
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
                  );
                })}
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
          {entries.map((entry, idx) => {
            const outsideMobile = isOutsideBillingMonth(entry.entry_date);
            if (outsideMobile) {
              return (
                <div key={entry.id} className="timesheet-day-card" style={{ opacity: 0.4, background: '#f8fafc' }}>
                  <div className="timesheet-day-header">
                    <div>
                      <div className="timesheet-day-name">{getDayName(entry.entry_date)}</div>
                      <div className="timesheet-day-date">{formatShortDate(entry.entry_date)}</div>
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 12 }}>Outside billing period</div>
                  </div>
                </div>
              );
            }
            return (
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
                <div>
                  <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Lunch (hrs)</label>
                  <input
                    className="timesheet-time-input"
                    type="number"
                    inputMode="decimal"
                    step="0.25"
                    min="0"
                    max="4"
                    value={entry.lunch_break || ''}
                    onChange={(e) => handleEntryChange(idx, 'lunch_break', e.target.value)}
                    disabled={!canEdit}
                    placeholder="0"
                    style={{ width: 60 }}
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
            );
          })}

          <div className="timesheet-total-card">
            <div className="timesheet-total-label">Total Hours This Week</div>
            <div className="timesheet-total-hours">{totalHours.toFixed(2)}</div>
          </div>
        </div>

        {/* Print-only section - Daily Time Report format (matches invoice format) */}
        <div className="print-only timesheet-print-page" style={{ display: 'none' }}>
          <style>
            {`
              .print-only { display: none; }
              @media print {
                .print-only { display: block !important; }
                .no-print, .sidebar, .mobile-header, .mobile-top-header, .mobile-nav, .page-header, .timesheet-desktop, .timesheet-mobile { display: none !important; }
                body { background: white !important; padding: 0 !important; margin: 0 !important; font-size: 6pt !important; }
                html { font-size: 6pt !important; }
                .main-content { margin: 0 !important; padding: 0 !important; }
                .card { display: none !important; }
                .app-shell { display: block !important; }
                .timesheet-print-page { page-break-inside: avoid; padding: 5px; }
                .daily-time-report { font-family: Arial, sans-serif; font-size: 6pt; padding: 0; }
                .daily-time-report table { border-collapse: collapse; width: 100%; }
                .daily-time-report th, .daily-time-report td { border: 1px solid #000; padding: 1px 2px; font-size: 6pt; }
                .daily-time-report th { background: #f5f5f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
              @page { margin: 0.2in; size: letter; }
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
        {!isAdmin && <button className="btn btn-primary" onClick={openNew}>+ New Timesheet</button>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: 130 }}>
            <label className="form-label">Projects</label>
            <select
              className="form-select"
              value={projectStatusFilter}
              onChange={(e) => setProjectStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, minWidth: 180 }}>
            <label className="form-label">Period</label>
            <select
              className="form-select"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            >
              <option value="all">All Time</option>
              <option value="current">Current Month</option>
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
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
          <div style={{ marginLeft: 'auto', alignSelf: 'center', color: '#64748b', fontSize: 14 }}>
            Showing <strong style={{ color: '#1e293b' }}>{sortedTimesheets.length}</strong> timesheet{sortedTimesheets.length !== 1 ? 's' : ''}
            {sortedTimesheets.length !== timesheets.length && (
              <span> of {timesheets.length}</span>
            )}
          </div>
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="card timesheet-desktop">
        {sortedTimesheets.length === 0 ? (
          <div className="empty-state">
            <h3>No timesheets found</h3>
            <p>{timesheets.length > 0 ? 'Try adjusting your filters.' : 'Create a new timesheet to get started.'}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th onClick={() => handleSort('period')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    Period {sortColumn === 'period' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  {isAdmin && (
                    <th onClick={() => handleSort('engineer')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                      Engineer {sortColumn === 'engineer' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </th>
                  )}
                  <th onClick={() => handleSort('project')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    Project {sortColumn === 'project' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th>Type</th>
                  <th>Hours/Amount</th>
                  <th onClick={() => handleSort('status')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    Status {sortColumn === 'status' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th style={{ width: 150 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTimesheets.map((ts) => {
                  const isFixedPrice = ts.project_type === 'fixed_price';
                  const isMonthly = !isFixedPrice && ts.requires_daily_logs === 0;
                  const getBadgeClass = () => {
                    if (isFixedPrice) return 'badge-fixed';
                    if (isMonthly) return 'badge-submitted';
                    return 'badge-hourly';
                  };
                  const getBadgeText = () => {
                    if (isFixedPrice) return 'Fixed';
                    if (isMonthly) return 'Monthly';
                    return 'Hourly';
                  };
                  return (
                    <tr key={ts.id}>
                      <td>
                        {(isFixedPrice || isMonthly) && ts.period_start ? (
                          <>
                            {isMonthly ? (
                              new Date(ts.period_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                            ) : (
                              <>
                                {formatDate(ts.period_start)}
                                <br />
                                <span style={{ fontSize: 12, color: '#94a3b8' }}>to {formatDate(ts.period_end)}</span>
                              </>
                            )}
                          </>
                        ) : (
                          formatDate(ts.week_ending)
                        )}
                      </td>
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
                      <td>
                        <span className={`badge ${getBadgeClass()}`} style={{ fontSize: 11 }}>
                          {getBadgeText()}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>
                        {isFixedPrice ? (
                          <>
                            ${(ts.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            <br />
                            <span style={{ fontSize: 11, color: '#64748b' }}>{ts.percentage}%</span>
                          </>
                        ) : (
                          <>{(ts.total_hours || 0).toFixed(2)} hrs</>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${ts.status}`}>{ts.status}</span>
                      </td>
                      <td>
                        {!isFixedPrice && (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => openTimesheet(ts.id)} style={{ marginRight: 4 }}>
                              {ts.status === 'draft' ? 'Edit' : 'View'}
                            </button>
                            {!isAdmin && ts.status === 'draft' && (
                              <button className="btn btn-success btn-sm" onClick={() => handleSubmitFromList(ts.id)} style={{ marginRight: 4 }}>
                                Submit
                              </button>
                            )}
                            {isAdmin && ts.status === 'submitted' && (
                              <>
                                <button className="btn btn-danger btn-sm" onClick={() => handleRejectFromList(ts.id)} style={{ marginRight: 4 }}>
                                  Reject
                                </button>
                                <button className="btn btn-success btn-sm" onClick={() => handleApproveFromList(ts.id)} style={{ marginRight: 4 }}>
                                  Approve
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {isFixedPrice && ts.status === 'draft' && !isAdmin && (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => openEditFixedPrice(ts)} style={{ marginRight: 4 }}>
                              Edit
                            </button>
                            <button className="btn btn-success btn-sm" onClick={() => handleSubmitFixedPrice(ts.id)} style={{ marginRight: 4 }}>
                              Submit
                            </button>
                          </>
                        )}
                        {isFixedPrice && ts.status === 'submitted' && isAdmin && (
                          <>
                            <button className="btn btn-danger btn-sm" onClick={() => handleRejectFixedPrice(ts.id)} style={{ marginRight: 4 }}>
                              Reject
                            </button>
                            <button className="btn btn-success btn-sm" onClick={() => handleApproveFixedPrice(ts.id)} style={{ marginRight: 4 }}>
                              Approve
                            </button>
                          </>
                        )}
                        {(isAdmin || ts.status === 'draft') && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={(e) => { e.stopPropagation(); handleDelete(ts.id); }}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile Card List View */}
      <div className="timesheet-mobile">
        {sortedTimesheets.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <h3>No timesheets found</h3>
              <p>{timesheets.length > 0 ? 'Try adjusting your filters.' : 'Create a new timesheet to get started.'}</p>
            </div>
          </div>
        ) : (
          sortedTimesheets.map((ts) => {
            const isFixedPrice = ts.project_type === 'fixed_price';
            const isMonthly = !isFixedPrice && ts.requires_daily_logs === 0;
            const canOpen = !isFixedPrice && !isMonthly;
            const getBadgeClass = () => {
              if (isFixedPrice) return 'badge-fixed';
              if (isMonthly) return 'badge-submitted';
              return 'badge-hourly';
            };
            const getBadgeText = () => {
              if (isFixedPrice) return 'Fixed';
              if (isMonthly) return 'Monthly';
              return 'Hourly';
            };
            return (
              <div
                key={ts.id}
                className="timesheet-day-card"
                onClick={() => canOpen && openTimesheet(ts.id)}
                style={{ cursor: canOpen ? 'pointer' : 'default' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                      {(isFixedPrice || isMonthly) && ts.period_start ? (
                        isMonthly ? (
                          new Date(ts.period_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                        ) : (
                          <>{formatDate(ts.period_start)} - {formatDate(ts.period_end)}</>
                        )
                      ) : (
                        <>Week of {formatDate(ts.week_ending)}</>
                      )}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 14 }}>
                      {ts.project_name}
                      <span className={`badge ${getBadgeClass()}`} style={{ fontSize: 10, marginLeft: 8 }}>
                        {getBadgeText()}
                      </span>
                    </div>
                    {isAdmin && (
                      <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
                        {ts.engineer_name}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>
                      {isFixedPrice ? (
                        <>${(ts.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</>
                      ) : (
                        <>{(ts.total_hours || 0).toFixed(1)}</>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {isFixedPrice ? `${ts.percentage}%` : 'hours'}
                    </div>
                    <span className={`badge badge-${ts.status}`} style={{ marginTop: 8 }}>{ts.status}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                      {!isAdmin && !isFixedPrice && ts.status === 'draft' && (
                        <button
                          className="btn btn-success btn-sm"
                          onClick={(e) => { e.stopPropagation(); handleSubmitFromList(ts.id); }}
                        >
                          Submit
                        </button>
                      )}
                      {!isAdmin && isFixedPrice && ts.status === 'draft' && (
                        <>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={(e) => { e.stopPropagation(); openEditFixedPrice(ts); }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-success btn-sm"
                            onClick={(e) => { e.stopPropagation(); handleSubmitFixedPrice(ts.id); }}
                          >
                            Submit
                          </button>
                        </>
                      )}
                      {isFixedPrice && ts.status === 'submitted' && isAdmin && (
                        <>
                          <button
                            className="btn btn-success btn-sm"
                            onClick={(e) => { e.stopPropagation(); handleApproveFixedPrice(ts.id); }}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={(e) => { e.stopPropagation(); handleRejectFixedPrice(ts.id); }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {!isFixedPrice && ts.status === 'submitted' && isAdmin && (
                        <>
                          <button
                            className="btn btn-success btn-sm"
                            onClick={(e) => { e.stopPropagation(); handleApproveFromList(ts.id); }}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={(e) => { e.stopPropagation(); handleRejectFromList(ts.id); }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {(isAdmin || ts.status === 'draft') && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={(e) => { e.stopPropagation(); handleDelete(ts.id); }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {editFixedPriceModal && (
        <Modal
          title="Edit Fixed Price Invoice"
          onClose={() => setEditFixedPriceModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setEditFixedPriceModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveFixedPrice}>Save Changes</button>
            </>
          }
        >
          <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#0369a1', fontWeight: 600, marginBottom: 4 }}>Fixed Price Project</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              Your total payment: <strong>${(editFixedPriceForm.total_payment || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Period Start *</label>
              <input
                className="form-input"
                type="date"
                value={editFixedPriceForm.period_start}
                onChange={(e) => setEditFixedPriceForm({ ...editFixedPriceForm, period_start: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Period End *</label>
              <input
                className="form-input"
                type="date"
                value={editFixedPriceForm.period_end}
                onChange={(e) => setEditFixedPriceForm({ ...editFixedPriceForm, period_end: e.target.value })}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Percentage to Invoice *</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                className="form-input"
                type="number"
                min="1"
                max="100"
                step="1"
                value={editFixedPriceForm.percentage}
                onChange={(e) => setEditFixedPriceForm({ ...editFixedPriceForm, percentage: e.target.value })}
                placeholder="Enter percentage (1-100)"
                style={{ width: 150 }}
              />
              <span style={{ color: '#64748b' }}>%</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {[10, 25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  type="button"
                  className={`btn btn-sm ${String(editFixedPriceForm.percentage) === String(pct) ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setEditFixedPriceForm({ ...editFixedPriceForm, percentage: String(pct) })}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
          {editFixedPriceForm.percentage && (
            <div style={{ background: '#f0fdf4', padding: 12, borderRadius: 8, marginTop: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#16a34a' }}>
                Invoice Amount: ${((parseInt(editFixedPriceForm.percentage) / 100) * (editFixedPriceForm.total_payment || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {editFixedPriceForm.percentage}% of ${(editFixedPriceForm.total_payment || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          )}
        </Modal>
      )}

      {modal === 'new' && (() => {
        const selectedProject = projects.find(p => String(p.id) === String(newForm.project_id));
        const isFixedPrice = selectedProject?.project_type === 'fixed_price';
        const isMonthly = !isFixedPrice && selectedProject?.requires_daily_logs === 0;
        const totalPayment = selectedProject?.total_payment || 0;
        const calculatedAmount = isFixedPrice && newForm.percentage ? (parseInt(newForm.percentage) / 100) * totalPayment : 0;

        const getModalTitle = () => {
          if (isFixedPrice) return 'New Fixed Price Invoice';
          if (isMonthly) return 'New Monthly Hours Entry';
          return 'New Timesheet';
        };

        return (
          <Modal
            title={getModalTitle()}
            onClose={() => setModal(null)}
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleCreateTimesheet} disabled={saving}>
                  {saving ? 'Creating...' : isFixedPrice ? 'Create Invoice' : isMonthly ? 'Submit Hours' : 'Create Timesheet'}
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
                      {p.name} ({p.customer_name}) {p.project_type === 'fixed_price' ? '[Fixed]' : p.requires_daily_logs === 0 ? '[Monthly]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {isFixedPrice ? (
                <>
                  <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: '#0369a1', fontWeight: 600, marginBottom: 4 }}>Fixed Price Project</div>
                    <div style={{ fontSize: 13, color: '#64748b' }}>
                      Your total payment for this project: <strong>${totalPayment.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Period Start *</label>
                      <input
                        className="form-input"
                        type="date"
                        value={newForm.period_start}
                        onChange={(e) => setNewForm({ ...newForm, period_start: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Period End *</label>
                      <input
                        className="form-input"
                        type="date"
                        value={newForm.period_end}
                        onChange={(e) => setNewForm({ ...newForm, period_end: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Percentage to Invoice *</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <input
                        className="form-input"
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={newForm.percentage}
                        onChange={(e) => setNewForm({ ...newForm, percentage: e.target.value })}
                        placeholder="Enter percentage (1-100)"
                        style={{ width: 150 }}
                      />
                      <span style={{ color: '#64748b' }}>%</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      {[10, 25, 50, 75, 100].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          className={`btn btn-sm ${String(newForm.percentage) === String(pct) ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setNewForm({ ...newForm, percentage: String(pct) })}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                    <div className="form-hint">Select what percentage of your total payment to invoice</div>
                  </div>
                  {newForm.percentage && (
                    <div style={{ background: '#f0fdf4', padding: 12, borderRadius: 8, marginTop: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#16a34a' }}>
                        Invoice Amount: ${calculatedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {newForm.percentage}% of ${totalPayment.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  )}
                </>
              ) : isMonthly ? (
                <>
                  <div style={{ background: '#fef3c7', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>Monthly Hours Project</div>
                    <div style={{ fontSize: 13, color: '#64748b' }}>
                      This project doesn't require daily time logs. Enter your total hours for the month.
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Month *</label>
                    <input
                      className="form-input"
                      type="month"
                      value={newForm.period_start ? newForm.period_start.substring(0, 7) : ''}
                      onChange={(e) => {
                        const month = e.target.value;
                        if (month) {
                          const [year, mon] = month.split('-');
                          const firstDay = `${year}-${mon}-01`;
                          const lastDay = new Date(parseInt(year), parseInt(mon), 0).toISOString().split('T')[0];
                          setNewForm({ ...newForm, period_start: firstDay, period_end: lastDay, week_ending: lastDay });
                        }
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Total Hours *</label>
                    <input
                      className="form-input"
                      type="number"
                      step="0.25"
                      min="0"
                      value={newForm.monthly_hours}
                      onChange={(e) => setNewForm({ ...newForm, monthly_hours: e.target.value })}
                      placeholder="e.g., 160"
                      style={{ width: 150 }}
                    />
                    <div className="form-hint">Total hours worked this month</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description (optional)</label>
                    <input
                      className="form-input"
                      value={newForm.description}
                      onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
                      placeholder="Work performed this month..."
                    />
                  </div>
                </>
              ) : (
                <div className="form-group">
                  <label className="form-label">Week Ending (Sunday) *</label>
                  <input
                    className="form-input"
                    type="date"
                    value={newForm.week_ending}
                    onChange={(e) => setNewForm({ ...newForm, week_ending: snapToSunday(e.target.value) })}
                  />
                  <div className="form-hint">Date will automatically adjust to the nearest Sunday</div>
                </div>
              )}
            </form>
          </Modal>
        );
      })()}
    </div>
  );
}
