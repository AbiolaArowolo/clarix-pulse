import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { Request, Response, Router } from 'express';
import { serializeAgentConfigYaml } from '../config/remoteSetup';
import { getSessionFromRequest, requireSession } from '../serverAuth';
import {
  createBundleDownloadLink,
  createNodeConfigDownloadLink,
  verifyDownloadToken,
} from '../services/downloadTokens';
import { getTenantAccessSummary, getTenantEnrollmentKey } from '../store/auth';
import { getMirroredNodeConfig } from '../store/nodeConfigMirror';
import { getActiveAgentToken, getNode } from '../store/registry';

const repoRoot = path.resolve(__dirname, '../../../..');

function resolveBundlePath(): { path: string; fileName: string } {
  const configuredPath = (process.env.PULSE_DOWNLOAD_BUNDLE_PATH ?? '').trim();
  const configuredName = (process.env.PULSE_DOWNLOAD_BUNDLE_NAME ?? '').trim();

  if (configuredPath) {
    return { path: configuredPath, fileName: configuredName || path.basename(configuredPath) };
  }

  // Auto-find the latest clarix-pulse-v*.zip using numeric version comparison.
  // String sort is wrong: "v1.9" > "v1.12" lexicographically. Parse as integers.
  const releaseDir = path.join(repoRoot, 'packages/agent/release');
  let bundleFileName = 'clarix-pulse-latest.zip';
  try {
    const parseVer = (f: string): number[] => {
      const m = f.match(/v([\d.]+)\.zip$/);
      return m ? m[1].split('.').map(Number) : [0];
    };
    const zips = fs.readdirSync(releaseDir)
      .filter(f => /^clarix-pulse-v[\d.]+\.zip$/.test(f))
      .sort((a, b) => {
        const va = parseVer(a);
        const vb = parseVer(b);
        for (let i = 0; i < Math.max(va.length, vb.length); i++) {
          const diff = (vb[i] ?? 0) - (va[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });
    if (zips.length > 0) bundleFileName = zips[0];
  } catch {
    // directory not readable — fall through to the default name
  }

  return {
    path: path.join(releaseDir, bundleFileName),
    fileName: configuredName || bundleFileName,
  };
}

export function buildTenantBundleBuffer(input: {
  bundlePath: string;
  hubUrl: string;
  enrollmentKey: string;
}): Buffer {
  const accountConfig = {
    hubUrl: input.hubUrl,
    hub_url: input.hubUrl,
    enrollmentKey: input.enrollmentKey,
    enrollment_key: input.enrollmentKey,
  };
  const accountConfigJson = JSON.stringify(accountConfig);
  const markerStart = '[PULSE_ACCOUNT_JSON_START]';
  const markerEnd = '[PULSE_ACCOUNT_JSON_END]';

  const zip = new AdmZip(input.bundlePath);

  const readmeEntry = zip.getEntry('README.txt');
  const readmeRaw = readmeEntry ? readmeEntry.getData().toString('utf8') : '';
  const markerPattern = /\[PULSE_ACCOUNT_JSON_START\][\s\S]*?\[PULSE_ACCOUNT_JSON_END\]\s*/g;
  const readmeBase = readmeRaw.replace(markerPattern, '').trimEnd();
  const readmeAugmented = `${readmeBase}\r\n\r\n${markerStart}\r\n${accountConfigJson}\r\n${markerEnd}\r\n`;

  if (readmeEntry) {
    zip.deleteFile('README.txt');
  }
  zip.addFile('README.txt', Buffer.from(readmeAugmented, 'utf8'));

  if (zip.getEntry('pulse-account.json')) {
    zip.deleteFile('pulse-account.json');
  }

  return zip.toBuffer();
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function requestBaseUrl(req: Request): string {
  const forwardedProto = asString(req.headers['x-forwarded-proto']);
  const forwardedHost = asString(req.headers['x-forwarded-host']);
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = req.get('host');
  if (!host) {
    return 'https://pulse.clarixtech.com';
  }

  return `${req.protocol}://${host}`;
}

function tenantAccessError(input: {
  enabled: boolean;
  disabledReason: string | null;
  accessKeyExpiresAt: string | null;
}): string | null {
  if (!input.enabled) {
    return input.disabledReason?.trim() || 'Account is disabled.';
  }

  if (input.accessKeyExpiresAt) {
    const expiry = new Date(input.accessKeyExpiresAt);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) {
      return 'Account access key has expired.';
    }
  }

  return null;
}

async function authorizeBundleDownload(req: Request): Promise<
  { ok: true; tenantId: string }
  | { ok: false; status: number; error: string }
> {
  const token = asString(req.query.token);
  const claims = token ? verifyDownloadToken(token) : null;
  if (token) {
    if (!claims || claims.kind !== 'bundle') {
      return {
        ok: false,
        status: 401,
        error: 'A valid signed download link is required.',
      };
    }
  } else {
    const session = await getSessionFromRequest(req);
    if (session) {
      return {
        ok: true,
        tenantId: session.tenantId,
      };
    }
  }

  if (!claims || claims.kind !== 'bundle') {
    return {
      ok: false,
      status: 401,
      error: 'A valid signed download link is required.',
    };
  }

  const tenant = await getTenantAccessSummary(claims.tenantId);
  if (!tenant) {
    return {
      ok: false,
      status: 404,
      error: 'Unknown tenant.',
    };
  }

  const accessError = tenantAccessError({
    enabled: tenant.enabled,
    disabledReason: tenant.disabledReason,
    accessKeyExpiresAt: tenant.accessKeyExpiresAt,
  });
  if (accessError) {
    return {
      ok: false,
      status: 403,
      error: accessError,
    };
  }

  return {
    ok: true,
    tenantId: tenant.tenantId,
  };
}

async function authorizeNodeConfigDownload(
  req: Request,
  nodeId: string,
): Promise<
  { ok: true; tenantId: string; signedClaims: null | { agentToken: string; mirrorUpdatedAt: string } }
  | { ok: false; status: number; error: string }
> {
  const token = asString(req.query.token);
  const claims = token ? verifyDownloadToken(token) : null;
  if (token) {
    if (!claims || claims.kind !== 'node-config' || claims.nodeId !== nodeId) {
      return {
        ok: false,
        status: 401,
        error: 'A valid signed config link is required.',
      };
    }
  } else {
    const session = await getSessionFromRequest(req);
    if (session) {
      return {
        ok: true,
        tenantId: session.tenantId,
        signedClaims: null,
      };
    }
  }

  if (!claims || claims.kind !== 'node-config' || claims.nodeId !== nodeId) {
    return {
      ok: false,
      status: 401,
      error: 'A valid signed config link is required.',
    };
  }

  const tenant = await getTenantAccessSummary(claims.tenantId);
  if (!tenant) {
    return {
      ok: false,
      status: 404,
      error: 'Unknown tenant.',
    };
  }

  const accessError = tenantAccessError({
    enabled: tenant.enabled,
    disabledReason: tenant.disabledReason,
    accessKeyExpiresAt: tenant.accessKeyExpiresAt,
  });
  if (accessError) {
    return {
      ok: false,
      status: 403,
      error: accessError,
    };
  }

  return {
    ok: true,
    tenantId: tenant.tenantId,
    signedClaims: {
      agentToken: claims.agentToken,
      mirrorUpdatedAt: claims.mirrorUpdatedAt,
    },
  };
}

export function createDownloadsRouter(): Router {
  const router = Router();

  router.get('/bundle/windows/link', requireSession, async (req: Request, res: Response) => {
    try {
      const bundle = resolveBundlePath();
      const link = createBundleDownloadLink({
        baseUrl: requestBaseUrl(req),
        tenantId: req.auth!.tenantId,
        fileName: bundle.fileName,
      });

      return res.json({
        ok: true,
        fileName: bundle.fileName,
        url: link.url,
        expiresAt: link.expiresAt,
      });
    } catch (error) {
      return res.status(503).json({
        error: error instanceof Error ? error.message : 'Signed download links are not configured on this server.',
      });
    }
  });

  router.get('/nodes/:nodeId/config-link', requireSession, async (req: Request, res: Response) => {
    const nodeId = req.params.nodeId.trim();
    const node = await getNode(req.auth!.tenantId, nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Unknown node.' });
    }

    try {
      const mirror = await getMirroredNodeConfig(node.nodeId, req.auth!.tenantId);
      if (!mirror) {
        return res.status(404).json({ error: 'No mirrored config is available for this node yet.' });
      }

      const agentToken = await getActiveAgentToken(node.nodeId, req.auth!.tenantId);
      if (!agentToken) {
        return res.status(409).json({ error: 'No active agent token is available for this node.' });
      }

      const fileName = `${node.nodeId}-pulse-config.yaml`;
      const link = createNodeConfigDownloadLink({
        baseUrl: requestBaseUrl(req),
        tenantId: req.auth!.tenantId,
        nodeId: node.nodeId,
        fileName,
        agentToken,
        mirrorUpdatedAt: mirror.updatedAt,
      });

      return res.json({
        ok: true,
        fileName,
        url: link.url,
        expiresAt: link.expiresAt,
      });
    } catch (error) {
      return res.status(503).json({
        error: error instanceof Error ? error.message : 'Signed config links are not configured on this server.',
      });
    }
  });

  router.get('/bundle/windows/latest', async (req: Request, res: Response) => {
    const auth = await authorizeBundleDownload(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const bundle = resolveBundlePath();
    if (!fs.existsSync(bundle.path)) {
      return res.status(404).json({ error: 'Installer bundle is not available on this server.' });
    }

    try {
      const enrollmentKey = await getTenantEnrollmentKey(auth.tenantId);
      if (!enrollmentKey) {
        return res.status(500).json({ error: 'Could not resolve enrollment key for this account.' });
      }

      const hubUrl = (process.env.PULSE_HUB_URL ?? '').trim() || 'https://pulse.clarixtech.com';
      const modifiedBuffer = buildTenantBundleBuffer({
        bundlePath: bundle.path,
        hubUrl,
        enrollmentKey,
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${bundle.fileName}"`);
      res.setHeader('Content-Length', modifiedBuffer.length);
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(modifiedBuffer);
    } catch (error) {
      console.error('[downloads] Failed to build tenant bundle', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to prepare installer bundle.' });
      } else {
        res.end();
      }
    }
  });

  router.get('/nodes/:nodeId/config.yaml', async (req: Request, res: Response) => {
    const nodeId = req.params.nodeId.trim();
    const auth = await authorizeNodeConfigDownload(req, nodeId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const node = await getNode(auth.tenantId, nodeId);
    if (!node) {
      return res.status(404).json({ error: 'Unknown node.' });
    }

    const mirror = await getMirroredNodeConfig(nodeId, auth.tenantId);
    if (!mirror) {
      return res.status(404).json({ error: 'No mirrored config is available for this node yet.' });
    }

    if (auth.signedClaims && auth.signedClaims.mirrorUpdatedAt !== mirror.updatedAt) {
      return res.status(409).json({ error: 'This config link is stale. Generate a fresh one from the dashboard.' });
    }

    const agentToken = auth.signedClaims?.agentToken ?? await getActiveAgentToken(nodeId, auth.tenantId);
    if (!agentToken) {
      return res.status(409).json({ error: 'No active agent token is available for this node.' });
    }
    const enrollmentKey = await getTenantEnrollmentKey(auth.tenantId);

    const configYaml = serializeAgentConfigYaml({
      nodeId: mirror.nodeId,
      nodeName: mirror.nodeName,
      siteId: mirror.siteId,
      hubUrl: mirror.hubUrl,
      pollIntervalSeconds: mirror.pollIntervalSeconds,
      players: mirror.players.map((player) => ({
        playerId: player.playerId,
        label: player.label,
        playoutType: player.playoutType,
        monitoringEnabled: true,
        paths: player.paths,
        processSelectors: player.processSelectors,
        logSelectors: player.logSelectors,
        udpInputs: player.udpInputs,
      })),
    }, agentToken, enrollmentKey);

    res.setHeader('Content-Type', 'application/x-yaml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${node.nodeId}-pulse-config.yaml"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(configYaml);
  });

  return router;
}
