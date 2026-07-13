// Penulis XLSX minimal (tanpa dependensi tambahan) — pakai adm-zip yang sudah ada.
// Cukup untuk laporan sederhana: satu sheet, string/number, inline strings.
const AdmZip = require('adm-zip');

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function colRef(n) {           // 0 -> A, 25 -> Z, 26 -> AA
    let s = ''; n += 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
}
function cellXml(rowNum, colIdx, val) {
    const ref = colRef(colIdx) + rowNum;
    if (typeof val === 'number' && isFinite(val)) return `<c r="${ref}"><v>${val}</v></c>`;
    const t = (val == null) ? '' : String(val);
    if (t === '') return `<c r="${ref}"/>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
}
function sheetXml(rows) {
    let body = '';
    rows.forEach((row, i) => {
        const r = i + 1;
        const cells = (row || []).map((v, ci) => cellXml(r, ci, v)).join('');
        body += `<row r="${r}">${cells}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/></cols>` +
        `<sheetData>${body}</sheetData></worksheet>`;
}

// rows = array of arrays (tiap sel: string atau number). Return outPath.
exports.write = (outPath, sheetName, rows) => {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
    zip.addFile('_rels/.rels', Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`));
    zip.addFile('xl/workbook.xml', Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${esc(sheetName).slice(0, 31) || 'Sheet1'}" sheetId="1" r:id="rId1"/></sheets></workbook>`));
    zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`));
    zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheetXml(rows)));
    zip.writeZip(outPath);
    return outPath;
};
