/**
 * Downloads.
 *
 * Two shapes: a blob (the MP4, which the browser has already fetched) and plain
 * text (the script, the caption). Both go through one helper so the filename, the
 * MIME type and the cleanup happen in exactly one place.
 */

/** Triggers a browser download for an in-memory blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  // Revoke on the next tick: revoking synchronously can cancel the download in
  // Safari before it has read the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Triggers a browser download for text (script, caption, hashtags). */
export function downloadText(text: string, filename: string, mimeType = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), filename);
}

/** A safe filename stem from a job id and a title. */
export function downloadStem(jobId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length > 0 ? `${slug}-${jobId}` : jobId;
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * Fetches a URL as a blob, or returns null when it cannot be read.
 *
 * Cross-origin URLs without CORS cannot be turned into a download by the
 * browser, so a null here is an honest "use the link instead" rather than a
 * silently empty file.
 */
export async function fetchAsBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}
