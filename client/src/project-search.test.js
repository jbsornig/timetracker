import {
  matchesProjectSearch, parseSearchQuery, summarizeBoxesByPlant, parseBoxCount, NO_PLANT_LABEL,
} from './project-search';

const errorProofing = { name: 'WTAP Error-Proofing for GA Quality Defects', po_number: '62167276', edi_plant_code: '2452', box_count: 1 };
const visionBox = { name: 'TSAP Vision Box', description: 'Vision check', po_number: '62217795', edi_plant_code: '2459', box_count: null };
const poLineOnly = { name: 'Mack PO', po_line_text: 'Error proofing Complete Assembly | Switches', edi_plant_code: '2470', box_count: 6 };
const noPlant = { name: 'Toledo Vision Check Box', po_number: '62095301', edi_plant_code: '', box_count: 2 };

describe('parseSearchQuery', () => {
  it('splits commas into alternatives and words', () => {
    expect(parseSearchQuery('Error proofing, vision')).toEqual([['error', 'proofing'], ['vision']]);
  });

  it('returns no alternatives for blank or punctuation-only input', () => {
    expect(parseSearchQuery('  , ,')).toEqual([]);
    expect(parseSearchQuery(undefined)).toEqual([]);
  });
});

describe('matchesProjectSearch', () => {
  it('matches everything when the query is empty', () => {
    expect(matchesProjectSearch(visionBox, '')).toBe(true);
  });

  it('ignores case and punctuation', () => {
    expect(matchesProjectSearch(errorProofing, 'error proofing')).toBe(true);
    expect(matchesProjectSearch(errorProofing, 'ERROR-PROOFING')).toBe(true);
  });

  it('requires every word of an alternative', () => {
    expect(matchesProjectSearch(errorProofing, 'error vision')).toBe(false);
  });

  it('matches any comma-separated alternative', () => {
    expect(matchesProjectSearch(visionBox, 'error proofing, vision')).toBe(true);
    expect(matchesProjectSearch(visionBox, 'error proofing, clip counter')).toBe(false);
  });

  it('searches PO line descriptions, PO numbers and plant codes', () => {
    expect(matchesProjectSearch(poLineOnly, 'complete assembly')).toBe(true);
    expect(matchesProjectSearch(visionBox, '62217795')).toBe(true);
    expect(matchesProjectSearch(errorProofing, '2452')).toBe(true);
  });

  it('tolerates missing fields', () => {
    expect(matchesProjectSearch({}, 'vision')).toBe(false);
  });
});

describe('parseBoxCount', () => {
  it('accepts whole numbers including zero', () => {
    expect(parseBoxCount(0)).toBe(0);
    expect(parseBoxCount('3')).toBe(3);
  });

  it('treats blank, negative and fractional values as not recorded', () => {
    expect(parseBoxCount('')).toBeNull();
    expect(parseBoxCount(null)).toBeNull();
    expect(parseBoxCount(-1)).toBeNull();
    expect(parseBoxCount(1.5)).toBeNull();
  });
});

describe('summarizeBoxesByPlant', () => {
  it('totals boxes per plant and counts projects with no box count', () => {
    const summary = summarizeBoxesByPlant([errorProofing, visionBox, poLineOnly, noPlant, { ...errorProofing, box_count: 2 }]);
    expect(summary).toEqual([
      { plant: '2452', projects: 2, boxes: 3, uncounted: 0 },
      { plant: '2459', projects: 1, boxes: 0, uncounted: 1 },
      { plant: '2470', projects: 1, boxes: 6, uncounted: 0 },
      { plant: NO_PLANT_LABEL, projects: 1, boxes: 2, uncounted: 0 },
    ]);
  });

  it('does not mutate the input projects', () => {
    const input = [{ ...errorProofing }];
    summarizeBoxesByPlant(input);
    expect(input[0]).toEqual(errorProofing);
  });

  it('returns an empty list for no projects', () => {
    expect(summarizeBoxesByPlant([])).toEqual([]);
  });
});
