import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstallHandoffLink, verifyDownloadToken } from '../src/services/downloadTokens';

test('createInstallHandoffLink creates a verifiable signed token', () => {
  process.env.PULSE_DOWNLOAD_SIGNING_SECRET = 'test-secret-for-install-handoff';

  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const link = createInstallHandoffLink({
    baseUrl: 'https://pulse.example.com',
    tenantId: 'tenant-123',
    nodeId: 'node-123',
    mirrorUpdatedAt: '2026-03-29T21:30:00.000Z',
    expiresAt,
  });

  const url = new URL(link.url);
  assert.equal(url.pathname, '/install-handoff');
  assert.equal(link.expiresAt, expiresAt);

  const token = url.searchParams.get('token');
  assert.ok(token);

  const claims = verifyDownloadToken(token!);
  assert.deepEqual(claims, {
    kind: 'install-handoff',
    tenantId: 'tenant-123',
    nodeId: 'node-123',
    fileName: 'node-123-install-handoff',
    mirrorUpdatedAt: '2026-03-29T21:30:00.000Z',
    expiresAt,
  });
});
