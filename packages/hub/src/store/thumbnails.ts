import fs from 'fs';
import path from 'path';

const THUMBNAIL_DIR = path.resolve(
  process.env.PULSE_THUMBNAIL_DIR?.trim() || path.join(__dirname, '../../data/thumbnails'),
);

function ensureThumbnailDir(): void {
  if (!fs.existsSync(THUMBNAIL_DIR)) {
    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  }
}

function thumbnailPath(playerId: string): string {
  return path.join(THUMBNAIL_DIR, `${playerId}.jpg`);
}

function parseDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl.trim());
  if (!match) {
    return null;
  }

  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

export function getThumbnailStorePath(): string {
  ensureThumbnailDir();
  return THUMBNAIL_DIR;
}

export async function saveThumbnail(playerId: string, dataUrl: string): Promise<void> {
  const imageBuffer = parseDataUrl(dataUrl);
  if (!imageBuffer) {
    throw new Error('Invalid thumbnail payload.');
  }

  ensureThumbnailDir();
  await fs.promises.writeFile(thumbnailPath(playerId), imageBuffer);
}

export async function readThumbnailDataUrl(playerId: string): Promise<string | null> {
  try {
    const file = await fs.promises.readFile(thumbnailPath(playerId));
    return `data:image/jpeg;base64,${file.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function hasThumbnailFile(playerId: string): Promise<boolean> {
  try {
    await fs.promises.access(thumbnailPath(playerId), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function deleteThumbnailsForPlayers(playerIds: readonly string[]): Promise<void> {
  ensureThumbnailDir();

  await Promise.all(playerIds.map(async (playerId) => {
    try {
      await fs.promises.unlink(thumbnailPath(playerId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        throw error;
      }
    }
  }));
}
