function fileNameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) {
    return fallback;
  }

  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse failures.
  }

  return fallback;
}

export async function downloadAuthenticatedFile(url: string, fallbackFileName: string): Promise<void> {
  const response = await fetch(url, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Download failed.'));
  }

  const blob = await response.blob();
  const fileName = fileNameFromDisposition(response.headers.get('content-disposition'), fallbackFileName);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function requestAuthenticatedDownloadLink(url: string): Promise<{
  url: string;
  expiresAt: string;
  fileName: string;
}> {
  const response = await fetch(url, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create a secure link.'));
  }

  const payload = await response.json() as {
    ok?: boolean;
    url?: string;
    expiresAt?: string;
    fileName?: string;
    error?: string;
  };

  if (!payload.ok || !payload.url || !payload.expiresAt || !payload.fileName) {
    throw new Error(payload.error ?? 'Failed to create a secure link.');
  }

  return {
    url: payload.url,
    expiresAt: payload.expiresAt,
    fileName: payload.fileName,
  };
}
