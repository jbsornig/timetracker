const Database = require('better-sqlite3');
const db = new Database('/data/timetracker.db');

// Update project 3033 with total_cost of 100000
const result = db.prepare('UPDATE projects SET total_cost = ? WHERE id = ?').run(100000, 3033);
console.log('Updated rows:', result.changes);

// Verify
const project = db.prepare('SELECT id, name, project_type, total_cost FROM projects WHERE id = ?').get(3033);
console.log('Project after update:', project);

db.close();
