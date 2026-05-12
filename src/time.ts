export function startOfTodayMs(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isTodayMs(ts: number, now: Date = new Date()): boolean {
  return ts >= startOfTodayMs(now) && ts <= now.getTime();
}

export function todayDateParts(now: Date = new Date()): {
  year: string;
  month: string;
  day: string;
} {
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0'),
  };
}
