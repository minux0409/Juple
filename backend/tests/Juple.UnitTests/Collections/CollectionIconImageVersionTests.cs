using Juple.Application.Collections.SetCollectionIconImage;

namespace Juple.UnitTests.Collections;

public sealed class CollectionIconImageVersionTests
{
    [Fact]
    public void SamePhoto_AlwaysGetsTheSameVersion()
    {
        const string blobName = "items/7/collections/42/0f1e2d3c4b5a69788796a5b4c3d2e1f0.jpg";

        Assert.Equal(CollectionIconImageVersion.From(blobName), CollectionIconImageVersion.From(blobName));
    }

    [Fact]
    public void AReplacedPhoto_GetsANewVersion_ThatNeverRevealsTheBlobName()
    {
        var first = CollectionIconImageVersion.From("items/7/collections/42/aaaa.jpg");
        var second = CollectionIconImageVersion.From("items/7/collections/42/bbbb.jpg");

        Assert.NotEqual(first, second);
        Assert.Matches("^[0-9a-f]{16}$", first);
        Assert.DoesNotContain("aaaa", first);
    }
}
