import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../..');
const buildInfoPath = path.join(repoRoot, 'DEPLOYED_REVISION.json');

export interface BuildInfo {
  revision: string | null;
  builtAt: string | null;
  archiveName: string | null;
  archiveSha256: string | null;
  sourceDirty: boolean | null;
}

export function readBuildInfo(): BuildInfo {
  try {
    const raw = fs.readFileSync(buildInfoPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BuildInfo>;
    return {
      revision: typeof parsed.revision === 'string' ? parsed.revision : null,
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : null,
      archiveName: typeof parsed.archiveName === 'string' ? parsed.archiveName : null,
      archiveSha256: typeof parsed.archiveSha256 === 'string' ? parsed.archiveSha256 : null,
      sourceDirty: typeof parsed.sourceDirty === 'boolean' ? parsed.sourceDirty : null,
    };
  } catch {
    return {
      revision: null,
      builtAt: null,
      archiveName: null,
      archiveSha256: null,
      sourceDirty: null,
    };
  }
}
