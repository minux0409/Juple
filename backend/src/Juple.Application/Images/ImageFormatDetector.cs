namespace Juple.Application.Images;

/// <summary>
/// Detects image format from the file's own magic bytes only - never from a client-supplied
/// Content-Type header or filename extension, both of which are untrusted client input.
/// </summary>
public static class ImageFormatDetector
{
    private static readonly byte[] JpegSignature = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] RiffSignature = [0x52, 0x49, 0x46, 0x46];
    private static readonly byte[] WebPSignature = [0x57, 0x45, 0x42, 0x50];

    public static ImageFormat? Detect(ReadOnlySpan<byte> content)
    {
        if (content.StartsWith(JpegSignature))
        {
            return ImageFormat.Jpeg;
        }

        if (content.StartsWith(PngSignature))
        {
            return ImageFormat.Png;
        }

        // WebP is a RIFF container: bytes 0-3 "RIFF", 4-7 chunk size (ignored), 8-11 "WEBP".
        if (content.Length >= 12 && content[..4].SequenceEqual(RiffSignature) &&
            content.Slice(8, 4).SequenceEqual(WebPSignature))
        {
            return ImageFormat.WebP;
        }

        return null;
    }
}
