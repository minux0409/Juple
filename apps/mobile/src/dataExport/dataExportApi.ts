import { apiConfig } from '../api/apiConfig';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';

export const DATA_EXPORT_PATH = '/api/v1/users/me/data-export';

/** What an export of the person's own data contains (counts only; the server decides what is included). */
export interface DataExportSummary {
  readonly links: number;
  readonly linksInTrash: number;
  readonly ownedCollections: number;
  readonly sharedCollectionsJoined: number;
  readonly comments: number;
  readonly purchases: number;
  readonly repeatPurchases: number;
  readonly photos: number;
  readonly photoBytes: number;
  readonly photoFiles: readonly { readonly number: number; readonly photos: number; readonly bytes: number }[];
}

/** One file of an export: the data file, or one numbered photo file. downloadPath is API-relative and works for a few minutes. */
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

export async function getDataExportSummary(request: AuthenticatedApiRequest): Promise<DataExportSummary> {
  const response = await request<Record<string, unknown>>({ method: 'GET', path: DATA_EXPORT_PATH });
  const body = response.body ?? {};
  return {
    links: count(body.links),
    linksInTrash: count(body.linksInTrash),
    ownedCollections: count(body.ownedCollections),
    sharedCollectionsJoined: count(body.sharedCollectionsJoined),
    comments: count(body.comments),
    purchases: count(body.purchases),
    repeatPurchases: count(body.repeatPurchases),
    photos: count(body.photos),
    photoBytes: count(body.photoBytes),
    photoFiles: Array.isArray(body.photoFiles)
      ? body.photoFiles.map(file => ({ number: count(file?.number), photos: count(file?.photos), bytes: count(file?.bytes) }))
      : [],
  };
}

/**
 * Asks for the download links of one export. The server requires a recent sign-in (403 recentAuthenticationRequired) and limits how often
 * this may be asked (429 dataExportRateLimited); both surface as ApiError for the screen to explain.
 */
export async function createDataExportLinks(request: AuthenticatedApiRequest): Promise<DataExportLinks> {
  const response = await request<{ expiresAtUtc?: unknown; files?: unknown }>({ method: 'POST', path: `${DATA_EXPORT_PATH}/links` });
  const files = Array.isArray(response.body?.files) ? response.body.files : [];
  return {
    expiresAtUtc: typeof response.body?.expiresAtUtc === 'string' ? response.body.expiresAtUtc : '',
    files: files
      .filter((file): file is Record<string, unknown> => typeof file === 'object' && file !== null)
      .filter(file => typeof file.downloadPath === 'string' && isDownloadPath(file.downloadPath) && typeof file.fileName === 'string')
      .map(file => ({
        kind: file.kind === 'photos' ? 'photos' : 'data',
        number: typeof file.number === 'number' ? file.number : null,
        fileName: file.fileName as string,
        downloadPath: file.downloadPath as string,
        photos: typeof file.photos === 'number' ? file.photos : null,
        bytes: typeof file.bytes === 'number' ? file.bytes : null,
      })),
  };
}

/** Only the API's own download route is ever opened - never an arbitrary URL from a response. */
export function isDownloadPath(path: string): boolean {
  return /^\/api\/v1\/data-export\/downloads#[A-Za-z0-9_-]{43}$/.test(path);
}

/**
 * The absolute URL the system browser / downloader opens (it cannot send the app's token; the link itself is the permission). Null when
 * this build has no API address or the path is not the download route.
 */
export function downloadUrl(path: string, baseUrl: string | undefined = apiConfig.baseUrl): string | null {
  if (!baseUrl || !isDownloadPath(path)) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** Megabytes with at most one decimal, in the app language's number format (the unit word comes from the translation). */
export function formatMegabytes(bytes: number, language: string): string {
  const megabytes = bytes / (1024 * 1024);
  return new Intl.NumberFormat(language, { maximumFractionDigits: megabytes < 10 ? 1 : 0, minimumFractionDigits: 0 }).format(Math.max(megabytes, bytes > 0 ? 0.1 : 0));
}
