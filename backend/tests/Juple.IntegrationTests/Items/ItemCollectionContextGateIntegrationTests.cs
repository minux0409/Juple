using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Locking;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.GetItemDetail;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Items;

/// <summary>
/// The server-side half of the Home/Archive locked card: GET items/{id}?collectionId= (and its photo list) against the
/// real schema. Opened in a Collection's context, the Item is read only after THAT Collection's current gate passes with
/// a grant for THAT Collection - the Owner included - and only when the Item is really in it. Context-aware: another,
/// unlocked Collection holding the same Item is unaffected, and a read without a context keeps its old behavior.
/// </summary>
public sealed class ItemCollectionContextGateIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private CollectionStore _collections = null!;
    private CollectionUnlockTokenProtector _tokens = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _stranger;
    private long _locked;
    private long _open;
    private long _otherLocked;
    private long _itemInLockedAndOpen;
    private long _itemNowhere;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _collections = new CollectionStore(_db);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _owner = await NewUserAsync();
        _stranger = await NewUserAsync();

        _locked = (await _collections.CreateAsync(_owner, "Locked", "LOCKED", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _open = (await _collections.CreateAsync(_owner, "Open", "OPEN", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _otherLocked = (await _collections.CreateAsync(_owner, "OtherLocked", "OTHERLOCKED", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

        var shared = new Item(_owner, "https://secret.example/in-both", DateTimeOffset.UtcNow);
        shared.UpdateDetails("Private title", "Private memo");
        var nowhere = new Item(_owner, "https://secret.example/nowhere", DateTimeOffset.UtcNow);
        _db.Items.AddRange(shared, nowhere);
        await _db.SaveChangesAsync();
        (_itemInLockedAndOpen, _itemNowhere) = (shared.Id, nowhere.Id);
        await _collections.AddAsync(_owner, _locked, shared.Id, DateTimeOffset.UtcNow);
        await _collections.AddAsync(_owner, _open, shared.Id, DateTimeOffset.UtcNow);
        await new CollectionLockStore(_db).LockAsync(_locked, DateTimeOffset.UtcNow);
        await new CollectionLockStore(_db).LockAsync(_otherLocked, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private ItemCollectionContextGate Gate()
    {
        _db.ChangeTracker.Clear();
        return new ItemCollectionContextGate(new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System), new ItemStore(_db));
    }

    /// <summary>What GET items/{id}?collectionId= does: the gate, then (only then) the detail read.</summary>
    private async Task<ItemDetailsDto> OpenAsync(long userId, long itemId, long collectionId, string? grant)
    {
        await Gate().RequireAsync(userId, itemId, collectionId, grant);
        return await new GetItemDetailService(new ItemStore(_db), new NoImages()).GetAsync(userId, itemId);
    }

    private async Task<string> GrantAsync(long collectionId)
    {
        var version = await _db.Collections.AsNoTracking().Where(collection => collection.Id == collectionId).Select(collection => collection.LockVersion).SingleAsync();
        return _tokens.Issue(collectionId, CollectionUnlockSubject.ForUser(_owner), version, DateTimeOffset.UtcNow).Token;
    }

    [Fact]
    public async Task A_B_LockedContext_WithoutAGrant_IsRefused_ForTheOwnerToo_AndNothingIsRead()
    {
        // The caller IS the Collection's Owner and the Item's owner: still refused - no Owner bypass.
        await Assert.ThrowsAsync<CollectionLockedException>(() => OpenAsync(_owner, _itemInLockedAndOpen, _locked, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => OpenAsync(_owner, _itemInLockedAndOpen, _locked, "not-a-grant"));
    }

    [Fact]
    public async Task C_LockedContext_WithAValidGrantForIt_ReturnsTheDetail()
    {
        var details = await OpenAsync(_owner, _itemInLockedAndOpen, _locked, await GrantAsync(_locked));
        Assert.Equal("Private title", details.Title);
        Assert.Equal("https://secret.example/in-both", details.Url);
    }

    [Fact]
    public async Task D_UnlockedContext_NeedsNoGrant()
    {
        var details = await OpenAsync(_owner, _itemInLockedAndOpen, _open, null);
        Assert.Equal("Private memo", details.Memo);
    }

    [Fact]
    public async Task E_AnItemThatIsNotInTheGivenCollection_IsNotFound_AndAStrangerCannotUseTheContext()
    {
        await Assert.ThrowsAsync<ItemNotFoundException>(() => OpenAsync(_owner, _itemNowhere, _open, null));
        // Even with the right grant, an Item outside the locked Collection is not opened through it.
        var lockedGrant = await GrantAsync(_locked);
        await Assert.ThrowsAsync<ItemNotFoundException>(() => OpenAsync(_owner, _itemNowhere, _locked, lockedGrant));
        // Someone else's Collection/Item: the Collection is simply not there for them.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => OpenAsync(_stranger, _itemInLockedAndOpen, _open, null));
    }

    [Fact]
    public async Task F_OneLockedReference_IsNoGlobalLock_TheUnlockedCollectionAndTheContextFreeReadStillOpen()
    {
        Assert.Equal("Private title", (await OpenAsync(_owner, _itemInLockedAndOpen, _open, null)).Title);
        // The original, context-free read keeps its ownership-only behavior.
        Assert.Equal("Private title", (await new GetItemDetailService(new ItemStore(_db), new NoImages()).GetAsync(_owner, _itemInLockedAndOpen)).Title);
    }

    [Fact]
    public async Task G_AGrantForAnotherLockedCollection_DoesNotOpenThisOne()
    {
        var otherGrant = await GrantAsync(_otherLocked);
        await Assert.ThrowsAsync<CollectionLockedException>(() => OpenAsync(_owner, _itemInLockedAndOpen, _locked, otherGrant));
    }

    [Fact]
    public async Task H_TheCurrentLockStateDecides_RemovedAfterTheSnapshotOpens_AddedAfterItRefuses()
    {
        // The card was redacted while locked; the Owner removed the lock meanwhile: opens without a password.
        await new CollectionLockStore(_db).RemoveLockAsync(_locked, DateTimeOffset.UtcNow);
        Assert.Equal("Private title", (await OpenAsync(_owner, _itemInLockedAndOpen, _locked, null)).Title);

        // A grant from before the lock was removed and set again is stale (the lock version moved on): refused.
        var staleGrant = await GrantAsync(_locked);
        await new CollectionLockStore(_db).LockAsync(_locked, DateTimeOffset.UtcNow);
        await Assert.ThrowsAsync<CollectionLockedException>(() => OpenAsync(_owner, _itemInLockedAndOpen, _locked, staleGrant));
        await Assert.ThrowsAsync<CollectionLockedException>(() => OpenAsync(_owner, _itemInLockedAndOpen, _locked, null));
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private sealed class NoImages : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.FromResult<Uri?>(null);
    }
}
