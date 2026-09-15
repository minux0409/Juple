using Juple.Application.Items;
using Juple.Application.Items.SetItemPreviewImage;

namespace Juple.UnitTests.Items;

public sealed class SetItemPreviewImageServiceTests
{
    [Fact]
    public async Task SetAsync_ValidHttpsUrl_PersistsItTrimmed()
    {
        var store = new FakeItemDetailsStore();
        var service = new SetItemPreviewImageService(store);

        await service.SetAsync(17, 41, new SetItemPreviewImageCommand("  https://cdn.example.com/preview.jpg  "));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
        Assert.Equal("https://cdn.example.com/preview.jpg", store.LastPreviewImageUrl);
    }

    [Fact]
    public async Task SetAsync_ValidHttpUrl_IsAccepted()
    {
        var store = new FakeItemDetailsStore();
        var service = new SetItemPreviewImageService(store);

        await service.SetAsync(17, 41, new SetItemPreviewImageCommand("http://cdn.example.com/preview.jpg"));

        Assert.Equal("http://cdn.example.com/preview.jpg", store.LastPreviewImageUrl);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not a url")]
    [InlineData("data:image/png;base64,aaaa")]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///etc/passwd")]
    [InlineData("blob:https://example.com/abc")]
    [InlineData("ftp://example.com/img.jpg")]
    [InlineData("/relative/path.jpg")]
    public async Task SetAsync_WhenUrlIsInvalidOrDisallowedScheme_ThrowsInvalidItemDetails(string? url)
    {
        var store = new FakeItemDetailsStore();
        var service = new SetItemPreviewImageService(store);

        var exception = await Assert.ThrowsAsync<InvalidItemDetailsException>(
            () => service.SetAsync(17, 41, new SetItemPreviewImageCommand(url)));

        Assert.Equal("previewImageUrl", exception.Field);
        Assert.False(store.WasCalled);
    }

    [Fact]
    public async Task SetAsync_WhenUrlExceedsMaxLength_ThrowsInvalidItemDetails()
    {
        var store = new FakeItemDetailsStore();
        var service = new SetItemPreviewImageService(store);
        var tooLongUrl = "https://cdn.example.com/" + new string('a', 4096);

        await Assert.ThrowsAsync<InvalidItemDetailsException>(
            () => service.SetAsync(17, 41, new SetItemPreviewImageCommand(tooLongUrl)));
    }

    [Fact]
    public async Task SetAsync_WhenItemNotFound_PropagatesItemNotFoundException()
    {
        var store = new FakeItemDetailsStore { ThrowNotFound = true };
        var service = new SetItemPreviewImageService(store);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => service.SetAsync(17, 41, new SetItemPreviewImageCommand("https://cdn.example.com/preview.jpg")));
    }

    private sealed class FakeItemDetailsStore : IItemDetailsStore
    {
        public bool ThrowNotFound { get; init; }

        public bool WasCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public string? LastPreviewImageUrl { get; private set; }

        public Task UpdateDetailsAsync(
            long userId,
            long itemId,
            string? title,
            string? memo,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task SetPreviewImageUrlAsync(
            long userId,
            long itemId,
            string previewImageUrl,
            CancellationToken cancellationToken = default)
        {
            WasCalled = true;
            LastUserId = userId;
            LastItemId = itemId;
            LastPreviewImageUrl = previewImageUrl;

            if (ThrowNotFound)
            {
                throw new ItemNotFoundException();
            }

            return Task.CompletedTask;
        }

        public Task SetCoverImageIdAsync(
            long userId,
            long itemId,
            long? imageId,
            CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();
    }
}
