import crypto from 'crypto';

export type DownloadTokenClaims =
  | {
      kind: 'bundle';
      tenantId: string;
      fileName: string;
      expiresAt: string;
    }
  | {
      kind: 'node-config';
      tenantId: string;
      nodeId: string;
      fileName: string;
      mirrorUpdatedAt: string;
      expiresAt: string;
    }
  | {
      kind: 'install-handoff';
      tenantId: string;
      nodeId: string;
      fileName: string;
      mirrorUpdatedAt: string;
      expiresAt: string;
    };

interface SignedDownloadLink {
  url: string;
  expiresAt: string;
}

function asPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function signingSecret(): string {
  const secret = (process.env.PULSE_DOWNLOAD_SIGNING_SECRET ?? '').trim();
  if (!secret) {
    throw new Error('PULSE_DOWNLOAD_SIGNING_SECRET is not configured on this server.');
  }

  return secret;
}

function linkValidityMinutes(): number {
  return Math.min(10_080, Math.max(5, asPositiveInteger(process.env.PULSE_DOWNLOAD_LINK_TTL_MINUTES, 1_440)));
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf-8');
}

function tokenSignature(payload: string): string {
  return crypto
    .createHmac('sha256', signingSecret())
    .update(payload)
    .digest('base64url');
}

function createToken(claims: DownloadTokenClaims): string {
  const payload = JSON.stringify(claims);
  const encodedPayload = base64UrlEncode(payload);
  const signature = tokenSignature(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function tokenExpiryIso(minutes = linkValidityMinutes()): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function resolveExpiryIso(expiresAt?: string): string {
  const trimmed = expiresAt?.trim();
  if (!trimmed) {
    return tokenExpiryIso();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    throw new Error('Signed download link expiry must be a future timestamp.');
  }

  return parsed.toISOString();
}

function buildUrl(baseUrl: string, pathName: string, token: string): string {
  const url = new URL(pathName, baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export function verifyDownloadToken(token: string): DownloadTokenClaims | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const [encodedPayload, signature] = trimmed.split('.', 2);
  if (!encodedPayload || !signature) {
    return null;
  }

  try {
    const expected = tokenSignature(encodedPayload);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      return null;
    }

    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<DownloadTokenClaims>;
    const kind = parsed.kind;
    const tenantId = typeof parsed.tenantId === 'string' ? parsed.tenantId.trim() : '';
    const fileName = typeof parsed.fileName === 'string' ? parsed.fileName.trim() : '';
    const expiresAt = typeof parsed.expiresAt === 'string' ? parsed.expiresAt.trim() : '';
    const expiry = new Date(expiresAt);
    if (!tenantId || !fileName || !expiresAt || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      return null;
    }

    if (kind === 'bundle') {
      return {
        kind,
        tenantId,
        fileName,
        expiresAt,
      };
    }

    if (kind === 'node-config' || kind === 'install-handoff') {
      const nodeId = typeof parsed.nodeId === 'string' ? parsed.nodeId.trim() : '';
      const mirrorUpdatedAt = typeof parsed.mirrorUpdatedAt === 'string' ? parsed.mirrorUpdatedAt.trim() : '';
      if (!nodeId || !mirrorUpdatedAt) {
        return null;
      }

      return {
        kind,
        tenantId,
        nodeId,
        fileName,
        mirrorUpdatedAt,
        expiresAt,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function createBundleDownloadLink(input: {
  baseUrl: string;
  tenantId: string;
  fileName: string;
  expiresAt?: string;
  pathName?: string;
}): SignedDownloadLink {
  const expiresAt = resolveExpiryIso(input.expiresAt);
  const token = createToken({
    kind: 'bundle',
    tenantId: input.tenantId,
    fileName: input.fileName,
    expiresAt,
  });

  return {
    url: buildUrl(input.baseUrl, input.pathName ?? '/api/downloads/bundle/windows/latest', token),
    expiresAt,
  };
}

export function createNodeConfigDownloadLink(input: {
  baseUrl: string;
  tenantId: string;
  nodeId: string;
  fileName: string;
  mirrorUpdatedAt: string;
  expiresAt?: string;
}): SignedDownloadLink {
  const expiresAt = resolveExpiryIso(input.expiresAt);
  const token = createToken({
    kind: 'node-config',
    tenantId: input.tenantId,
    nodeId: input.nodeId,
    fileName: input.fileName,
    mirrorUpdatedAt: input.mirrorUpdatedAt,
    expiresAt,
  });

  return {
    url: buildUrl(input.baseUrl, `/api/downloads/nodes/${encodeURIComponent(input.nodeId)}/config.yaml`, token),
    expiresAt,
  };
}

export function createInstallHandoffLink(input: {
  baseUrl: string;
  tenantId: string;
  nodeId: string;
  mirrorUpdatedAt: string;
  expiresAt?: string;
}): SignedDownloadLink {
  const expiresAt = resolveExpiryIso(input.expiresAt);
  const token = createToken({
    kind: 'install-handoff',
    tenantId: input.tenantId,
    nodeId: input.nodeId,
    fileName: `${input.nodeId}-install-handoff`,
    mirrorUpdatedAt: input.mirrorUpdatedAt,
    expiresAt,
  });

  return {
    url: buildUrl(input.baseUrl, '/install-handoff', token),
    expiresAt,
  };
}
