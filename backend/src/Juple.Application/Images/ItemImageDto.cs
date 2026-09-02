namespace Juple.Application.Images;

/// <summary>BlobName is deliberately excluded - it is an internal storage detail, never exposed on the API.</summary>
public sealed record ItemImageDto(
    long Id, string ContentType, long ByteLength, int SortOrder, DateTimeOffset CreatedAtUtc, Uri? ReadUrl);
