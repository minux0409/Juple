using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.MergeCollections;
using Juple.Application.Collections.MoveCollectionItem;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Collections.TransferCollectionItem;
using Juple.Application.Images;
using Juple.Application.Notifications;

namespace Juple.UnitTests.Collections;

/// <summary>
/// The lock protects the Collection's content, not just reading it: adding, removing, reordering,
/// transferring and merging all need a valid unlock grant when the Collection is locked - for the
/// Owner as much as for a Contributor - on top of the role's own permission.
/// </summary>
public sealed class CollectionLockScopeTests
{
    private const long Owner = 1;
    private const long Contributor = 2;
    private const long Stranger = 3;
    private const long Locked = 10;
    private const long Unlocked = 11;
    private const long OtherLocked = 12;

    private readonly InMemoryCollectionAccessStore _accessStore = new();
    private readonly RecordingItemStore _itemStore = new();
    private readonly RecordingManagementStore _managementStore = new();
    private readonly CollectionAccessService _access;

    public CollectionLockScopeTests()
    {
        _accessStore.Add(Locked, Owner, Contributor);
        _accessStore.SetLock(Locked, isLocked: true, lockVersion: 3);
        _accessStore.Add(Unlocked, Owner, Contributor);
        _accessStore.Add(OtherLocked, Owner);
        _accessStore.SetLock(OtherLocked, isLocked: true, lockVersion: 1);
        _access = new CollectionAccessService(_accessStore, new FakeUnlockTokenProtector(), TimeProvider.System);
    }

    private static string Grant(long collectionId, long userId, int lockVersion) =>
        FakeUnlockTokenProtector.Token(collectionId, CollectionUnlockSubject.ForUser(userId), lockVersion);

    private AddItemToCollectionService Add() => new(_access, _itemStore, TimeProvider.System);

    [Theory]
    [InlineData(Owner)]
    [InlineData(Contributor)]
    public async Task AddingALink_ToALockedCollection_NeedsTheCallersOwnGrant(long userId)
    {
        await Assert.ThrowsAsync<CollectionLockedException>(() => Add().AddAsync(userId, Locked, 99));
        Assert.Equal(0, _itemStore.Adds);

        await Add().AddAsync(userId, Locked, 99, Grant(Locked, userId, 3));
        Assert.Equal(1, _itemStore.Adds);
    }

    [Fact]
    public async Task AGrantIsNeverTransferable_BetweenUsers_Collections_OrLockVersions()
    {
        await Assert.ThrowsAsync<CollectionLockedException>(() => Add().AddAsync(Contributor, Locked, 99, Grant(Locked, Owner, 3)));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Add().AddAsync(Owner, Locked, 99, Grant(OtherLocked, Owner, 1)));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Add().AddAsync(Owner, Locked, 99, Grant(Locked, Owner, 2)));
        Assert.Equal(0, _itemStore.Adds);
    }

    [Fact]
    public async Task WithoutMembership_EvenACorrectGrantShapeIsA404()
    {
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Add().AddAsync(Stranger, Locked, 99, Grant(Locked, Stranger, 3)));
    }

    [Fact]
    public async Task RemovingALink_FromALockedCollection_NeedsAGrant_AndStaysOwnerOnly()
    {
        var remove = new RemoveItemFromCollectionService(_access, _itemStore);

        await Assert.ThrowsAsync<CollectionLockedException>(() => remove.RemoveAsync(Owner, Locked, 99));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => remove.RemoveAsync(Contributor, Locked, 99, Grant(Locked, Contributor, 3)));
        Assert.Equal(0, _itemStore.Removes);

        await remove.RemoveAsync(Owner, Locked, 99, Grant(Locked, Owner, 3));
        Assert.Equal(1, _itemStore.Removes);
    }

    [Fact]
    public async Task Reorder_IsOwnerOnly_AllowedInACollaborativeCollection_ButNeedsAGrantWhenLocked()
    {
        var move = new MoveCollectionItemService(_access, _itemStore);

        await Assert.ThrowsAsync<CollectionLockedException>(() => move.MoveAsync(Owner, Locked, 99, null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => move.MoveAsync(Contributor, Unlocked, 99, null));

        await move.MoveAsync(Owner, Locked, 99, null, Grant(Locked, Owner, 3));
        await move.MoveAsync(Owner, Unlocked, 99, null); // collaborative, unlocked: unchanged behavior
        Assert.Equal(2, _itemStore.Moves);
    }

    [Fact]
    public async Task TransferAndMerge_NeedAGrantForEveryLockedCollectionInvolved()
    {
        var transfer = new TransferCollectionItemService(_access, _managementStore);
        var merge = new MergeCollectionsService(_access, _managementStore);

        await Assert.ThrowsAsync<CollectionLockedException>(() => transfer.TransferAsync(Owner, Unlocked, 99, OtherLocked));
        await Assert.ThrowsAsync<CollectionLockedException>(
            () => merge.MergeAsync(Owner, Locked, OtherLocked, Grant(Locked, Owner, 3)));
        Assert.Equal(0, _managementStore.Calls);

        await transfer.TransferAsync(Owner, Unlocked, 99, OtherLocked, Grant(OtherLocked, Owner, 1));
        await merge.MergeAsync(Owner, Locked, OtherLocked, $"{Grant(Locked, Owner, 3)},{Grant(OtherLocked, Owner, 1)}");
        Assert.Equal(2, _managementStore.Calls);
    }

    [Fact]
    public async Task ContentChanges_ArePublished_OnlyAfterThePermittedChangeSucceeded()
    {
        var publisher = new RecordingSocialPublisher();
        var add = new AddItemToCollectionService(_access, _itemStore, TimeProvider.System, publisher);
        var remove = new RemoveItemFromCollectionService(_access, _itemStore, publisher);

        await Assert.ThrowsAsync<CollectionLockedException>(() => add.AddAsync(Contributor, Locked, 99));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => remove.RemoveAsync(Contributor, Unlocked, 99));
        Assert.Empty(publisher.Changes);

        await add.AddAsync(Contributor, Unlocked, 99);
        await remove.RemoveAsync(Owner, Unlocked, 99);
        Assert.Equal(new[] { (Contributor, Unlocked), (Owner, Unlocked) }, publisher.Changes);
    }

    [Fact]
    public async Task AnUnlockedCollection_KeepsItsExistingBehavior_WithoutAnyGrant()
    {
        await Add().AddAsync(Contributor, Unlocked, 99);
        await new RemoveItemFromCollectionService(_access, _itemStore).RemoveAsync(Owner, Unlocked, 99);
        Assert.Equal((1, 1), (_itemStore.Adds, _itemStore.Removes));
    }

    private sealed class RecordingItemStore : ICollectionItemStore
    {
        public int Adds { get; private set; }

        public int Removes { get; private set; }

        public int Moves { get; private set; }

        public Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsAsync(
            long userId, long collectionId, CollectionItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<SharedCollectionItemDto?> GetSharedItemAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task AddAsync(long userId, long collectionId, long itemId, DateTimeOffset addedAtUtc, CancellationToken cancellationToken = default)
        {
            Adds++;
            return Task.CompletedTask;
        }

        public Task RemoveAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default)
        {
            Removes++;
            return Task.CompletedTask;
        }

        public Task MoveItemAsync(long userId, long collectionId, long itemId, long? afterItemId, CancellationToken cancellationToken = default)
        {
            Moves++;
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingManagementStore : ICollectionManagementStore
    {
        public int Calls { get; private set; }

        public Task<TransferCollectionItemResult> TransferItemAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new TransferCollectionItemResult(true));
        }

        public Task UndoTransferItemAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId, bool targetMembershipCreated, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.CompletedTask;
        }

        public Task<MergeCollectionsResult> MergeAsync(long userId, long sourceCollectionId, long targetCollectionId, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new MergeCollectionsResult(Guid.NewGuid()));
        }

        public Task UndoMergeAsync(long userId, Guid undoOperationId, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    internal sealed class RecordingSocialPublisher : ISocialNotificationPublisher
    {
        public List<(long Actor, long CollectionId)> Changes { get; } = [];

        public List<string> Events { get; } = [];

        public Task FriendRequestReceivedAsync(long requesterUserId, long recipientUserId, long friendshipId, CancellationToken cancellationToken = default)
        {
            Events.Add($"friend:{requesterUserId}->{recipientUserId}:{friendshipId}");
            return Task.CompletedTask;
        }

        public Task CollectionInvitationReceivedAsync(long ownerUserId, long invitedUserId, long collectionId, long invitationId, CancellationToken cancellationToken = default)
        {
            Events.Add($"invite:{ownerUserId}->{invitedUserId}:{collectionId}:{invitationId}");
            return Task.CompletedTask;
        }

        public Task CollectionInvitationAnsweredAsync(long inviteeUserId, long invitationId, CancellationToken cancellationToken = default)
        {
            Events.Add($"answered:{inviteeUserId}:{invitationId}");
            return Task.CompletedTask;
        }

        public Task CollectionsChangedAsync(long actorUserId, IReadOnlyCollection<long> collectionIds, CancellationToken cancellationToken = default)
        {
            Changes.AddRange(collectionIds.Select(collectionId => (actorUserId, collectionId)));
            return Task.CompletedTask;
        }

        public Task ItemCollectionsChangedAsync(long actorUserId, long itemId, CancellationToken cancellationToken = default)
        {
            Events.Add($"item:{actorUserId}:{itemId}");
            return Task.CompletedTask;
        }
    }
}
