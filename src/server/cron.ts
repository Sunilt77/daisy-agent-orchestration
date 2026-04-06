type ParsedField = {
  any: boolean;
  values: Set<number>;
};

type ParsedCron = {
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
};

function parsePart(part: string, min: number, max: number): number[] {
  const normalized = String(part || '').trim();
  if (!normalized) return [];
  if (normalized === '*') {
    const all: number[] = [];
    for (let value = min; value <= max; value += 1) all.push(value);
    return all;
  }

  const [rangePart, stepPart] = normalized.split('/');
  const step = stepPart == null ? 1 : Number(stepPart);
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error(`Invalid cron step "${part}"`);
  }

  let start = min;
  let end = max;
  if (rangePart !== '*') {
    if (rangePart.includes('-')) {
      const [sRaw, eRaw] = rangePart.split('-');
      start = Number(sRaw);
      end = Number(eRaw);
    } else {
      start = Number(rangePart);
      end = start;
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end) {
    throw new Error(`Invalid cron range "${part}"`);
  }

  const values: number[] = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

function parseField(raw: string, min: number, max: number): ParsedField {
  const source = String(raw || '').trim();
  if (!source) throw new Error('Empty cron field');
  if (source === '*') {
    const all = new Set<number>();
    for (let value = min; value <= max; value += 1) all.add(value);
    return { any: true, values: all };
  }
  const values = new Set<number>();
  for (const part of source.split(',')) {
    for (const value of parsePart(part, min, max)) values.add(value);
  }
  if (!values.size) throw new Error(`Invalid cron field "${raw}"`);
  return { any: false, values };
}

export function parseCronExpression(expr: string): ParsedCron {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error('Cron expression must have 5 fields: minute hour day_of_month month day_of_week');
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function matchesDay(parsed: ParsedCron, dateUtc: Date): boolean {
  const domMatch = parsed.dayOfMonth.values.has(dateUtc.getUTCDate());
  const dowMatch = parsed.dayOfWeek.values.has(dateUtc.getUTCDay());
  if (parsed.dayOfMonth.any && parsed.dayOfWeek.any) return true;
  if (parsed.dayOfMonth.any) return dowMatch;
  if (parsed.dayOfWeek.any) return domMatch;
  return domMatch || dowMatch;
}

function matches(parsed: ParsedCron, dateUtc: Date): boolean {
  return (
    parsed.minute.values.has(dateUtc.getUTCMinutes()) &&
    parsed.hour.values.has(dateUtc.getUTCHours()) &&
    parsed.month.values.has(dateUtc.getUTCMonth() + 1) &&
    matchesDay(parsed, dateUtc)
  );
}

export function getNextCronOccurrenceUtc(expr: string, fromDate: Date): Date {
  const parsed = parseCronExpression(expr);
  const cursor = new Date(fromDate);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const maxChecks = 366 * 24 * 60 * 2; // up to ~2 years
  for (let checks = 0; checks < maxChecks; checks += 1) {
    if (matches(parsed, cursor)) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error(`Unable to compute next run for cron expression "${expr}"`);
}

