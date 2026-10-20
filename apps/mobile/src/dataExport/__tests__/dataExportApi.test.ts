import { downloadUrl, formatMegabytes, isDownloadPath } from '../dataExportApi';

describe('data export download links', () => {
  const token = 'A'.repeat(43);

  it('opens only the API download route with an exact 256-bit Base64Url token', () => {
    const path = `/api/v1/data-export/downloads#${token}`;
    expect(isDownloadPath(path)).toBe(true);
    expect(downloadUrl(path, 'https://api.example.test/')).toBe(`https://api.example.test${path}`);
    expect(isDownloadPath('https://evil.example/download')).toBe(false);
    expect(isDownloadPath(`/api/v1/data-export/downloads#${token}x`)).toBe(false);
    expect(isDownloadPath(`/api/v1/data-export/downloads/${token}`)).toBe(false);
    expect(downloadUrl('https://evil.example/download', 'https://api.example.test')).toBeNull();
  });

  it('formats bounded megabytes without reporting a positive file as zero', () => {
    expect(formatMegabytes(0, 'en')).toBe('0');
    expect(formatMegabytes(1, 'en')).toBe('0.1');
    expect(formatMegabytes(15 * 1024 * 1024, 'en')).toBe('15');
  });
});
