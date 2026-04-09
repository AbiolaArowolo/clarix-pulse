import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import test from 'node:test';
import express from 'express';
import AdmZip from 'adm-zip';

let mockedTenantId = 'tenant-123';
let mockedEnrollmentKey = 'ENROLL-123-TEST';

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

          export async function getTenantEnrollmentKey() {
            return ${JSON.stringify(mockedEnrollmentKey)};
          }
        `,
      };
    }

    return nextLoad(url, context);
  },
});

test('/api/downloads/bundle/windows/latest injects pulse-account.json for the authenticated tenant', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-download-test-'));
  const bundlePath = path.join(tempRoot, 'clarix-pulse-test.zip');

  try {
    const zip = new AdmZip();
    zip.addFile('setup.bat', Buffer.from('@echo off\r\necho test\r\n', 'utf8'));
    zip.writeZip(bundlePath);

    process.env.PULSE_DOWNLOAD_BUNDLE_PATH = bundlePath;
    process.env.PULSE_DOWNLOAD_BUNDLE_NAME = 'clarix-pulse-test.zip';
    process.env.PULSE_HUB_URL = 'https://pulse.example.com';

    const { createDownloadsRouter } = await import('../src/routes/downloads');

    const app = express();
    app.use('/api/downloads', createDownloadsRouter());

    const server = app.listen(0);
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/downloads/bundle/windows/latest`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/zip');

      const buffer = Buffer.from(await response.arrayBuffer());
      const extracted = new AdmZip(buffer);
      const accountFile = extracted.getEntry('pulse-account.json');
      assert.ok(accountFile, 'pulse-account.json should be included in the bundle');

      const accountConfig = JSON.parse(accountFile!.getData().toString('utf8')) as {
        hubUrl: string;
        hub_url: string;
        enrollmentKey: string;
        enrollment_key: string;
      };

      assert.equal(accountConfig.hubUrl, 'https://pulse.example.com');
      assert.equal(accountConfig.hub_url, 'https://pulse.example.com');
      assert.equal(accountConfig.enrollmentKey, mockedEnrollmentKey);
      assert.equal(accountConfig.enrollment_key, mockedEnrollmentKey);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    delete process.env.PULSE_DOWNLOAD_BUNDLE_PATH;
    delete process.env.PULSE_DOWNLOAD_BUNDLE_NAME;
    delete process.env.PULSE_HUB_URL;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
