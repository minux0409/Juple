namespace Juple.Domain.Images;

/// <summary>
/// A user-uploaded image attached to an Item. BlobName identifies the object in Blob Storage but
/// carries no FK/referential meaning at the database level - Blob lifecycle is managed separately
/// by application/storage logic, not by this Entity. Create-only for now: no rename/reorder yet.
/// </summary>
public sealed class ItemImage
{
    private ItemImage()
    {
    }

    public ItemImage(
        long itemId,
        string blobName,
        string contentType,
        long byteLength,
        int sortOrder,
        DateTimeOffset createdAtUtc)
    {
        ItemId = itemId;
        BlobName = blobName;
        ContentType = contentType;
        ByteLength = byteLength;
        SortOrder = sortOrder;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long ItemId { get; private set; }

    public string BlobName { get; private set; } = null!;

    public string ContentType { get; private set; } = null!;

    public long ByteLength { get; private set; }

    public int SortOrder { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
