import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  computeMissedAndNext,
  computeNextRunAt,
  isValidTimezone
} from '../src/utils/date.utils.js';

describe('date.utils (timezones and DST)', () => {
  it('validates IANA timezones', () => {
    assert.equal(isValidTimezone('Europe/Moscow'), true);
    assert.equal(isValidTimezone('Europe/Amsterdam'), true);
    assert.equal(isValidTimezone('Europe/Berlin'), true);
    assert.equal(isValidTimezone('Asia/Almaty'), true);
    assert.equal(isValidTimezone('America/New_York'), true);
    assert.equal(isValidTimezone('Mars/Phobos'), false);
    assert.equal(isValidTimezone('UTC+3'), false);
    assert.equal(isValidTimezone('Europe Moscow'), false);
  });

  it('computes daily schedule across Europe/Amsterdam spring-forward DST', () => {
    // 2026-03-29 is spring forward in Europe/Amsterdam (02:00 -> 03:00, UTC+1 -> UTC+2)
    const beforeDst = DateTime.fromISO('2026-03-28T10:00:00Z');
    const nextRun = computeNextRunAt({
      scheduleType: 'daily',
      scheduleData: { time: '09:00' },
      timezone: 'Europe/Amsterdam',
      fromUtc: beforeDst
    });

    // 2026-03-29 09:00 CEST = 07:00 UTC (UTC+2)
    assert.equal(nextRun, '2026-03-29T07:00:00.000Z');

    // Day before DST (2026-03-28 09:00 CET = 08:00 UTC)
    const twoDaysBefore = DateTime.fromISO('2026-03-27T10:00:00Z');
    const runOnMar28 = computeNextRunAt({
      scheduleType: 'daily',
      scheduleData: { time: '09:00' },
      timezone: 'Europe/Amsterdam',
      fromUtc: twoDaysBefore
    });
    assert.equal(runOnMar28, '2026-03-28T08:00:00.000Z');
  });

  it('computes daily schedule across Europe/Amsterdam fall-back DST', () => {
    // 2026-10-25 is fall back in Europe/Amsterdam (03:00 -> 02:00, UTC+2 -> UTC+1)
    const beforeFallBack = DateTime.fromISO('2026-10-24T10:00:00Z');
    const nextRun = computeNextRunAt({
      scheduleType: 'daily',
      scheduleData: { time: '09:00' },
      timezone: 'Europe/Amsterdam',
      fromUtc: beforeFallBack
    });
    // 2026-10-25 09:00 CET = 08:00 UTC
    assert.equal(nextRun, '2026-10-25T08:00:00.000Z');
  });

  it('computes weekly schedule with multiple weekdays', () => {
    // 2026-11-23 is Monday
    const mondayMorning = DateTime.fromISO('2026-11-23T06:00:00Z'); // 09:00 MSK
    const run1 = computeNextRunAt({
      scheduleType: 'weekly',
      scheduleData: { days: [1, 3, 5], time: '18:30' },
      timezone: 'Europe/Moscow',
      fromUtc: mondayMorning
    });
    // Same Monday 18:30 MSK = 15:30 UTC
    assert.equal(run1, '2026-11-23T15:30:00.000Z');

    const afterMonRun = DateTime.fromISO('2026-11-23T15:30:00.000Z');
    const run2 = computeNextRunAt({
      scheduleType: 'weekly',
      scheduleData: { days: [1, 3, 5], time: '18:30' },
      timezone: 'Europe/Moscow',
      fromUtc: afterMonRun
    });
    // Wednesday 2026-11-25 18:30 MSK = 15:30 UTC
    assert.equal(run2, '2026-11-25T15:30:00.000Z');
  });

  it('computes missed occurrences and caps excessive backlog after long downtime', () => {
    const startSlot = '2026-11-01T06:00:00.000Z'; // 09:00 MSK
    const nowAfter5Days = DateTime.fromISO('2026-11-06T07:00:00.000Z');

    const res = computeMissedAndNext({
      scheduleType: 'daily',
      scheduleData: { time: '09:00' },
      timezone: 'Europe/Moscow',
      currentNextRunAtIso: startSlot,
      nowUtc: nowAfter5Days,
      maxMissed: 3
    });

    assert.equal(res.totalMissed, 6); // Nov 1..6
    assert.equal(res.missedSlots.length, 3);
    assert.deepEqual(res.missedSlots, [
      '2026-11-04T06:00:00.000Z',
      '2026-11-05T06:00:00.000Z',
      '2026-11-06T06:00:00.000Z'
    ]);
    assert.equal(res.nextRunAt, '2026-11-07T06:00:00.000Z');
  });
});
