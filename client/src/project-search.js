// Keyword search and per-plant box totals for the Projects page.
//
// Query syntax: words are ANDed, commas separate alternatives (OR).
//   "error proofing"                 -> projects containing both words
//   "error proofing, vision, clip"   -> any of the three alternatives
// Punctuation is ignored, so "error-proofing" matches "Error Proofing".

export const NO_PLANT_LABEL = 'No plant code';

const SEARCH_FIELDS = ['name', 'description', 'po_number', 'location', 'edi_plant_code', 'customer_name', 'contact_name', 'po_line_text'];

export function normalizeSearchText(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function parseSearchQuery(query) {
  return String(query ?? '')
    .split(',')
    .map(alternative => normalizeSearchText(alternative).split(' ').filter(Boolean))
    .filter(words => words.length > 0);
}

export function buildSearchText(project) {
  return ` ${SEARCH_FIELDS.map(field => normalizeSearchText(project[field])).join(' ')} `;
}

export function matchesProjectSearch(project, query) {
  const alternatives = parseSearchQuery(query);
  if (alternatives.length === 0) return true;
  const haystack = buildSearchText(project);
  return alternatives.some(words => words.every(word => haystack.includes(word)));
}

export function getPlantLabel(project) {
  const code = String(project.edi_plant_code ?? '').trim();
  return code || NO_PLANT_LABEL;
}

export function parseBoxCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

// Returns [{ plant, projects, boxes, uncounted }] sorted by plant, "No plant code" last.
export function summarizeBoxesByPlant(projects) {
  const totals = projects.reduce((byPlant, project) => {
    const plant = getPlantLabel(project);
    const current = byPlant[plant] || { plant, projects: 0, boxes: 0, uncounted: 0 };
    const count = parseBoxCount(project.box_count);
    return {
      ...byPlant,
      [plant]: {
        ...current,
        projects: current.projects + 1,
        boxes: current.boxes + (count ?? 0),
        uncounted: current.uncounted + (count === null ? 1 : 0),
      },
    };
  }, {});
  return Object.values(totals).sort((a, b) => {
    if (a.plant === NO_PLANT_LABEL) return 1;
    if (b.plant === NO_PLANT_LABEL) return -1;
    return a.plant.localeCompare(b.plant, undefined, { numeric: true });
  });
}
