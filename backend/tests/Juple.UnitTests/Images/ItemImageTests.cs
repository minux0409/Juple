using Juple.Domain.Images;

namespace Juple.UnitTests.Images;

public sealed class ItemImageTests
{
    [Fact]
    public void Constructor_SetsAllFields()
    {
        var createdAtUtc = DateTimeOffset.UtcNow;

        var image = new ItemImage(
            itemId: 17,
            blobName: "items/17/abc123.jpg",
            contentType: "image/jpeg",
            byteLength: 204_800,
            sortOrder: 0,
            createdAtUtc: createdAtUtc);

        Assert.Equal(17, image.ItemId);
        Assert.Equal("items/17/abc123.jpg", image.BlobName);
        Assert.Equal("image/jpeg", image.ContentType);
        Assert.Equal(204_800, image.ByteLength);
        Assert.Equal(0, image.SortOrder);
        Assert.Equal(createdAtUtc, image.CreatedAtUtc);
    }
}
