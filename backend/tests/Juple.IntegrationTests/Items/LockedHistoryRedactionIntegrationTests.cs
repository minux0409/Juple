using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

/// <summary>Home and Archive must receive no private preview data while the chosen Collection context is locked.</summary>
public sealed class LockedHistoryRedactionIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private long _userId;
    private long _otherUserId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        var now = DateTimeOffset.UtcNow;
        var user = new User("en-US", "UTC", null, now, now);
        var other = new User("en-US", "UTC", null, now, now);
        _db.Users.AddRange(user, other);
        await _db.SaveChangesAsync();
        (_userId, _otherUserId) = (user.Id, other.Id);
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in new[] { _userId, _otherUserId })
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    [Fact]
    public async Task LockedOwnerCollection_RedactsArchiveAndHome_ThenRevealsAfterUnlock()
    {
        var now = DateTimeOffset.UtcNow;
        var locked = new Collection(_userId, "Private", "PRIVATE", CollectionIcon.Folder, now);
        locked.Lock(now);
        var item = new Item(_userId, "https://secret.example/private-path", now);
        item.UpdateDetails("Hidden title", "Hidden memo");
        item.SetPreviewImageUrl("https://secret.example/preview.jpg");
        _db.Collections.Add(locked);
        _db.Items.Add(item);
        await _db.SaveChangesAsync();
        _db.CollectionItems.Add(new CollectionItem(locked.Id, item.Id, _userId, now, 0));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var store = new ItemStore(_db);
        var (archive, images, covers) = await store.GetHistoryAsync(_userId, null, 20);
        var redacted = Assert.Single(archive.Items);
        Assert.Equal(item.Id, redacted.Id);
        Assert.True(redacted.IsCollectionLocked);
        Assert.Equal(locked.Id, redacted.CollectionId);
        Assert.Equal("lock", redacted.CollectionGate);
        Assert.Equal("", redacted.Url);
        Assert.Null(redacted.Title);
        Assert.Null(redacted.Memo);
        Assert.Null(redacted.PreviewImageUrl);
        Assert.Empty(images);
        Assert.Empty(covers);

        var (home, _, _) = await store.GetByDateRangeAsync(_userId, now.AddMinutes(-1), now.AddMinutes(1), null, 20);
        Assert.True(Assert.Single(home.Items).IsCollectionLocked);
        Assert.Empty((await store.GetHistoryAsync(_userId, null, 20, ItemSearchPattern.ToContainsPattern("secret"))).Page.Items);

        var collection = await _db.Collections.SingleAsync(entry => entry.Id == locked.Id);
        collection.RemoveLock(now.AddSeconds(1));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        var (unlocked, _, _) = await store.GetHistoryAsync(_userId, null, 20);
        Assert.False(Assert.Single(unlocked.Items).IsCollectionLocked);
        Assert.Equal("https://secret.example/private-path", unlocked.Items[0].Url);
    }

    [Fact]
    public async Task AnotherPersonsLockedCollectionReference_DoesNotMaskMyOwnPersonalCard()
    {
        var now = DateTimeOffset.UtcNow;
        var foreign = new Collection(_otherUserId, "Foreign", "FOREIGN", CollectionIcon.Folder, now);
        foreign.Lock(now);
        var item = new Item(_userId, "https://mine.example/personal", now);
        _db.Collections.Add(foreign);
        _db.Items.Add(item);
        await _db.SaveChangesAsync();
        _db.CollectionItems.Add(new CollectionItem(foreign.Id, item.Id, _otherUserId, now, 0));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var (page, _, _) = await new ItemStore(_db).GetHistoryAsync(_userId, null, 20);
        var card = Assert.Single(page.Items);
        Assert.False(card.IsCollectionLocked);
        Assert.Null(card.CollectionId);
        Assert.Equal("https://mine.example/personal", card.Url);
    }
}
