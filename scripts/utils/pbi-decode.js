/**
 * Power BI "publish to web" result decoder.
 *
 * querydata responses use a delta-compressed row format (DM0):
 *   - The first row carries the column schema in `S` ([{N,T}, ...]) and a
 *     full value tuple in `C`.
 *   - Later rows carry only the columns that CHANGED in `C`, plus:
 *       R: bitmask of columns repeated from the previous row (value reused)
 *       Ø: bitmask of columns that are null this row
 *   - Columns not flagged repeated/null are consumed from `C` left to right.
 *
 * decodeDM0(capture) returns an array of full value tuples (arrays), one per
 * row, with repeats expanded and nulls filled — i.e. plain tabular rows in
 * the column order declared by `S`.
 */

function getDM0(capture) {
    try {
        return capture.body.results[0].result.data.dsr.DS[0].PH[0].DM0;
    } catch {
        return null;
    }
}

export function decodeDM0(capture) {
    const rows = getDM0(capture);
    if (!Array.isArray(rows) || rows.length === 0) return [];

    // Column count from the first row's schema.
    const schema = rows[0].S;
    const ncols = Array.isArray(schema) ? schema.length : (rows[0].C || []).length;

    const out = [];
    let prev = new Array(ncols).fill(null);

    for (const row of rows) {
        const repeatMask = row.R || 0;   // bit i set → reuse prev[i]
        const nullMask = row.Ø || 0;     // bit i set → null
        const values = row.C || [];
        const result = new Array(ncols);
        let ci = 0;
        for (let i = 0; i < ncols; i++) {
            const bit = 1 << i;
            if (repeatMask & bit) {
                result[i] = prev[i];
            } else if (nullMask & bit) {
                result[i] = null;
            } else {
                result[i] = ci < values.length ? values[ci] : null;
                ci++;
            }
        }
        out.push(result);
        prev = result;
    }
    return out;
}

/**
 * Column names from a capture's schema (`S` of the first DM0 row), if present.
 */
export function dm0Columns(capture) {
    const rows = getDM0(capture);
    const schema = rows?.[0]?.S;
    return Array.isArray(schema) ? schema.map((s) => s.N) : [];
}
