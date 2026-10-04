import type { Db } from "../db";

/** Insert many rows in one statement via jsonb_to_recordset (works on PostgreSQL and PGlite).
 *  `cols` maps column name → SQL type. Returns ids when the table has an id column and `returning` is set. */
export async function insertMany<T extends Record<string, unknown>>(
  db: Db, table: string, cols: Record<string, string>, rows: T[], returning?: string,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const names = Object.keys(cols);
  const def = names.map((c) => `${c} ${cols[c]}`).join(", ");
  const list = names.join(", ");
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const res = await db.query(
      `insert into ${table} (${list}) select ${list} from jsonb_to_recordset($1::text::jsonb) as x(${def})
       ${returning ? `returning ${returning}` : ""}`,
      [JSON.stringify(chunk)],
    );
    out.push(...res);
  }
  return out;
}
