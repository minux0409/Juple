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
/// What a block does inside a shared Collection, against the real schema: links that were already there stay visible to both people, links
/// either of them adds AFTER the block are hidden from the other one (list, search, counts, detail, comments, hearts), nothing is deleted
/// or removed, unblocking shows everything again, and the anonymous public link is outside the rule.
/// </summary>
public sealed class BlockedSharedContentIntegrationTests : IAsyncLifetime
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
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/blockedcontent/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/blockedcontent/%'");
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
        // A real pause between the steps keeps "before the block" and "after the block" apart on the database clock.
        await Task.Delay(40);
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

    [Fact]
    public async Task NewLinksAfterABlock_AreHiddenBothWays_ExistingOnesStay_AndUnblockingRestoresEverything()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var (c, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(a, b, c);
        var a0 = await NewLinkAsync(a, collection);
        var b0 = await NewLinkAsync(b, collection);

        await Task.Delay(40);
        await Blocks().BlockAsync(a, bCode);
        var a1 = await NewLinkAsync(a, collection);
        var b1 = await NewLinkAsync(b, collection);

        // Before-the-block links are visible to both; each side's new link is hidden from the other; a third person sees all four.
        Assert.Equivalent(new[] { a0, b0, a1 }, await LinksSeenByAsync(a, collection));
        Assert.Equivalent(new[] { a0, b0, b1 }, await LinksSeenByAsync(b, collection));
        Assert.Equivalent(new[] { a0, b0, a1, b1 }, await LinksSeenByAsync(c, collection));

        // Counts agree with the lists (card count and the date-range count).
        Assert.Equal(3, await CardCountAsync(a, collection));
        Assert.Equal(3, await CardCountAsync(b, collection));
        Assert.Equal(4, await CardCountAsync(c, collection));
        Assert.Equal(3, await RangeCountAsync(a, collection));
        Assert.Equal(3, await RangeCountAsync(b, collection));
        Assert.Equal(4, await RangeCountAsync(c, collection));

        // Detail, and a search that would match the hidden link, never reach it.
        Assert.Null(await new CollectionStore(NewContext()).GetSharedItemAsync(a, collection, b1));
        Assert.Null(await new CollectionStore(NewContext()).GetSharedItemAsync(b, collection, a1));
        Assert.NotNull(await new CollectionStore(NewContext()).GetSharedItemAsync(a, collection, b0));
        Assert.NotNull(await new CollectionStore(NewContext()).GetSharedItemAsync(c, collection, b1));
        var search = await new CollectionStore(NewContext()).SearchItemsAsync(a, collection, "%example.test%", null, 100, CollectionItemSort.DateDesc);
        Assert.DoesNotContain(search.Page.Items, entry => entry.ItemId == b1);

        // Nothing was deleted or removed.
        Assert.Equal(4, await NewContext().CollectionItems.CountAsync(membership => membership.CollectionId == collection));
        Assert.Equal(2, await NewContext().CollectionCollaborators.CountAsync(member => member.CollectionId == collection));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == b1 && item.DeletedAtUtc == null));

        // Unblocking restores the normal access rules.
        await Blocks().UnblockAsync(a, bCode);
        Assert.Equivalent(new[] { a0, b0, a1, b1 }, await LinksSeenByAsync(a, collection));
        Assert.Equivalent(new[] { a0, b0, a1, b1 }, await LinksSeenByAsync(b, collection));
        Assert.Equal(4, await CardCountAsync(a, collection));
        Assert.Equal(4, await RangeCountAsync(b, collection));
    }

    [Fact]
    public async Task Interactions_OnAHiddenLinkAreRefused_AndBetweenBlockedPeopleRaiseTheBlockError()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var (c, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(a, b, c);
        var b0 = await NewLinkAsync(b, collection);
        var a0 = await NewLinkAsync(a, collection);
        await Task.Delay(40);
        await Blocks().BlockAsync(a, bCode);
        var b1 = await NewLinkAsync(b, collection);
        var a1 = await NewLinkAsync(a, collection);

        // A hidden link takes no comment and no heart, and its thread is not served.
        Assert.Null(await new CollectionItemCommentStore(NewContext()).CreateAsync(a, collection, b1, "hi", DateTimeOffset.UtcNow));
        Assert.Null(await new CollectionItemCommentStore(NewContext()).GetPageAsync(a, collection, b1, null, 20));
        Assert.Equal(CollectionReactionWrite.NotALink, await new CollectionItemReactionStore(NewContext()).SetAsync(a, collection, b1, "heart", DateTimeOffset.UtcNow));

        // A link that was already there is still readable, but A cannot start an interaction with B on it (and B is not told why).
        Assert.NotNull(await new CollectionItemCommentStore(NewContext()).GetPageAsync(a, collection, b0, null, 20));
        await Assert.ThrowsAsync<UserBlockedException>(() => new CollectionItemCommentStore(NewContext()).CreateAsync(a, collection, b0, "hi", DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<UserBlockedException>(() => new CollectionItemReactionStore(NewContext()).SetAsync(a, collection, b0, "heart", DateTimeOffset.UtcNow));
        // B reacting to A's link: the one from before the block is still B's to see, so the block (not "no such link") is the answer, and it
        // does not say who blocked whom; the one A added after the block is simply not there for B.
        Assert.Equal(CollectionReactionWrite.NotALink, await new CollectionItemReactionStore(NewContext()).SetAsync(b, collection, a1, "heart", DateTimeOffset.UtcNow));
        var blockedSide = await Assert.ThrowsAsync<UserBlockedException>(() => new CollectionItemReactionStore(NewContext()).SetAsync(b, collection, a0, "heart", DateTimeOffset.UtcNow));
        Assert.False(blockedSide.BlockedByCaller);

        // A third person comments on B's visible link: A does not see B's words; B's own and C's are unaffected.
        var comment = await new CollectionItemCommentStore(NewContext()).CreateAsync(b, collection, b0, "from b", DateTimeOffset.UtcNow);
        Assert.NotNull(comment);
        Assert.Equal(0, (await new CollectionItemCommentStore(NewContext()).GetPageAsync(a, collection, b0, null, 20))!.TotalCount);
        Assert.Equal(1, (await new CollectionItemCommentStore(NewContext()).GetPageAsync(c, collection, b0, null, 20))!.TotalCount);
    }

    [Fact]
    public async Task FriendRequestsInvitationsAndProposals_AreRefusedAcrossABlock_AndDoubleBlockingIsHarmless()
    {
        var (a, aCode) = await NewUserAsync();
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
        _ = aCode;
    }

    [Fact]
    public async Task PublicLink_IsAnonymous_SoABlockDoesNotChangeWhatItShows()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(a, b);
        await NewLinkAsync(a, collection);
        await Task.Delay(40);
        await Blocks().BlockAsync(a, bCode);
        await NewLinkAsync(a, collection);
        await NewLinkAsync(b, collection);

        await _db.CollectionShares.Where(share => share.CollectionId == collection).ExecuteUpdateAsync(setters => setters.SetProperty(share => share.IsPublic, true));
        var publicId = await _db.CollectionShares.Where(share => share.CollectionId == collection).Select(share => share.PublicId).FirstAsync();

        // The documented limit: an anonymous reader has no identity to compare, so a block changes nothing there. (The public link only ever
        // publishes the Owner's own links and links added through a writable public link - never a member's.)
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

        await new AccountDeletionStore(NewContext()).DeleteAllDataAsync(b, $"test/blockedcontent/{b}/", DateTimeOffset.UtcNow);
        _userIds.Remove(b);

        Assert.False(await NewContext().UserBlocks.AnyAsync(block => block.BlockerUserId == b || block.BlockedUserId == b));
        Assert.Contains(a0, await LinksSeenByAsync(a, collection));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == a0 && item.DeletedAtUtc == null));
    }
}
