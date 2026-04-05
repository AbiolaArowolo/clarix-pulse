import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAlertTimestamp } from '../src/services/alerting';

test('formatAlertTimestamp renders a readable UTC timestamp for alert emails', () => {
  const formatted = formatAlertTimestamp(new Date('2026-04-05T22:10:30Z'));

  assert.match(formatted, /UTC/);
  assert.doesNotMatch(formatted, /T22:10:30/);
  assert.match(formatted, /2026/);
});
