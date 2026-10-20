export const DATA_EXPORT_PATH = '/api/v1/users/me/data-export';

export interface DataExportSummary {
  readonly links: number;
  readonly linksInTrash: number;
  readonly ownedCollections: number;
  readonly sharedCollectionsJoined: number;
  readonly comments: number;
  readonly photos: number;
  readonly photoBytes: number;
}

export interface DataExportFileLink {
  readonly kind: 'data' | 'photos';
  readonly number: number | null;
  readonly fileName: string;
  readonly downloadPath: string;
  readonly photos: number | null;
  readonly bytes: number | null;
}

export interface DataExportLinks {
  readonly expiresAtUtc: string;
  readonly files: readonly DataExportFileLink[];
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

export function parseDataExportSummary(raw: unknown): DataExportSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  return {
    links: count(value.links),
    linksInTrash: count(value.linksInTrash),
    ownedCollections: count(value.ownedCollections),
    sharedCollectionsJoined: count(value.sharedCollectionsJoined),
    comments: count(value.comments),
    photos: count(value.photos),
    photoBytes: count(value.photoBytes),
  };
}

export function isDataExportDownloadPath(path: string): boolean {
  return /^\/api\/v1\/data-export\/downloads#[A-Za-z0-9_-]{43}$/.test(path);
}

export function parseDataExportLinks(raw: unknown): DataExportLinks | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.expiresAtUtc !== 'string' || !Array.isArray(value.files)) return null;
  const files = value.files
    .filter((file): file is Record<string, unknown> => typeof file === 'object' && file !== null)
    .filter(file => typeof file.fileName === 'string' && typeof file.downloadPath === 'string' && isDataExportDownloadPath(file.downloadPath))
    .map(file => ({
      kind: file.kind === 'photos' ? ('photos' as const) : ('data' as const),
      number: typeof file.number === 'number' ? file.number : null,
      fileName: file.fileName as string,
      downloadPath: file.downloadPath as string,
      photos: typeof file.photos === 'number' ? file.photos : null,
      bytes: typeof file.bytes === 'number' ? file.bytes : null,
    }));
  return files.length > 0 ? { expiresAtUtc: value.expiresAtUtc, files } : null;
}

export function dataExportDownloadUrl(apiBaseUrl: string, path: string): string | null {
  return isDataExportDownloadPath(path) ? `${apiBaseUrl.replace(/\/+$/, '')}${path}` : null;
}

export function formatMegabytes(bytes: number, locale: string): string {
  const megabytes = bytes / (1024 * 1024);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: megabytes < 10 ? 1 : 0 }).format(Math.max(megabytes, bytes > 0 ? 0.1 : 0));
}
