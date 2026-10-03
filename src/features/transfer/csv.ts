export class CsvError extends Error {
	constructor(readonly offset: number, reason: string) {
		super(`Invalid CSV at character ${offset + 1}: ${reason}`);
		this.name = 'CsvError';
	}
}

/** RFC 4180, also accepting LF input. A final record separator is not an extra row. */
export function parseCsv(input: string): string[][] {
	const text = input.replace(/^\uFEFF/, '');
	if (text === '') return [];
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let closed = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') { field += '"'; i++; }
				else { quoted = false; closed = true; }
			} else field += c;
			continue;
		}
		if (c === ',') {
			row.push(field); field = ''; closed = false;
		} else if (c === '\r' || c === '\n') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field); rows.push(row); row = []; field = ''; closed = false;
		} else if (c === '"' && field === '' && !closed) {
			quoted = true;
		} else {
			if (closed || c === '"') throw new CsvError(i, 'unexpected character outside a quoted field');
			field += c;
		}
	}
	if (quoted) throw new CsvError(text.length, 'unterminated quoted field');
	if (field !== '' || row.length > 0 || closed) { row.push(field); rows.push(row); }
	return rows;
}

export function serializeCsv(rows: readonly (readonly string[])[], bom = true): string {
	const escape = (cell: string): string => /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
	return (bom ? '\uFEFF' : '') + rows.map((row) => row.map(escape).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}
