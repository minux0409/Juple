using Juple.Domain.Items;

namespace Juple.UnitTests.Items;

public sealed class ItemAutomaticMetadataTests
{
    private static Item NewItem() => new(17, "https://www.instagram.com/p/ABC123xyz/", DateTimeOffset.UtcNow);

    [Fact]
    public void ApplyAutomaticMetadata_FillsEmptyFields()
    {
        var item = NewItem();

        Assert.True(item.ApplyAutomaticMetadata("someone on Instagram: \"x\"", "https://scontent.cdninstagram.com/v/a.jpg"));
        Assert.Equal("someone on Instagram: \"x\"", item.Title);
        Assert.Equal("https://scontent.cdninstagram.com/v/a.jpg", item.PreviewImageUrl);
    }

    [Fact]
    public void ApplyAutomaticMetadata_NeverOverwritesAUserTitleOrAnExistingPreviewImage()
    {
        var item = NewItem();
        item.UpdateDetails("My own title", null);
        item.SetPreviewImageUrl("https://scontent.cdninstagram.com/v/first.jpg");

        Assert.False(item.ApplyAutomaticMetadata("automatic title", "https://scontent.cdninstagram.com/v/second.jpg"));
        Assert.Equal("My own title", item.Title);
        Assert.Equal("https://scontent.cdninstagram.com/v/first.jpg", item.PreviewImageUrl);
    }

    [Fact]
    public void ApplyAutomaticMetadata_FillsOnlyTheMissingField()
    {
        var item = NewItem();
        item.UpdateDetails("My own title", null);

        Assert.True(item.ApplyAutomaticMetadata("automatic title", "https://scontent.cdninstagram.com/v/a.jpg"));
        Assert.Equal("My own title", item.Title);
        Assert.Equal("https://scontent.cdninstagram.com/v/a.jpg", item.PreviewImageUrl);
    }

    [Fact]
    public void ApplyAutomaticMetadata_IsIdempotent()
    {
        var item = NewItem();
        item.ApplyAutomaticMetadata("t", "https://scontent.cdninstagram.com/v/a.jpg");

        Assert.False(item.ApplyAutomaticMetadata("t", "https://scontent.cdninstagram.com/v/a.jpg"));
        Assert.False(item.ApplyAutomaticMetadata(null, null));
    }
}
