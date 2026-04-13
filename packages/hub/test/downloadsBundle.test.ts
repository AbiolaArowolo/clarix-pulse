import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import test from 'node:test';
import express from 'express';
import AdmZip from 'adm-zip';

let mockedTenantId = 'tenant-123';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/serverAuth') || specifier.endsWith('/serverAuth.ts')) {
      return { url: 'mock:serverAuth', shortCircuit: true };
    }
    if (specifier.endsWith('/store/auth') || specifier.endsWith('/store/auth.ts')) {
      return { url: 'mock:store-auth', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'mock:serverAuth') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export async function getSessionFromRequest() {
            return { tenantId: ${JSON.stringify(mockedTenantId)} };
          }

          export async function requireSession(_req, _res, next) {
            return next();
          }
        `,
      };
    }

    if (url === 'mock:store-auth') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export async function getTenantAccessSummary() {
            return {
              tenantId: ${JSON.stringify(mockedTenantId)},
              enabled: true,
              disabledReason: null,
              accessKeyExpiresAt: null,
            };
          }

        `,
      };
    }

    return nextLoad(url, context);
  },
});

test('/api/downloads/bundle/windows/ClarixPulseSetup.exe streams the installer executable directly', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-download-test-'));
  const bundlePath = path.join(tempRoot, 'clarix-pulse-test.zip');

  try {
    const zip = new AdmZip();
    zip.addFile('ClarixPulseSetup.exe', Buffer.from('setup', 'utf8'));
    zip.addFile('Uninstall.exe', Buffer.from('uninstall', 'utf8'));
    zip.addFile('README.txt', Buffer.from('Original readme content.\r\n', 'utf8'));
    zip.writeZip(bundlePath);

    process.env.PULSE_DOWNLOAD_BUNDLE_PATH = bundlePath;
    process.env.PULSE_DOWNLOAD_BUNDLE_NAME = 'clarix-pulse-test.zip';

    const { createDownloadsRouter } = await import('../src/routes/downloads');

    const app = express();
    app.use('/api/downloads', createDownloadsRouter());

    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.on('listening', () => resolve()));
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/downloads/bundle/windows/ClarixPulseSetup.exe`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/octet-stream');
      assert.match(response.headers.get('content-disposition') ?? '', /ClarixPulseSetup\.exe/i);
      const buffer = Buffer.from(await response.arrayBuffer());
      assert.equal(buffer.toString('utf8'), 'setup');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    delete process.env.PULSE_DOWNLOAD_BUNDLE_PATH;
    delete process.env.PULSE_DOWNLOAD_BUNDLE_NAME;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
