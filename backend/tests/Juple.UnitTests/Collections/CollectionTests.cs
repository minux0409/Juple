using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class CollectionTests
{
    private static readonly DateTimeOffset CreatedAtUtc = new(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Constructor_SetsNameAndTimestamps()
    {
        var collection = new Collection(17, "Books to read", "BOOKS TO READ", CreatedAtUtc);

        Assert.Equal("Books to read", collection.Name);
        Assert.Equal("BOOKS TO READ", collection.NameNormalized);
        Assert.Equal(CreatedAtUtc, collection.CreatedAtUtc);
        Assert.Equal(CreatedAtUtc, collection.UpdatedAtUtc);
    }

    [Fact]
    public void Rename_ChangesNameAndUpdatedAtUtc()
    {
        var collection = new Collection(17, "Books to read", "BOOKS TO READ", CreatedAtUtc);
        var renamedAtUtc = CreatedAtUtc.AddDays(1);

        collection.Rename("Reading list", "READING LIST", renamedAtUtc);

        Assert.Equal("Reading list", collection.Name);
        Assert.Equal("READING LIST", collection.NameNormalized);
        Assert.Equal(renamedAtUtc, collection.UpdatedAtUtc);
    }

    [Fact]
    public void Rename_WithSameValue_IsNoOpAndDoesNotTouchUpdatedAtUtc()
    {
        var collection = new Collection(17, "Books to read", "BOOKS TO READ", CreatedAtUtc);
        var renamedAtUtc = CreatedAtUtc.AddDays(1);

        collection.Rename("Books to read", "BOOKS TO READ", renamedAtUtc);

        Assert.Equal(CreatedAtUtc, collection.UpdatedAtUtc);
    }
}
