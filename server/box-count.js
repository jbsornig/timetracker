// Number of boxes/systems a project's PO covers. NULL means "not recorded",
// which is different from 0, so the per-plant totals can flag missing counts.

class BoxCountError extends Error {}

function normalizeBoxCount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new BoxCountError('Box count must be a whole number (0 or more), or left blank.');
  }
  return count;
}

module.exports = { normalizeBoxCount, BoxCountError };
