// A faster drop-in for make.fun's csv-reader 1.0.0: run(input) returns exactly its {columns, rows, errors}.
// One left-to-right pass over char codes in a single loop (no closures over shared state); fields are cut with
// slice() between special characters instead of being built one character at a time. The broken-row policy is
// csv-reader's, rule for rule:
//   - a U+FEFF at the very start is dropped; a record ends at LF or CRLF; a line with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a quoted field runs to the next quote that is not doubled ("" is one quote, CRLF or lone CR inside is LF);
//     text after its closing quote up to the next comma or line break is appended (quote_junk when any is kept);
//     a quote that never closes is literal and the text after it is read again unquoted (unterminated_quote);
//   - rows are padded (short_row) or cut (long_row) to the first record's width;
//   - errors are {code, line, row} in the order met; line counts every LF, CRLF and lone CR inside quotes.

const COMMA = 44;
const QUOTE = 34;
const LF = 10;
const CR = 13;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos++;
        line++;
      } else if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line++;
      } else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let wasQuoted = false;
    // how the last field ended: 0 at a comma, 1 at a line break, 2 at the end of the text
    let ended = 0;
    do {
      let value = '';
      // where the unquoted read starts, and whether it is the junk after a closing quote
      let junk = false;
      wasQuoted = text.charCodeAt(pos) === QUOTE;
      if (wasQuoted) {
        const open = pos;
        let p = pos + 1;
        let start = p;
        let ln = line;
        let closed = false;
        while (p < n) {
          const c = text.charCodeAt(p);
          if (c > QUOTE) {
            p++;
            continue;
          }
          if (c === QUOTE) {
            if (p + 1 < n && text.charCodeAt(p + 1) === QUOTE) {
              value += text.slice(start, p + 1);
              p += 2;
              start = p;
              continue;
            }
            value += text.slice(start, p);
            p++;
            closed = true;
            break;
          }
          if (c === CR) {
            value += text.slice(start, p) + '\n';
            ln++;
            p += p + 1 < n && text.charCodeAt(p + 1) === LF ? 2 : 1;
            start = p;
            continue;
          }
          if (c === LF) ln++;
          p++;
        }
        if (closed) {
          pos = p;
          line = ln;
          if (pos >= n) {
            fields.push(value);
            ended = 2;
            continue;
          }
          const c = text.charCodeAt(pos);
          if (c === COMMA) {
            pos++;
            fields.push(value);
            ended = 0;
            continue;
          }
          if (c === LF) {
            pos++;
            line++;
            fields.push(value);
            ended = 1;
            continue;
          }
          if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
            pos += 2;
            line++;
            fields.push(value);
            ended = 1;
            continue;
          }
          junk = true;
        } else {
          // The quote never closes: a literal character, and the text after it is read again unquoted.
          pos = open + 1;
          value = '"';
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        }
      }
      // Unquoted characters up to the next comma or line break (stray CRs dropped), appended to value.
      let start = pos;
      let added = 0;
      for (;;) {
        if (pos >= n) {
          ended = 2;
          break;
        }
        const c = text.charCodeAt(pos);
        if (c > CR && c !== COMMA) {
          pos++;
          continue;
        }
        if (c === COMMA) {
          ended = 0;
          break;
        }
        if (c === LF) {
          ended = 1;
          break;
        }
        if (c === CR) {
          if (pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
            ended = 3; // CRLF
            break;
          }
          added += pos - start;
          value = value === '' ? text.slice(start, pos) : value + text.slice(start, pos);
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          pos++;
          start = pos;
          continue;
        }
        pos++;
      }
      added += pos - start;
      value = value === '' ? text.slice(start, pos) : value + text.slice(start, pos);
      if (ended === 0) pos++;
      else if (ended === 1) {
        pos++;
        line++;
      } else if (ended === 3) {
        pos += 2;
        line++;
        ended = 1;
      }
      if (junk && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !wasQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
