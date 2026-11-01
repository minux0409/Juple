using Juple.Application.Collections;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.Reactions;
using Juple.Application.Safety;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Safety;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Safety;

/// <summary>
/// What a block does inside a shared Collection, against the real schema. The rule: the links two people who block each other ADDED are hidden
/// from each other - existing and new alike, whoever blocked whom, the Collection's owner included - while nothing is deleted, a third person's
/// links follow the normal rules and unblocking shows everything again. Blocking the OWNER of a Collection I belong to also ends my membership
/// there (nothing else); blocking a member of my own Collection changes no membership. The anonymous public link is outside the rule.
/// </summary>
public sealed class BlockPolicyIntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    public Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run these integration tests.");
        _db = NewContext();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/blockpolicy/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/blockpolicy/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task<(long Id, string JupleId)> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return (user.Id, user.PublicCode);
    }

    private async Task<long> NewCollectionAsync(long owner, params long[] members)
    {
        var collection = await new CollectionStore(_db).CreateAsync(owner, "Blocked " + Guid.NewGuid().ToString("N")[..8], Guid.NewGuid().ToString("N"), CollectionIcon.Folder, DateTimeOffset.UtcNow, null);
        foreach (var member in members)
        {
            _db.CollectionCollaborators.Add(new CollectionCollaborator(collection.Id, member, CollectionCollaboratorRole.Contributor, owner, DateTimeOffset.UtcNow));
        }

        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        return collection.Id;
    }

    private async Task<long> NewLinkAsync(long userId, long collectionId)
    {
        await Task.Delay(20);
        var saved = await new ItemStore(_db).SaveAsync(userId, "https://example.test/" + Guid.NewGuid().ToString("N"), null, DateTimeOffset.UtcNow);
        await new CollectionStore(_db).AddAsync(userId, collectionId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private UserBlockService Blocks() => new(new UserDirectoryStore(NewContext()), new SafetyStore(NewContext()), TimeProvider.System);

    private async Task<IReadOnlyList<long>> LinksSeenByAsync(long viewer, long collection)
    {
        var page = (await new CollectionStore(NewContext()).GetItemsAsync(viewer, collection, null, 100)).Page;
        return page.Items.Select(entry => entry.ItemId).ToList();
    }

    private async Task<int> CardCountAsync(long viewer, long collection)
    {
        var list = await new CollectionStore(NewContext()).ListByScopeAsync(viewer, CollectionListScope.All, null, null, null, 100);
        return list.Items.Single(entry => entry.Id == collection).ItemCount;
    }

    private async Task<int> RangeCountAsync(long viewer, long collection)
    {
        var counts = await new CollectionStore(NewContext()).CountByAddedRangesAsync(
            viewer, collection, [(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1))]);
        return Assert.Single(counts);
    }

    private Task<bool> IsMemberAsync(long user, long collection) =>
        NewContext().CollectionCollaborators.AnyAsync(member => member.CollectionId == collection && member.UserId == user);

    [Fact]
    public async Task ExistingAndNewLinks_AreHiddenBothWays_ThirdPersonSeesAll_AndUnblockingRestoresEverything()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var (c, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(c, a, b);
        var a0 = await NewLinkAsync(a, collection);
        var b0 = await NewLinkAsync(b, collection);
        var c0 = await NewLinkAsync(c, collection);

        await Blocks().BlockAsync(a, bCode);
        var a1 = await NewLinkAsync(a, collection);
        var b1 = await NewLinkAsync(b, collection);

        // The block hides what the OTHER person added, whenever it was added: a sees a0, a1 and the owner's c0; b sees b0, b1, c0.
        Assert.Equivalent(new[] { a0, a1, c0 }, await LinksSeenByAsync(a, collection));
        Assert.Equivalent(new[] { b0, b1, c0 }, await LinksSeenByAsync(b, collection));
        // The Collection's owner is a third person here: everything.
        Assert.Equivalent(new[] { a0, b0, c0, a1, b1 }, await LinksSeenByAsync(c, collection));

        // Counts agree with the lists (card count and date-range count).
        Assert.Equal(3, await CardCountAsync(a, collection));
        Assert.Equal(3, await CardCountAsync(b, collection));
        Assert.Equal(5, await CardCountAsync(c, collection));
        Assert.Equal(3, await RangeCountAsync(a, collection));
        Assert.Equal(3, await RangeCountAsync(b, collection));
        Assert.Equal(5, await RangeCountAsync(c, collection));

        // Detail by id, and a search that matches the hidden link, never reach it.
        Assert.Null(await new CollectionStore(NewContext()).GetSharedItemAsync(a, collection, b0));
        Assert.Null(await new CollectionStore(NewContext()).GetSharedItemAsync(a, collection, b1));
        Assert.Null(await new CollectionStore(NewContext()).GetSharedItemAsync(b, collection, a0));
        Assert.NotNull(await new CollectionStore(NewContext()).GetSharedItemAsync(a, collection, c0));
        Assert.NotNull(await new CollectionStore(NewContext()).GetSharedItemAsync(c, collection, b0));
        var search = await new CollectionStore(NewContext()).SearchItemsAsync(a, collection, "%example.test%", null, 100, CollectionItemSort.DateDesc);
        Assert.DoesNotContain(search.Page.Items, entry => entry.ItemId == b0 || entry.ItemId == b1);

        // Nothing was deleted or removed: every link and membership is still there.
        Assert.Equal(5, await NewContext().CollectionItems.CountAsync(membership => membership.CollectionId == collection));
        Assert.True(await IsMemberAsync(a, collection) && await IsMemberAsync(b, collection));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == b0 && item.DeletedAtUtc == null));

        await Blocks().UnblockAsync(a, bCode);
        Assert.Equivalent(new[] { a0, b0, c0, a1, b1 }, await LinksSeenByAsync(a, collection));
        Assert.Equivalent(new[] { a0, b0, c0, a1, b1 }, await LinksSeenByAsync(b, collection));
        Assert.Equal(5, await CardCountAsync(a, collection));
        Assert.Equal(5, await RangeCountAsync(b, collection));
    }

    [Fact]
    public async Task OwnerBlocksAParticipant_KeepsMembershipAndData_ButTheTwoNoLongerSeeEachOthersLinks()
    {
        // Case A: B owns the Collection, A participates, B blocks A.
        var (b, _) = await NewUserAsync();
        var (a, aCode) = await NewUserAsync();
        var (c, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(b, a, c);
        var ownersLink = await NewLinkAsync(b, collection);
        var participantsLink = await NewLinkAsync(a, collection);
        var thirdsLink = await NewLinkAsync(c, collection);

        await Blocks().BlockAsync(b, aCode);

        Assert.True(await IsMemberAsync(a, collection) && await IsMemberAsync(c, collection));
        // Being the owner is no way around a block: the owner does not see the participant's link, and the participant not the owner's.
        Assert.Equivalent(new[] { ownersLink, thirdsLink }, await LinksSeenByAsync(b, collection));
        Assert.Equivalent(new[] { participantsLink, thirdsLink }, await LinksSeenByAsync(a, collection));
        Assert.Equivalent(new[] { ownersLink, participantsLink, thirdsLink }, await LinksSeenByAsync(c, collection));
        Assert.Null(await new CollectionStore(NewContext()).GetSharedItemAsync(b, collection, participantsLink));
        Assert.Equal(3, await NewContext().CollectionItems.CountAsync(membership => membership.CollectionId == collection));
    }

    [Fact]
    public async Task ParticipantBlocksTheOwner_LeavesEveryCollectionOfThatOwner_AndNothingElse_Idempotently()
    {
        // Case B: A owns two Collections, B participates in both and in a third that someone else owns; B blocks A.
        var (a, aCode) = await NewUserAsync();
        var (b, _) = await NewUserAsync();
        var (other, _) = await NewUserAsync();
        var first = await NewCollectionAsync(a, b);
        var second = await NewCollectionAsync(a, b);
        var elsewhere = await NewCollectionAsync(other, b);
        var bLinkInFirst = await NewLinkAsync(b, first);

        await Blocks().BlockAsync(b, aCode);

        Assert.False(await IsMemberAsync(b, first));
        Assert.False(await IsMemberAsync(b, second));
        Assert.True(await IsMemberAsync(b, elsewhere));
        // What B added stays in the Collection and B's own item stays B's: only the membership ended.
        Assert.True(await NewContext().CollectionItems.AnyAsync(membership => membership.CollectionId == first && membership.ItemId == bLinkInFirst));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == bLinkInFirst && item.UserId == b && item.DeletedAtUtc == null));
        Assert.True(await NewContext().Collections.AnyAsync(collection => collection.Id == first && collection.UserId == a && collection.DeletedAtUtc == null));
        // The Collection is gone from B's lists and cannot be opened.
        Assert.DoesNotContain((await new CollectionStore(NewContext()).ListByScopeAsync(b, CollectionListScope.All, null, null, null, 100)).Items, entry => entry.Id == first);
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => new CollectionStore(NewContext()).GetItemsAsync(b, first, null, 10));

        // Repeating the block, or an unblock, changes nothing and never restores the membership.
        await Blocks().BlockAsync(b, aCode);
        await Blocks().UnblockAsync(b, aCode);
        Assert.False(await IsMemberAsync(b, first));
        Assert.True(await IsMemberAsync(b, elsewhere));
    }

    [Fact]
    public async Task OwnerBlockingTheParticipant_DoesNotMoveTheBlockedPerson()
    {
        // A owns; B participates; A blocks B (the owner blocks the participant): B stays. Only a participant blocking the OWNER ends a membership.
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(a, b);

        await Blocks().BlockAsync(a, bCode);

        Assert.True(await IsMemberAsync(b, collection));
        Assert.True(await NewContext().Collections.AnyAsync(entry => entry.Id == collection && entry.UserId == a));
    }

    [Fact]
    public async Task SharedLink_OfAnOwnerIBlocked_SaysSoBeforeAnythingOfTheCollection_AndNeverRevealsAnotherPersonsBlock()
    {
        var (owner, ownerCode) = await NewUserAsync();
        var (visitor, _) = await NewUserAsync();
        var (blockedByOwner, blockedByOwnerCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner);
        await _db.CollectionShares.Where(share => share.CollectionId == collection).ExecuteUpdateAsync(setters => setters.SetProperty(share => share.IsPublic, true));
        var publicId = await _db.CollectionShares.Where(share => share.CollectionId == collection).Select(share => share.PublicId).FirstAsync();

        Assert.False((await new PublicShareMembershipStore(NewContext()).GetAsync(publicId, visitor))!.OwnerBlockedByYou);

        await Blocks().BlockAsync(visitor, ownerCode);
        var answer = (await new PublicShareMembershipStore(NewContext()).GetAsync(publicId, visitor))!;
        Assert.True(answer.OwnerBlockedByYou);
        Assert.False(answer.IsMember);
        Assert.Null(answer.CollectionId);
        Assert.False(string.IsNullOrWhiteSpace(answer.OwnerName));

        // The owner blocking someone else is not told to that someone.
        await Blocks().BlockAsync(owner, blockedByOwnerCode);
        Assert.False((await new PublicShareMembershipStore(NewContext()).GetAsync(publicId, blockedByOwner))!.OwnerBlockedByYou);

        await Blocks().UnblockAsync(visitor, ownerCode);
        Assert.False((await new PublicShareMembershipStore(NewContext()).GetAsync(publicId, visitor))!.OwnerBlockedByYou);
    }

    [Fact]
    public async Task Interactions_OnAHiddenLinkAreRefused_AndWordsOfABlockedPersonAreHidden()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var (c, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(c, a, b);
        var b0 = await NewLinkAsync(b, collection);
        var c0 = await NewLinkAsync(c, collection);
        var bsComment = await new CollectionItemCommentStore(NewContext()).CreateAsync(b, collection, c0, "from b", DateTimeOffset.UtcNow);
        Assert.NotNull(bsComment);

        await Blocks().BlockAsync(a, bCode);

        // B's link is hidden from A: no comment, no heart, no thread.
        Assert.Null(await new CollectionItemCommentStore(NewContext()).CreateAsync(a, collection, b0, "hi", DateTimeOffset.UtcNow));
        Assert.Null(await new CollectionItemCommentStore(NewContext()).GetPageAsync(a, collection, b0, null, 20));
        Assert.Equal(CollectionReactionWrite.NotALink, await new CollectionItemReactionStore(NewContext()).SetAsync(a, collection, b0, "heart", DateTimeOffset.UtcNow));

        // C's link stays commentable for A, but B's words on it are hidden from A (not from C), and A cannot answer B.
        Assert.Equal(0, (await new CollectionItemCommentStore(NewContext()).GetPageAsync(a, collection, c0, null, 20))!.TotalCount);
        Assert.Equal(1, (await new CollectionItemCommentStore(NewContext()).GetPageAsync(c, collection, c0, null, 20))!.TotalCount);
        Assert.NotNull(await new CollectionItemCommentStore(NewContext()).CreateAsync(a, collection, c0, "hello c", DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<UserBlockedException>(() =>
            new CollectionItemCommentStore(NewContext()).CreateAsync(a, collection, c0, "reply", DateTimeOffset.UtcNow, bsComment!.Comment.Id));
    }

    [Fact]
    public async Task FriendRequestsInvitationsAndProposals_AreRefusedAcrossABlock_AndDoubleBlockingIsHarmless()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(a);

        await Blocks().BlockAsync(a, bCode);
        await Blocks().BlockAsync(a, bCode);
        Assert.Equal(1, await NewContext().UserBlocks.CountAsync(block => block.BlockerUserId == a && block.BlockedUserId == b));
        Assert.Equal(bCode, Assert.Single(await Blocks().ListAsync(a)).JupleId);

        var policy = new UserBlockPolicy(new SafetyStore(NewContext()));
        var byBlocker = await Assert.ThrowsAsync<UserBlockedException>(() => policy.EnsureNotBlockedAsync(a, b));
        Assert.True(byBlocker.BlockedByCaller);
        var byOther = await Assert.ThrowsAsync<UserBlockedException>(() => policy.EnsureNotBlockedAsync(b, a));
        Assert.False(byOther.BlockedByCaller);

        await Assert.ThrowsAsync<UserBlockedException>(() =>
            new CollectionCollaborationStore(NewContext()).CreateInvitationAsync(collection, a, b, DateTimeOffset.UtcNow));

        var proposal = await new ItemStore(NewContext()).SaveAsync(b, "https://example.test/" + Guid.NewGuid().ToString("N"), null, DateTimeOffset.UtcNow);
        await Assert.ThrowsAsync<UserBlockedException>(() =>
            new CollectionLinkSubmissionStore(NewContext()).SubmitAsync(b, collection, proposal.Entry.Id, null, DateTimeOffset.UtcNow));

        Assert.False(await new SafetyStore(NewContext()).AddBlockAsync(a, b, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task PublicLink_IsAnonymous_SoABlockDoesNotChangeWhatItShows()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(a, b);
        await NewLinkAsync(a, collection);
        await Blocks().BlockAsync(a, bCode);
        await NewLinkAsync(a, collection);

        await _db.CollectionShares.Where(share => share.CollectionId == collection).ExecuteUpdateAsync(setters => setters.SetProperty(share => share.IsPublic, true));
        var publicId = await _db.CollectionShares.Where(share => share.CollectionId == collection).Select(share => share.PublicId).FirstAsync();

        // The documented limit: an anonymous reader has no identity to compare, so a block changes nothing there.
        var page = await new PublicCollectionStore(NewContext()).GetItemsAsync(publicId, null, 50);
        Assert.NotNull(page);
        Assert.Equal(2, page!.Items.Count);
    }

    [Fact]
    public async Task AccountDeletion_RemovesTheBlockRows_AndKeepsTheOtherPersonsLinks()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(a, b);
        var a0 = await NewLinkAsync(a, collection);
        await Blocks().BlockAsync(a, bCode);
        await NewLinkAsync(b, collection);

        await new AccountDeletionStore(NewContext()).DeleteAllDataAsync(b, $"test/blockpolicy/{b}/", DateTimeOffset.UtcNow);
        _userIds.Remove(b);

        Assert.False(await NewContext().UserBlocks.AnyAsync(block => block.BlockerUserId == b || block.BlockedUserId == b));
        Assert.Contains(a0, await LinksSeenByAsync(a, collection));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == a0 && item.DeletedAtUtc == null));
    }
}
