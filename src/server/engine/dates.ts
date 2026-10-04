// Business dates are IST calendar dates as "YYYY-MM-DD" strings.

export function istDate(at: Date = new Date()): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Same day next month, minus one day: a one-month period starting on `from`. */
export function monthEnd(from: string): string {
  const [y, m, d] = from.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // days in the next month
  const next = new Date(Date.UTC(y, m, Math.min(d, last)));
  return addDays(next.toISOString().slice(0, 10), -1);
}

/** Indian financial year label, e.g. "2026-27" for any date from 1 Apr 2026 to 31 Mar 2027. */
export function fyOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export const maxDate = (a: string, b: string) => (a > b ? a : b);
