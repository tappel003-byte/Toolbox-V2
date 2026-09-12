// Parses real Distress Survey (pins.csv) and Floor Survey (.floorsurvey.json)
// export formats, verified directly against real job files. This is the
// bridge until each drawer is fully built inside Toolbox — it's how a
// customer's field data actually lands in their cabinet file today.

const DISTRESS_SURVEY_COLUMNS = [
  'Pin', 'Type', 'Description', 'Photo Count', 'Photo Numbers', 'Room', 'Direction', 'X', 'Y'
];

// Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes,
// and commas/newlines inside quotes. Distress Survey descriptions are free
// text and can contain commas, so a naive split(',') would corrupt rows.
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip, \n (or end) closes the row */ }
    else if (c === '\n') {
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

function parseDistressSurveyCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error('Empty CSV — no header row found.');
  const header = rows[0];
  for (const col of DISTRESS_SURVEY_COLUMNS) {
    if (!header.includes(col)) {
      throw new Error(`Missing expected column "${col}". This doesn't look like a Distress Survey pins.csv export.`);
    }
  }
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });

  const pins = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => c === '')) continue;
    const pinNum = Number(row[idx['Pin']]);
    if (!Number.isFinite(pinNum)) continue;
    pins.push({
      pin: pinNum,
      type: row[idx['Type']] || '',
      description: row[idx['Description']] || '',
      photoCount: Number(row[idx['Photo Count']]) || 0,
      photoNumbers: row[idx['Photo Numbers']] || '',
      room: row[idx['Room']] || '',
      direction: row[idx['Direction']] || '',
      x: Number(row[idx['X']]),
      y: Number(row[idx['Y']]),
    });
  }
  if (!pins.length) throw new Error('No pin rows found in this CSV.');
  return pins;
}

function parseFloorSurveyJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('Not valid JSON.');
  }
  if (data.kind !== 'floor-survey-bundle') {
    throw new Error('This doesn\'t look like a Floor Survey export (missing "kind": "floor-survey-bundle").');
  }
  if (!Array.isArray(data.floors) || !data.floors.length) {
    throw new Error('No floors found in this export.');
  }
  if (!Array.isArray(data.points)) {
    throw new Error('No points array found in this export.');
  }
  return data;
}
