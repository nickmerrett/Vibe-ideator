import { describe, it, expect } from 'vitest';
import { fmtDate, fmtDateShort, fmtDateTime, fmtWeekdayTime, fmtWeekdayLong } from '../dates.js';

// Use a fixed point in time to keep tests deterministic.
// 2026-01-15 14:30 UTC — a Thursday.
const ISO = '2026-01-15T14:30:00.000Z';

describe('fmtDate', () => {
  it('includes the day, short month, and full year', () => {
    const result = fmtDate(ISO);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/2026/);
  });

  it('accepts a Date object', () => {
    const result = fmtDate(new Date(ISO));
    expect(result).toMatch(/2026/);
  });
});

describe('fmtDateShort', () => {
  it('includes day and short month', () => {
    const result = fmtDateShort(ISO);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/Jan/);
  });

  it('does not include the year', () => {
    const result = fmtDateShort(ISO);
    expect(result).not.toMatch(/2026/);
  });
});

describe('fmtDateTime', () => {
  it('includes day, month, and time components', () => {
    const result = fmtDateTime(ISO);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
    // The hour and minute should appear somewhere (exact format depends on locale)
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

describe('fmtWeekdayTime', () => {
  it('includes a short weekday and time', () => {
    const result = fmtWeekdayTime(ISO);
    // Should contain an abbreviated weekday
    expect(result).toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

describe('fmtWeekdayLong', () => {
  it('includes a long weekday, day, and month', () => {
    const result = fmtWeekdayLong(ISO);
    expect(result).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
  });
});
