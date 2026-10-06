using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.UrlMetadata;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Items;

/// <summary>
/// The 링크 저장 screen's one save (POST inbox with collectionIds) against the real schema: ONE Item with a membership in
/// every chosen Collection (never a copy per Collection), [] = no Collection, a 승인 후 추가 Collection gets a proposal, every
/// destination is checked before anything is written (one that is not writable / locked without its own grant fails the
/// whole save with no Item and no membership), and a retry with the same clientRequestId converges on the same Item.
/// </summary>
public sealed class SaveLinkToCollectionsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private CollectionUnlockTokenProtector _tokens = null!;
    private CollectionCollaborationService _collaboration = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _friend;
    private long _stranger;

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
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(_access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _owner = await NewUserAsync();
        _friend = await NewUserAsync();
        _stranger = await NewUserAsync();
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

    private SaveInboxEntryToCollectionsService Service()
    {
        _db.ChangeTracker.Clear();
        return new SaveInboxEntryToCollectionsService(
            new InboxEntrySaveService(new ItemStore(_db), TimeProvider.System, new NoMetadata(), new NoShareUrls()),
            _access,
            _collections,
            new CollectionWriteTransactions(_db),
            TimeProvider.System,
            new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance),
            new CollectionLinkSubmissionStore(_db));
    }

    private async Task<long> NewCollectionAsync(long ownerId, string name) =>
        (await _collections.CreateAsync(ownerId, name, name.ToUpperInvariant(), CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

    private Task<int> ItemCountAsync(string url) =>
        _db.Items.AsNoTracking().CountAsync(item => item.UserId == _owner && item.Url == url);

    private Task<List<long>> MembershipsOfAsync(long itemId) =>
        _db.CollectionItems.AsNoTracking().Where(membership => membership.ItemId == itemId).Select(membership => membership.CollectionId).OrderBy(id => id).ToListAsync();

    [Fact]
    public async Task ManyCollections_OneItem_OneMembershipEach_AndOneNewLinkEventPerCollection()
    {
        var a = await NewCollectionAsync(_owner, "A");
        var b = await NewCollectionAsync(_owner, "B");
        var c = await NewCollectionAsync(_owner, "C");

        var result = await Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/many", Guid.NewGuid()), [a, b, c, b], null);
        _db.ChangeTracker.Clear();

        Assert.True(result.Save.Created);
        Assert.Equal(new SaveInboxEntryCollectionsOutcome(3, 0, 0, 0), result.Collections);
        Assert.Equal(1, await ItemCountAsync("https://example.test/many")); // never a copy per Collection
        Assert.Equal(new[] { a, b, c }.OrderBy(id => id).ToList(), await MembershipsOfAsync(result.Save.Entry.Id));
    }

    [Fact]
    public async Task NoCollection_IsAnExplicitEmptyList_ThatSavesOnlyTheLink()
    {
        var result = await Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/none", Guid.NewGuid()), [], null);
        _db.ChangeTracker.Clear();

        Assert.Equal(new SaveInboxEntryCollectionsOutcome(0, 0, 0, 0), result.Collections);
        Assert.Equal(1, await ItemCountAsync("https://example.test/none"));
        Assert.Empty(await MembershipsOfAsync(result.Save.Entry.Id));
    }

    [Fact]
    public async Task AnUnwritableDestination_FailsTheWholeSave_BeforeAnythingIsWritten()
    {
        var mine = await NewCollectionAsync(_owner, "Mine");
        var someoneElses = await NewCollectionAsync(_stranger, "Theirs");

        await Assert.ThrowsAsync<CollectionNotFoundException>(() =>
            Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/foreign", Guid.NewGuid()), [mine, someoneElses], null));
        _db.ChangeTracker.Clear();

        // No Item, no membership in the writable one either - never an unexpected partial set.
        Assert.Equal(0, await ItemCountAsync("https://example.test/foreign"));
        Assert.False(await _db.CollectionItems.AnyAsync(membership => membership.CollectionId == mine));
    }

    [Fact]
    public async Task AViewOnlySharedCollection_IsRefused_WithNothingWritten()
    {
        var mine = await NewCollectionAsync(_owner, "Mine");
        var friends = await NewCollectionAsync(_friend, "Friends");
        await JoinAsync(friends, _friend, _owner, CollectionCollaboratorRole.Viewer);

        await Assert.ThrowsAsync<CollectionForbiddenException>(() =>
            Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/viewer", Guid.NewGuid()), [mine, friends], null));
        _db.ChangeTracker.Clear();

        Assert.Equal(0, await ItemCountAsync("https://example.test/viewer"));
    }

    [Fact]
    public async Task ALockedDestination_NeedsItsOwnGrant_TheGrantOfAnotherCollectionDoesNotOpenIt()
    {
        var open = await NewCollectionAsync(_owner, "Open");
        var lockedA = await NewCollectionAsync(_owner, "LockedA");
        var lockedB = await NewCollectionAsync(_owner, "LockedB");
        await new CollectionLockStore(_db).LockAsync(lockedA, DateTimeOffset.UtcNow);
        await new CollectionLockStore(_db).LockAsync(lockedB, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        var grantA = await GrantAsync(lockedA);

        // A's grant does not open B: refused, nothing written.
        await Assert.ThrowsAsync<CollectionLockedException>(() =>
            Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/locked", Guid.NewGuid()), [open, lockedA, lockedB],
                new Dictionary<long, string> { [lockedA] = grantA, [lockedB] = grantA }));
        _db.ChangeTracker.Clear();
        Assert.Equal(0, await ItemCountAsync("https://example.test/locked"));

        // Each locked Collection with its own grant: saved into all three.
        var grantB = await GrantAsync(lockedB);
        var result = await Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/locked", Guid.NewGuid()), [open, lockedA, lockedB],
            new Dictionary<long, string> { [lockedA] = grantA, [lockedB] = grantB });
        _db.ChangeTracker.Clear();
        Assert.Equal(3, result.Collections.Added);
        Assert.Equal(3, (await MembershipsOfAsync(result.Save.Entry.Id)).Count);
    }

    [Fact]
    public async Task ASubmitterDestination_GetsAProposal_NextToADirectAdd_InTheSameSave()
    {
        var mine = await NewCollectionAsync(_owner, "Mine");
        var approval = await NewCollectionAsync(_friend, "Approval");
        await JoinAsync(approval, _friend, _owner, CollectionCollaboratorRole.Submitter);

        var result = await Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/proposed", Guid.NewGuid()), [mine, approval], null);
        _db.ChangeTracker.Clear();

        Assert.Equal(new SaveInboxEntryCollectionsOutcome(1, 1, 0, 0), result.Collections);
        Assert.Equal([mine], await MembershipsOfAsync(result.Save.Entry.Id)); // the proposal is not a link yet
        Assert.True(await _db.CollectionLinkSubmissions.AnyAsync(submission => submission.CollectionId == approval && submission.ItemId == result.Save.Entry.Id));
        Assert.True(await _db.NotificationEvents.AnyAsync(entry => entry.Type == NotificationType.CollectionLinkSubmissionReceived && entry.CollectionId == approval));
    }

    [Fact]
    public async Task ARetryWithTheSameClientRequestId_ReplaysTheItem_AndConverges()
    {
        var a = await NewCollectionAsync(_owner, "A");
        var b = await NewCollectionAsync(_owner, "B");
        var requestId = Guid.NewGuid();

        var first = await Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/retry", requestId), [a], null);
        var retry = await Service().SaveAsync(_owner, new SaveInboxEntryCommand("https://example.test/retry", requestId), [a, b], null);
        _db.ChangeTracker.Clear();

        Assert.False(retry.Save.Created);
        Assert.Equal(first.Save.Entry.Id, retry.Save.Entry.Id);
        Assert.Equal(new SaveInboxEntryCollectionsOutcome(1, 0, 1, 0), retry.Collections);
        Assert.Equal(1, await ItemCountAsync("https://example.test/retry"));
        Assert.Equal(new[] { a, b }.OrderBy(id => id).ToList(), await MembershipsOfAsync(first.Save.Entry.Id));
    }

    private async Task<string> GrantAsync(long collectionId)
    {
        var version = await _db.Collections.AsNoTracking().Where(collection => collection.Id == collectionId).Select(collection => collection.LockVersion).SingleAsync();
        return _tokens.Issue(collectionId, CollectionUnlockSubject.ForUser(_owner), version, DateTimeOffset.UtcNow).Token;
    }

    private async Task JoinAsync(long collectionId, long ownerId, long memberId, CollectionCollaboratorRole role)
    {
        var code = await _db.Users.AsNoTracking().Where(user => user.Id == memberId).Select(user => user.PublicCode).SingleAsync();
        var invitation = await _collaboration.InviteAsync(ownerId, collectionId, code, role);
        await _collaboration.AcceptInvitationAsync(memberId, invitation.InvitationId);
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

    private sealed class NoShareUrls : ICollectionShareUrlDetector
    {
        public string? FindPublicId(string? url) => null;
    }

    private sealed class NoMetadata : IUrlMetadataResolver
    {
        public Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default) =>
            Task.FromResult(new UrlMetadataResult(null, null, null));
    }
}
