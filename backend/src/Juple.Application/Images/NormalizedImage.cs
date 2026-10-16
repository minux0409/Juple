namespace Juple.Application.Images;

/// <summary>
/// One normalized, metadata-free WebP image (a profile photo or a Collection icon photo) - see
/// <see cref="ItemImageNormalizer.NormalizeSingle"/>. Stored as <see cref="ImageFormat.WebP"/>.
/// </summary>
public sealed record NormalizedImage(byte[] Content, int Width, int Height);
