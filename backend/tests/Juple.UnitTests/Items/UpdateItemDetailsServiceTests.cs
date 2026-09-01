using Juple.Application.Items;
using Juple.Application.Items.UpdateItemDetails;

namespace Juple.UnitTests.Items;

public sealed class UpdateItemDetailsServiceTests
{
    [Fact]
    public async Task UpdateAsync_TrimsTitleOuterWhitespace()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand("  My Title  ", null));

        Assert.Equal("My Title", store.LastTitle);
    }

    [Fact]
    public async Task UpdateAsync_WhenTitleIsWhitespaceOnly_NormalizesToNull()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand("   ", null));

        Assert.Null(store.LastTitle);
    }

    [Fact]
    public async Task UpdateAsync_WhenTitleIsNull_StaysNull()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand(null, null));

        Assert.Null(store.LastTitle);
    }

    [Fact]
    public async Task UpdateAsync_WhenTitleExceeds500Characters_ThrowsInvalidItemDetails()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);
        var tooLongTitle = new string('a', 501);

        var exception = await Assert.ThrowsAsync<InvalidItemDetailsException>(
            () => service.UpdateAsync(17, 41, new UpdateItemDetailsCommand(tooLongTitle, null)));

        Assert.Equal("title", exception.Field);
        Assert.False(store.WasCalled);
    }

    [Fact]
    public async Task UpdateAsync_WhenTitleIsExactly500Characters_Succeeds()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);
        var maxLengthTitle = new string('a', 500);

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand(maxLengthTitle, null));

        Assert.Equal(maxLengthTitle, store.LastTitle);
    }

    [Fact]
    public async Task UpdateAsync_PreservesMemoLineBreaksAndInternalWhitespace()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);
        const string memo = "  first line  \nsecond line\n\nfourth line  ";

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand(null, memo));

        Assert.Equal(memo, store.LastMemo);
    }

    [Fact]
    public async Task UpdateAsync_WhenMemoIsEmptyString_NormalizesToNull()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand(null, string.Empty));

        Assert.Null(store.LastMemo);
    }

    [Fact]
    public async Task UpdateAsync_WhenMemoIsWhitespaceOnly_IsPreservedAsIs()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand(null, "   "));

        Assert.Equal("   ", store.LastMemo);
    }

    [Fact]
    public async Task UpdateAsync_WhenMemoExceeds4000Characters_ThrowsInvalidItemDetails()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);
        var tooLongMemo = new string('a', 4001);

        var exception = await Assert.ThrowsAsync<InvalidItemDetailsException>(
            () => service.UpdateAsync(17, 41, new UpdateItemDetailsCommand(null, tooLongMemo)));

        Assert.Equal("memo", exception.Field);
        Assert.False(store.WasCalled);
    }

    [Fact]
    public async Task UpdateAsync_WhenMemoIsExactly4000Characters_Succeeds()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);
        var maxLengthMemo = new string('a', 4000);

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand(null, maxLengthMemo));

        Assert.Equal(maxLengthMemo, store.LastMemo);
    }

    [Fact]
    public async Task UpdateAsync_CallsStoreWithCurrentUserAndItemId()
    {
        var store = new FakeItemDetailsStore();
        var service = new UpdateItemDetailsService(store);

        await service.UpdateAsync(17, 41, new UpdateItemDetailsCommand("Title", "Memo"));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
    }

    [Fact]
    public async Task UpdateAsync_WhenItemNotFound_PropagatesItemNotFoundException()
    {
        var store = new FakeItemDetailsStore { ThrowNotFound = true };
        var service = new UpdateItemDetailsService(store);

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => service.UpdateAsync(17, 41, new UpdateItemDetailsCommand("Title", "Memo")));
    }

    [Fact]
    public async Task UpdateAsync_WhenConcurrentWriteConflicts_PropagatesItemConcurrencyException()
    {
        var store = new FakeItemDetailsStore { ThrowConcurrency = true };
        var service = new UpdateItemDetailsService(store);

        await Assert.ThrowsAsync<ItemConcurrencyException>(
            () => service.UpdateAsync(17, 41, new UpdateItemDetailsCommand("Title", "Memo")));
    }

    private sealed class FakeItemDetailsStore : IItemDetailsStore
    {
        public bool ThrowNotFound { get; init; }

        public bool ThrowConcurrency { get; init; }

        public bool WasCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public string? LastTitle { get; private set; }

        public string? LastMemo { get; private set; }

        public Task UpdateDetailsAsync(
            long userId,
            long itemId,
            string? title,
            string? memo,
            CancellationToken cancellationToken = default)
        {
            WasCalled = true;
            LastUserId = userId;
            LastItemId = itemId;
            LastTitle = title;
            LastMemo = memo;

            if (ThrowNotFound)
            {
                throw new ItemNotFoundException();
            }

            if (ThrowConcurrency)
            {
                throw new ItemConcurrencyException(new InvalidOperationException());
            }

            return Task.CompletedTask;
        }
    }
}
