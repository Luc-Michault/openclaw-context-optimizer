/**
 * RFC 4180–style CSV: quoted fields, "" escape, commas/newlines inside quotes.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsvText(text) {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      const hasContent = row.some((cell) => cell.length > 0);
      if (hasContent || row.length > 1) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  row.push(field);
  const hasContent = row.some((cell) => cell.length > 0);
  if (hasContent || row.length > 1) rows.push(row);

  return rows.map((r) => r.map((cell) => cell.trim()));
}

module.exports = { parseCsvText };
