using System.Security.Cryptography;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.Reactions;
using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// Emoji reactions against a real SQL Server schema: who may react (the Owner and accepted members of
/// any role, nobody else), one reaction per person per link changed in place, the catalog keys only,
/// links only (never a pending proposal), the content lock respected, clean-up with the link / the
/// Collection / the Item / the account / a removed member, and counts that are read for a whole page at
/// once.
/// </summary>
public sealed class CollectionItemReactionIntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _viewer;
    private long _submitter;
    private long _contributor;
    private long _pending;
    private long _outsider;
    private long _sharedId;
    private long _item1;
    private long _item2;

    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private CollectionUnlockTokenProtector _tokens = null!;
    private CollectionCollaborationService _collaboration = null!;
    private CollectionItemReactionService _reactions = null!;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = NewContext();

        _owner = await NewUserAsync();
        _viewer = await NewUserAsync();
        _submitter = await NewUserAsync();
        _contributor = await NewUserAsync();
        _pending = await NewUserAsync();
        _outsider = await NewUserAsync();

        _collections = new CollectionStore(_db);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(_access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _reactions = new CollectionItemReactionService(_access, new CollectionItemReactionStore(_db), TimeProvider.System);

        _sharedId = (await _collections.CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await InviteAndAcceptAsync(_submitter, CollectionCollaboratorRole.Submitter);
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pending), CollectionCollaboratorRole.Viewer);

        _item1 = await NewItemAsync(_owner, "https://example.test/one");
        _item2 = await NewItemAsync(_owner, "https://example.test/two");
        await _collections.AddAsync(_owner, _sharedId, _item1, DateTimeOffset.UtcNow);
        await _collections.AddAsync(_owner, _sharedId, _item2, DateTimeOffset.UtcNow);
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

    private JupleDbContext NewContext() =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    // ---------- who may react ----------

    [Theory]
    [InlineData("owner")]
    [InlineData("viewer")]
    [InlineData("submitter")]
    [InlineData("contributor")]
    public async Task TheOwnerAndEveryAcceptedRole_MayReact(string who)
    {
        var userId = UserOf(who);

        var result = await _reactions.SetAsync(userId, _sharedId, _item1, "heart", null);

        Assert.Equal("heart", result.MyReaction);
        Assert.Equal([new ReactionCountDto("heart", 1)], result.Reactions);
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("outsider")]
    public async Task APendingInviteeAndANonMember_AreToldItDoesNotExist_ForEveryOperation(string who)
    {
        var userId = UserOf(who);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _reactions.SetAsync(userId, _sharedId, _item1, "heart", null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _reactions.DeleteAsync(userId, _sharedId, _item1, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => new GetCollectionItemsService(_access, new CollectionStore(_db), new NoImages(), new CollectionItemReactionStore(_db))
            .GetAsync(userId, _sharedId, null, 20));
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task APublicLinkHolderWhoIsNotAMember_CannotReact_EvenWhenTheLinkIsOn()
    {
        await new CollectionShareStore(_db).EnableAsync(_owner, _sharedId, "public-r30", DateTimeOffset.UtcNow, CollectionSharePermission.Write, raiseLowerRoles: true);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _reactions.SetAsync(_outsider, _sharedId, _item1, "heart", null));
    }

    // ---------- one reaction per person, changed in place ----------

    [Fact]
    public async Task OneReactionPerPerson_SameKeyIsIdempotent_AnotherKeyRewritesTheSameRow_DeleteTakesItBack()
    {
        await _reactions.SetAsync(_viewer, _sharedId, _item1, "heart", null);
        var rowId = await RowIdAsync(_viewer, _item1);

        var same = await _reactions.SetAsync(_viewer, _sharedId, _item1, "heart", null);
        Assert.Equal("heart", same.MyReaction);
        Assert.Equal(rowId, await RowIdAsync(_viewer, _item1));

        var changed = await _reactions.SetAsync(_viewer, _sharedId, _item1, "laugh", null);
        Assert.Equal("laugh", changed.MyReaction);
        Assert.Equal([new ReactionCountDto("laugh", 1)], changed.Reactions);
        Assert.Equal(rowId, await RowIdAsync(_viewer, _item1));
        Assert.Equal(1, await _db.CollectionItemReactions.CountAsync(entry => entry.UserId == _viewer && entry.ItemId == _item1));

        var removed = await _reactions.DeleteAsync(_viewer, _sharedId, _item1, null);
        Assert.Null(removed.MyReaction);
        Assert.Empty(removed.Reactions);
        // Nothing to remove is a success too.
        Assert.Empty((await _reactions.DeleteAsync(_viewer, _sharedId, _item1, null)).Reactions);
    }

    [Fact]
    public async Task TheDatabaseItselfRefusesASecondReactionOfTheSamePerson()
    {
        await _reactions.SetAsync(_viewer, _sharedId, _item1, "heart", null);

        _db.CollectionItemReactions.Add(new CollectionItemReaction(_sharedId, _item1, _viewer, "fire", DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<DbUpdateException>(() => _db.SaveChangesAsync());
        _db.ChangeTracker.Clear();
    }

    [Fact]
    public async Task OnlyCatalogKeysAreAccepted_NeverArbitraryUnicodeOrAnEmptyKey()
    {
        foreach (var bad in new[] { "❤️", "", " ", "HEART", "heart ", "notAReaction", new string('x', 40), null })
        {
            await Assert.ThrowsAsync<InvalidCollectionException>(() => _reactions.SetAsync(_viewer, _sharedId, _item1, bad, null));
        }

        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.CollectionId == _sharedId));
        // Every key of the catalog fits the column and is accepted.
        foreach (var key in CollectionReactionCatalog.Keys)
        {
            Assert.True(key.Length <= CollectionReactionCatalog.MaxKeyLength);
            Assert.Equal(key, (await _reactions.SetAsync(_viewer, _sharedId, _item1, key, null)).MyReaction);
        }
    }

    [Fact]
    public async Task TwoFastChangesOfTheSamePerson_LeaveExactlyOneRow()
    {
        await using var db1 = NewContext();
        await using var db2 = NewContext();
        // Each writer has its own context (its own connection), as two requests would.
        var first = new CollectionItemReactionService(AccessOn(db1), new CollectionItemReactionStore(db1), TimeProvider.System);
        var second = new CollectionItemReactionService(AccessOn(db2), new CollectionItemReactionStore(db2), TimeProvider.System);

        for (var round = 0; round < 5; round++)
        {
            await Task.WhenAll(
                first.SetAsync(_contributor, _sharedId, _item2, "heart", null),
                second.SetAsync(_contributor, _sharedId, _item2, "fire", null));

            Assert.Equal(1, await _db.CollectionItemReactions.CountAsync(entry => entry.UserId == _contributor && entry.ItemId == _item2));
            await _reactions.DeleteAsync(_contributor, _sharedId, _item2, null);
        }
    }

    // ---------- only links ----------

    [Fact]
    public async Task AnItemThatIsNotALinkOfTheCollection_IsNotFound()
    {
        var stranger = await NewItemAsync(_owner, "https://example.test/not-linked");

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _reactions.SetAsync(_owner, _sharedId, stranger, "heart", null));
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.ItemId == stranger));
    }

    [Fact]
    public async Task APendingProposal_CannotBeReactedTo_UntilItIsApproved()
    {
        var proposed = await NewItemAsync(_submitter, "https://example.test/proposed");
        var submissions = new CollectionLinkSubmissionStore(_db);
        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Submitted,
            await submissions.SubmitAsync(_submitter, _sharedId, proposed, null, DateTimeOffset.UtcNow));

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _reactions.SetAsync(_owner, _sharedId, proposed, "heart", null));
    }

    // ---------- the content lock ----------

    [Fact]
    public async Task ALockedCollection_NeedsItsGrant_AndTheOwnerIsNoException()
    {
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE collections.Collections SET IsLocked = 1, LockPasswordHash = {"hash"}, LockPasswordChangedAtUtc = {DateTimeOffset.UtcNow}, LockVersion = LockVersion + 1 WHERE Id = {_sharedId}");
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionLockedException>(() => _reactions.SetAsync(_owner, _sharedId, _item1, "heart", null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _reactions.DeleteAsync(_owner, _sharedId, _item1, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => new GetCollectionItemsService(_access, new CollectionStore(_db), new NoImages(), new CollectionItemReactionStore(_db))
            .GetAsync(_owner, _sharedId, null, 20));
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    // ---------- reading ----------

    [Fact]
    public async Task ThePageCarriesCountsAndMyReaction_ForEveryoneTheirOwn_NeverWhoReacted()
    {
        await _reactions.SetAsync(_owner, _sharedId, _item1, "heart", null);
        await _reactions.SetAsync(_viewer, _sharedId, _item1, "heart", null);
        await _reactions.SetAsync(_submitter, _sharedId, _item1, "heart", null);
        await _reactions.SetAsync(_contributor, _sharedId, _item1, "fire", null);
        await _reactions.SetAsync(_viewer, _sharedId, _item2, "laugh", null);

        var asViewer = await PageAsync(_viewer);
        var one = asViewer.Items.Single(entry => entry.ItemId == _item1);
        Assert.Equal([new ReactionCountDto("heart", 3), new ReactionCountDto("fire", 1)], one.Reactions);
        Assert.Equal("heart", one.MyReaction);
        var two = asViewer.Items.Single(entry => entry.ItemId == _item2);
        Assert.Equal([new ReactionCountDto("laugh", 1)], two.Reactions);
        Assert.Equal("laugh", two.MyReaction);

        var asContributor = await PageAsync(_contributor);
        Assert.Equal("fire", asContributor.Items.Single(entry => entry.ItemId == _item1).MyReaction);
        Assert.Null(asContributor.Items.Single(entry => entry.ItemId == _item2).MyReaction);
        // Counts only: the DTO has no field that could name a person.
        Assert.DoesNotContain(typeof(CollectionItemEntryDto).GetProperties(), property => property.Name.Contains("Reactor", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task EqualCounts_AreOrderedByTheCatalog()
    {
        await _reactions.SetAsync(_owner, _sharedId, _item1, "fire", null);
        await _reactions.SetAsync(_viewer, _sharedId, _item1, "thumbsUp", null);
        await _reactions.SetAsync(_submitter, _sharedId, _item1, "heart", null);

        var page = await PageAsync(_owner);

        Assert.Equal(["heart", "thumbsUp", "fire"], page.Items.Single(entry => entry.ItemId == _item1).Reactions!.Select(reaction => reaction.Key));
    }

    [Fact]
    public async Task APageOfLinksWithoutReactions_HasNone_AndTheSharedItemViewCarriesThemToo()
    {
        await _reactions.SetAsync(_owner, _sharedId, _item2, "wow", null);

        var page = await PageAsync(_viewer);
        Assert.Null(page.Items.Single(entry => entry.ItemId == _item1).Reactions);
        Assert.Null(page.Items.Single(entry => entry.ItemId == _item1).MyReaction);

        var shared = await new GetCollectionItemsService(_access, new CollectionStore(_db), new NoImages(), new CollectionItemReactionStore(_db))
            .GetItemAsync(_viewer, _sharedId, _item2);
        Assert.Equal([new ReactionCountDto("wow", 1)], shared!.Reactions);
        Assert.Null(shared.MyReaction);
    }

    [Fact]
    public async Task APageIsReadInAFixedNumberOfStatements_NotOnePerLink()
    {
        // 30 links, each with reactions from several people.
        var itemIds = new List<long>();
        for (var index = 0; index < 30; index++)
        {
            var itemId = await NewItemAsync(_owner, $"https://example.test/page/{index}");
            await _collections.AddAsync(_owner, _sharedId, itemId, DateTimeOffset.UtcNow);
            itemIds.Add(itemId);
            await _reactions.SetAsync(_owner, _sharedId, itemId, "heart", null);
            await _reactions.SetAsync(_viewer, _sharedId, itemId, "fire", null);
        }

        var commands = new CommandCounter();
        await using var counted = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).AddInterceptors(commands).Options);
        var summaries = await new CollectionItemReactionStore(counted).GetSummariesAsync(_viewer, _sharedId, itemIds);

        Assert.Equal(30, summaries.Count);
        Assert.All(summaries.Values, summary => Assert.Equal("fire", summary.MyReaction));
        // The counts and my own: two statements for the whole page.
        Assert.Equal(2, commands.Count);
    }

    // ---------- clean-up ----------

    [Fact]
    public async Task TakingTheLinkOutOfTheCollection_TakesItsReactionsWithIt()
    {
        await _reactions.SetAsync(_owner, _sharedId, _item1, "heart", null);
        await _reactions.SetAsync(_viewer, _sharedId, _item1, "fire", null);
        await _reactions.SetAsync(_viewer, _sharedId, _item2, "fire", null);

        await _collections.RemoveAsync(_owner, _sharedId, _item1);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.ItemId == _item1));
        Assert.Equal(1, await _db.CollectionItemReactions.CountAsync(entry => entry.ItemId == _item2));
    }

    [Fact]
    public async Task DeletingTheItemOrTheCollection_LeavesNoReactionBehind()
    {
        var other = (await _collections.CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var doomedItem = await NewItemAsync(_owner, "https://example.test/doomed");
        await _collections.AddAsync(_owner, other, doomedItem, DateTimeOffset.UtcNow);
        await _collections.AddAsync(_owner, _sharedId, doomedItem, DateTimeOffset.UtcNow);
        await _reactions.SetAsync(_owner, _sharedId, doomedItem, "heart", null);
        await _reactions.SetAsync(_owner, other, doomedItem, "heart", null);
        await _reactions.SetAsync(_owner, _sharedId, _item1, "heart", null);

        // The Item itself.
        await _db.Items.Where(item => item.Id == doomedItem).ExecuteDeleteAsync();
        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.ItemId == doomedItem));

        // The whole Collection (as the account deletion removes it).
        await _db.Collections.Where(collection => collection.Id == _sharedId).ExecuteDeleteAsync();
        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task RemovingAMember_RemovesTheirReactionsOnThatCollection_AndNobodyElses()
    {
        await _reactions.SetAsync(_contributor, _sharedId, _item1, "heart", null);
        await _reactions.SetAsync(_viewer, _sharedId, _item1, "heart", null);

        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, await JupleIdOfAsync(_contributor));

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.UserId == _contributor));
        Assert.Equal(1, await _db.CollectionItemReactions.CountAsync(entry => entry.UserId == _viewer));
    }

    [Fact]
    public async Task DeletingAnAccount_RemovesItsReactionsOnOtherPeoplesCollections()
    {
        await _reactions.SetAsync(_contributor, _sharedId, _item1, "heart", null);
        await _reactions.SetAsync(_viewer, _sharedId, _item1, "heart", null);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_contributor, $"test/{_contributor}/", DateTimeOffset.UtcNow);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.UserId == _contributor));
        Assert.Equal(1, await _db.CollectionItemReactions.CountAsync(entry => entry.UserId == _viewer));
        _userIds.Remove(_contributor);
    }

    [Fact]
    public async Task TheLinkMovesToAnotherCollection_ItsReactionsDoNotFollowIt()
    {
        var other = (await _collections.CreateAsync(_owner, "Elsewhere", "ELSEWHERE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await _reactions.SetAsync(_owner, _sharedId, _item1, "heart", null);

        await _collections.AddAsync(_owner, other, _item1, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        Assert.Equal(1, await _db.CollectionItemReactions.CountAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == _item1));
        Assert.Equal(0, await _db.CollectionItemReactions.CountAsync(entry => entry.CollectionId == other));
    }

    // ---------- helpers ----------

    private CollectionAccessService AccessOn(JupleDbContext db) =>
        new(new CollectionAccessStore(db), _tokens, TimeProvider.System);

    private long UserOf(string who) => who switch
    {
        "owner" => _owner,
        "viewer" => _viewer,
        "submitter" => _submitter,
        "contributor" => _contributor,
        "pending" => _pending,
        _ => _outsider,
    };

    private Task<CollectionItemPage> PageAsync(long userId) =>
        new GetCollectionItemsService(_access, new CollectionStore(_db), new NoImages(), new CollectionItemReactionStore(_db))
            .GetAsync(userId, _sharedId, null, 50);

    private async Task<long> RowIdAsync(long userId, long itemId) =>
        await _db.CollectionItemReactions.AsNoTracking().Where(entry => entry.UserId == userId && entry.ItemId == itemId && entry.CollectionId == _sharedId).Select(entry => entry.Id).SingleAsync();

    private async Task InviteAndAcceptAsync(long inviteeId, CollectionCollaboratorRole role)
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(inviteeId), role);
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
        _db.ChangeTracker.Clear();
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private sealed class CommandCounter : Microsoft.EntityFrameworkCore.Diagnostics.DbCommandInterceptor
    {
        public int Count { get; private set; }

        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command,
            Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Count++;
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    private sealed class NoImages : Juple.Application.Images.IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"users/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(null);
    }
}
