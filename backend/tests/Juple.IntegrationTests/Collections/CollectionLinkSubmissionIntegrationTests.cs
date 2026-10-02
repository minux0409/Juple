using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.Submissions;
using Juple.Application.Items;
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
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// 승인 후 추가 against a real SQL Server schema: who adds directly and who only proposes (members by
/// role, public-link holders by the link's permission), proposals kept apart from the Collection's
/// links until the Owner approves (then exactly an ordinary link of the proposer's Item) or rejects
/// them, one proposal per link, nothing processed automatically, and the three-level minimum rule
/// between the public link and specific people.
/// </summary>
public sealed class CollectionLinkSubmissionIntegrationTests : IAsyncLifetime
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

    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private CollectionCollaborationService _collaboration = null!;
    private EnableCollectionShareService _shares = null!;
    private CollectionUnlockTokenProtector _tokens = null!;

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
        _shares = new EnableCollectionShareService(new CollectionShareStore(_db), TimeProvider.System);

        _sharedId = (await _collections.CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await InviteAndAcceptAsync(_submitter, CollectionCollaboratorRole.Submitter);
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pending), CollectionCollaboratorRole.Viewer);
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

    private JupleDbContext NewContext(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).AddInterceptors(interceptors).Options);

    private AddItemToCollectionService Add(JupleDbContext? db = null)
    {
        db ??= _db;
        var collections = new CollectionStore(db);
        return new AddItemToCollectionService(
            new CollectionAccessService(new CollectionAccessStore(db), _tokens, TimeProvider.System),
            collections,
            TimeProvider.System,
            new SocialNotificationPublisher(db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance),
            new CollectionLinkSubmissionStore(db));
    }

    private PublicCollectionWriteService PublicAdd() =>
        new(new PublicCollectionStore(_db), _collections, _tokens, TimeProvider.System,
            new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance),
            new CollectionLinkSubmissionStore(_db));

    private CollectionLinkSubmissionService Review(JupleDbContext? db = null)
    {
        db ??= _db;
        return new CollectionLinkSubmissionService(
            new CollectionAccessService(new CollectionAccessStore(db), _tokens, TimeProvider.System),
            new CollectionLinkSubmissionStore(db),
            TimeProvider.System,
            new SocialNotificationPublisher(db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance));
    }

    // ---------- who adds, who proposes ----------

    [Fact]
    public async Task ByRole_TheOwnerAndAContributorAdd_ASubmitterProposes_AViewerDoesNeither()
    {
        var ownerItem = await NewItemAsync(_owner, "https://example.test/owner");
        var contributorItem = await NewItemAsync(_contributor, "https://example.test/contributor");
        var submitterItem = await NewItemAsync(_submitter, "https://example.test/proposed");
        var viewerItem = await NewItemAsync(_viewer, "https://example.test/viewer");

        Assert.Equal(CollectionLinkAddOutcome.Added, await Add().AddAsync(_owner, _sharedId, ownerItem));
        Assert.Equal(CollectionLinkAddOutcome.Added, await Add().AddAsync(_contributor, _sharedId, contributorItem));
        Assert.Equal(CollectionLinkAddOutcome.Submitted, await Add().AddAsync(_submitter, _sharedId, submitterItem));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Add().AddAsync(_viewer, _sharedId, viewerItem));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Add().AddAsync(_pending, _sharedId, viewerItem));
        _db.ChangeTracker.Clear();

        // The proposal is not a link: not in the list, not counted - only the Owner sees it waiting.
        Assert.False(await LinkedAsync(submitterItem));
        Assert.Equal(2, await LinkCountAsync());
        var ownerView = await _collections.GetAsync(_owner, _sharedId);
        Assert.Equal(2, ownerView.ItemCount);
        Assert.Equal(1, ownerView.PendingSubmissionCount);
        Assert.Equal(0, (await _collections.GetAsync(_submitter, _sharedId)).PendingSubmissionCount);
        Assert.Equal(CollectionDtoAccessRoles.Submitter, (await _collections.GetAsync(_submitter, _sharedId)).AccessRole);
        Assert.DoesNotContain((await new Juple.Application.Collections.GetCollectionItems.GetCollectionItemsService(_access, _collections, new NoImages())
            .GetAsync(_submitter, _sharedId, null, 50)).Items, entry => entry.ItemId == submitterItem);

        // A proposal tells nobody about a new link.
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.Type == NotificationType.CollectionItemsAdded && entry.ActorUserId == _submitter));
    }

    [Fact]
    public async Task ByPublicLink_Read_Refuses_Submit_Proposes_Write_Adds()
    {
        var outsiderItem = await NewItemAsync(_outsider, "https://example.test/outsider");
        // The public link's level must not be above any member's: lift everyone to Contributor first.
        await RaiseEveryoneAsync(CollectionCollaboratorRole.Contributor);

        var share = await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Read);
        await Assert.ThrowsAsync<PublicShareReadOnlyException>(() => PublicAdd().AddItemAsync(_outsider, share.PublicId, outsiderItem, null));

        await _shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Submit);
        Assert.Equal(CollectionLinkAddOutcome.Submitted, await PublicAdd().AddItemAsync(_outsider, share.PublicId, outsiderItem, null));
        _db.ChangeTracker.Clear();
        Assert.False(await LinkedAsync(outsiderItem));
        var proposal = Assert.Single((await Review().ListAsync(_owner, _sharedId, null, 50, null)).Items);
        // Someone who proposed through the public link is never named - not even to the Owner.
        Assert.True(proposal.ViaPublicShare);
        Assert.Null(proposal.Proposer);

        await _shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Write);
        var directItem = await NewItemAsync(_outsider, "https://example.test/outsider-direct");
        Assert.Equal(CollectionLinkAddOutcome.Added, await PublicAdd().AddItemAsync(_outsider, share.PublicId, directItem, null));
    }

    [Fact]
    public async Task TheOwner_NeverProposes_EvenThroughTheirOwnPublicLinkThatTakesProposals()
    {
        await RaiseEveryoneAsync(CollectionCollaboratorRole.Submitter);
        var share = await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Submit);
        var ownerItem = await NewItemAsync(_owner, "https://example.test/owner-public");

        Assert.Equal(CollectionLinkAddOutcome.Added, await PublicAdd().AddItemAsync(_owner, share.PublicId, ownerItem, null));
        _db.ChangeTracker.Clear();

        Assert.True(await LinkedAsync(ownerItem));
        Assert.False(await _db.CollectionLinkSubmissions.AnyAsync(entry => entry.CollectionId == _sharedId));
    }

    // ---------- my own waiting proposals ----------

    [Fact]
    public async Task MyPending_ASubmitterSeesOnlyTheirOwn_WithACount_NeverTheOwnersOrAnotherSubmitters()
    {
        await InviteAndAcceptAsync(_outsider, CollectionCollaboratorRole.Submitter);
        var mine = await NewItemAsync(_submitter, "https://example.test/mine");
        var theirs = await NewItemAsync(_outsider, "https://example.test/theirs");
        await Add().AddAsync(_submitter, _sharedId, mine);
        await Add().AddAsync(_outsider, _sharedId, theirs);
        _db.ChangeTracker.Clear();

        var page = await Review().ListMineAsync(_submitter, _sharedId, null, 50, null);
        var own = Assert.Single(page.Items);
        Assert.Equal("https://example.test/mine", own.Url);
        Assert.Null(page.NextCursor);
        // The two numbers are different things: the Owner's queue (2) and the submitter's own (1).
        Assert.Equal(1, (await _collections.GetAsync(_submitter, _sharedId)).MyPendingSubmissionCount);
        Assert.Equal(0, (await _collections.GetAsync(_submitter, _sharedId)).PendingSubmissionCount);
        var ownerView = await _collections.GetAsync(_owner, _sharedId);
        Assert.Equal(2, ownerView.PendingSubmissionCount);
        Assert.Equal(0, ownerView.MyPendingSubmissionCount);
        Assert.Equal("https://example.test/theirs", Assert.Single((await Review().ListMineAsync(_outsider, _sharedId, null, 50, null)).Items).Url);
    }

    [Fact]
    public async Task MyPending_TheCollectionsListCarriesTheCount_WithoutAnyPerCardRequest()
    {
        var mine = await NewItemAsync(_submitter, "https://example.test/list-mine");
        var other = await NewItemAsync(_contributor, "https://example.test/list-other");
        await Add().AddAsync(_submitter, _sharedId, mine);
        await Add().AddAsync(_contributor, _sharedId, other);
        var second = (await _collections.CreateAsync(_owner, "Second", "SECOND", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();

        var counter = new CommandCounter();
        await using var counted = NewContext(counter);
        var store = new CollectionStore(counted);
        counter.Reset();
        var asSubmitter = await store.ListByScopeAsync(_submitter, Juple.Application.Collections.ListCollections.CollectionListScope.Shared, null, null, null, 50);
        var queriesFor = counter.Count;

        Assert.Equal(1, asSubmitter.Items.Single(entry => entry.Id == _sharedId).MyPendingSubmissionCount);
        // The Owner's own list never carries it (their number is PendingSubmissionCount).
        var asOwner = await store.ListByScopeAsync(_owner, Juple.Application.Collections.ListCollections.CollectionListScope.Shared, null, null, null, 50);
        Assert.All(asOwner.Items, entry => Assert.Equal(0, entry.MyPendingSubmissionCount));
        Assert.Equal(1, asOwner.Items.Single(entry => entry.Id == _sharedId).PendingSubmissionCount);
        // A few statements for the whole page, not one per card.
        Assert.InRange(queriesFor, 1, 6);
        Assert.NotEqual(0, second);
    }

    [Fact]
    public async Task MyPending_TheSharedTabTotal_SumsAllMyCollections_NotOthers_NotNonMemberPublicOnes_InOneQuery()
    {
        // A second Collection of the same Owner, where the same submitter is also a member.
        var second = (await _collections.CreateAsync(_owner, "Second", "SECOND", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await _collaboration.InviteAsync(_owner, second, await JupleIdOfAsync(_submitter), CollectionCollaboratorRole.Submitter);
        var invitation = await _db.CollectionInvitations.AsNoTracking().Where(entry => entry.CollectionId == second).Select(entry => entry.Id).SingleAsync();
        await _collaboration.AcceptInvitationAsync(_submitter, invitation);
        // A third one where they are not a member at all (only a public link) - never counted.
        var third = (await _collections.CreateAsync(_owner, "Third", "THIRD", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();

        foreach (var (collectionId, url) in new[] { (_sharedId, "https://example.test/t1"), (_sharedId, "https://example.test/t2"), (second, "https://example.test/t3") })
        {
            await Add().AddAsync(_submitter, collectionId, await NewItemAsync(_submitter, url));
        }

        var shareThird = await _shares.EnableAsync(_owner, third, CollectionSharePermission.Submit);
        await PublicAdd().AddItemAsync(_submitter, shareThird.PublicId, await NewItemAsync(_submitter, "https://example.test/t4"), null);
        // Someone else's proposal in the same Collections.
        await InviteAndAcceptAsync(_outsider, CollectionCollaboratorRole.Submitter);
        await Add().AddAsync(_outsider, _sharedId, await NewItemAsync(_outsider, "https://example.test/not-mine"));
        _db.ChangeTracker.Clear();

        var counter = new CommandCounter();
        await using var counted = NewContext(counter);
        var store = new CollectionLinkSubmissionStore(counted);
        counter.Reset();
        var total = await store.CountMineInSharedCollectionsAsync(_submitter);

        Assert.Equal(3, total);
        Assert.Equal(1, counter.Count);
        Assert.Equal(1, await store.CountMineInSharedCollectionsAsync(_outsider));
        // The Owner's own approval queue is not "mine": they never propose.
        Assert.Equal(0, await store.CountMineInSharedCollectionsAsync(_owner));

        // Approved / declined ones leave the total.
        var queue = (await Review().ListAsync(_owner, _sharedId, null, 50, null)).Items;
        await Review().ApproveAsync(_owner, _sharedId, queue.First(entry => entry.Url.EndsWith("/t1", StringComparison.Ordinal)).SubmissionId, null);
        _db.ChangeTracker.Clear();
        Assert.Equal(2, await new CollectionLinkSubmissionStore(counted).CountMineInSharedCollectionsAsync(_submitter));
    }

    [Fact]
    public async Task MyPending_TheFilter_ListsOnlyMemberCollectionsWithMyOwnWaitingLinks_PagedAndBounded()
    {
        // Three more Collections of the same Owner: A and B where the submitter proposes (2 + 1 links), C where
        // they are a member with nothing waiting, D where only someone else proposes, E deleted, F public-link only.
        async Task<long> MakeAsync(string name, bool member)
        {
            var id = (await _collections.CreateAsync(_owner, name, name.ToUpperInvariant(), CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
            if (member)
            {
                var invitation = await _collaboration.InviteAsync(_owner, id, await JupleIdOfAsync(_submitter), CollectionCollaboratorRole.Submitter);
                await _collaboration.AcceptInvitationAsync(_submitter, invitation.InvitationId);
            }

            _db.ChangeTracker.Clear();
            return id;
        }

        var a = await MakeAsync("A", member: true);
        var b = await MakeAsync("B", member: true);
        var c = await MakeAsync("C", member: true);
        var d = await MakeAsync("D", member: true);
        var e = await MakeAsync("E", member: true);
        var f = await MakeAsync("F", member: false);
        await InviteAndAcceptAsync(_outsider, CollectionCollaboratorRole.Submitter);

        async Task ProposeAsync(long who, long collectionId, string url) => await Add().AddAsync(who, collectionId, await NewItemAsync(who, url));
        await ProposeAsync(_submitter, a, "https://example.test/fa1");
        await ProposeAsync(_submitter, a, "https://example.test/fa2");
        await ProposeAsync(_submitter, b, "https://example.test/fb1");
        await ProposeAsync(_submitter, e, "https://example.test/fe1");
        await ProposeAsync(_submitter, _sharedId, "https://example.test/fshared");
        // D: another member's proposal only (the submitter has none there).
        var invitationD = await _collaboration.InviteAsync(_owner, d, await JupleIdOfAsync(_outsider), CollectionCollaboratorRole.Submitter);
        await _collaboration.AcceptInvitationAsync(_outsider, invitationD.InvitationId);
        _db.ChangeTracker.Clear();
        await ProposeAsync(_outsider, d, "https://example.test/fd-other");
        // F: only a public link, no membership.
        var shareF = await _shares.EnableAsync(_owner, f, CollectionSharePermission.Submit);
        await PublicAdd().AddItemAsync(_submitter, shareF.PublicId, await NewItemAsync(_submitter, "https://example.test/ff"), null);
        // E is deleted afterwards.
        await new CollectionStore(_db).DeleteAsync(_owner, e);
        _db.ChangeTracker.Clear();

        var counter = new CommandCounter();
        await using var counted = NewContext(counter);
        var store = new CollectionStore(counted);
        counter.Reset();
        var all = await store.ListByScopeAsync(_submitter, Juple.Application.Collections.ListCollections.CollectionListScope.MyPending, null, null, null, 50);
        var queries = counter.Count;

        // Only A, B and the first shared Collection (all member + own waiting, not deleted); never C, D, E or F.
        Assert.Equal(new[] { a, b, _sharedId }.OrderByDescending(id => id), all.Items.Select(entry => entry.Id));
        Assert.Equal(2, all.Items.Single(entry => entry.Id == a).MyPendingSubmissionCount);
        Assert.Equal(1, all.Items.Single(entry => entry.Id == b).MyPendingSubmissionCount);
        Assert.Equal(1, all.Items.Single(entry => entry.Id == _sharedId).MyPendingSubmissionCount);
        // The same rows through the count endpoint's rule: total LINKS (4), not Collections (3).
        Assert.Equal(4, await new CollectionLinkSubmissionStore(counted).CountMineInSharedCollectionsAsync(_submitter));
        Assert.InRange(queries, 1, 6);

        // Paged like every other scope (cursor, newest first).
        var first = await store.ListByScopeAsync(_submitter, Juple.Application.Collections.ListCollections.CollectionListScope.MyPending, null, null, null, 2);
        Assert.Equal(2, first.Items.Count);
        Assert.NotNull(first.NextCursor);
        var second = await store.ListByScopeAsync(_submitter, Juple.Application.Collections.ListCollections.CollectionListScope.MyPending, null, null, first.NextCursor, 2);
        Assert.Single(second.Items);
        Assert.Null(second.NextCursor);

        // Someone with no proposals gets an empty list; the Owner never has "my" pending; other scopes are unchanged.
        Assert.Empty((await store.ListByScopeAsync(_contributor, Juple.Application.Collections.ListCollections.CollectionListScope.MyPending, null, null, null, 50)).Items);
        Assert.Empty((await store.ListByScopeAsync(_owner, Juple.Application.Collections.ListCollections.CollectionListScope.MyPending, null, null, null, 50)).Items);
        var shared = await store.ListByScopeAsync(_submitter, Juple.Application.Collections.ListCollections.CollectionListScope.Shared, null, null, null, 50);
        Assert.Contains(shared.Items, entry => entry.Id == c);
        Assert.DoesNotContain(shared.Items, entry => entry.Id == e);

        // An approval leaves the filter once nothing of theirs waits in that Collection.
        var queue = (await Review().ListAsync(_owner, b, null, 50, null)).Items;
        await Review().ApproveAsync(_owner, b, queue.Single().SubmissionId, null);
        _db.ChangeTracker.Clear();
        var after = await new CollectionStore(counted).ListByScopeAsync(_submitter, Juple.Application.Collections.ListCollections.CollectionListScope.MyPending, null, null, null, 50);
        Assert.DoesNotContain(after.Items, entry => entry.Id == b);
        Assert.Equal(3, await new CollectionLinkSubmissionStore(counted).CountMineInSharedCollectionsAsync(_submitter));
    }

    [Fact]
    public async Task MyPending_OnlyAMemberWhoMaySubmitCanAsk_NobodyElse()
    {
        // The Owner adds directly (and has the approval list): their own list is simply always empty. A
        // Contributor/Viewer never proposes, a person with only a pending invitation and a stranger are
        // not members at all.
        Assert.Empty((await Review().ListMineAsync(_owner, _sharedId, null, 50, null)).Items);
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Review().ListMineAsync(_contributor, _sharedId, null, 50, null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Review().ListMineAsync(_viewer, _sharedId, null, 50, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Review().ListMineAsync(_pending, _sharedId, null, 50, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Review().ListMineAsync(_outsider, _sharedId, null, 50, null));
    }

    [Fact]
    public async Task MyPending_LeavesTheListAndTheCount_WhenApprovedOrRejected_AndPagesNewestFirst()
    {
        var first = await NewItemAsync(_submitter, "https://example.test/p1");
        var second = await NewItemAsync(_submitter, "https://example.test/p2");
        var third = await NewItemAsync(_submitter, "https://example.test/p3");
        foreach (var itemId in new[] { first, second, third })
        {
            await Add().AddAsync(_submitter, _sharedId, itemId);
        }

        _db.ChangeTracker.Clear();
        var pageOne = await Review().ListMineAsync(_submitter, _sharedId, null, 2, null);
        Assert.Equal(["https://example.test/p3", "https://example.test/p2"], pageOne.Items.Select(entry => entry.Url));
        Assert.NotNull(pageOne.NextCursor);
        var pageTwo = await Review().ListMineAsync(_submitter, _sharedId, pageOne.NextCursor, 2, null);
        Assert.Equal(["https://example.test/p1"], pageTwo.Items.Select(entry => entry.Url));
        Assert.Null(pageTwo.NextCursor);
        Assert.Equal(3, (await _collections.GetAsync(_submitter, _sharedId)).MyPendingSubmissionCount);

        var waiting = (await Review().ListAsync(_owner, _sharedId, null, 50, null)).Items;
        await Review().ApproveAsync(_owner, _sharedId, waiting[0].SubmissionId, null);
        await Review().RejectAsync(_owner, _sharedId, waiting[1].SubmissionId, null);
        _db.ChangeTracker.Clear();

        var left = Assert.Single((await Review().ListMineAsync(_submitter, _sharedId, null, 50, null)).Items);
        Assert.Equal("https://example.test/p3", left.Url);
        Assert.Equal(1, (await _collections.GetAsync(_submitter, _sharedId)).MyPendingSubmissionCount);
    }

    // ---------- my own waiting proposals, through the public link (a signed-in NON-member) ----------

    /// <summary>The public link's own surface: members and non-members are the same here - only the caller's rows.</summary>
    private async Task<(string PublicId, long ShareId)> OpenSubmitLinkAsync()
    {
        await RaiseEveryoneAsync(CollectionCollaboratorRole.Submitter);
        var share = await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Submit);
        var shareId = await _db.CollectionShares.AsNoTracking().Where(entry => entry.PublicId == share.PublicId).Select(entry => entry.Id).SingleAsync();
        return (share.PublicId, shareId);
    }

    [Fact]
    public async Task PublicMyPending_ANonMemberWhoProposedThroughTheLinkSeesTheirOwn_WithTheirCount()
    {
        var (publicId, _) = await OpenSubmitLinkAsync();
        var item = await NewItemAsync(_outsider, "https://example.test/public-mine");
        await PublicAdd().AddItemAsync(_outsider, publicId, item, null);
        _db.ChangeTracker.Clear();

        var page = (await PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, null))!;

        Assert.Equal("https://example.test/public-mine", Assert.Single(page.Items).Url);
        Assert.Equal(1, page.TotalCount);
        // No membership came with it: they are still nobody in the Collection.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Review().ListMineAsync(_outsider, _sharedId, null, 50, null));
    }

    [Fact]
    public async Task PublicMyPending_OnlyTheirOwn_NeverAnotherSubmittersOrTheOwnersQueue_AndNothingForAStranger()
    {
        var (publicId, _) = await OpenSubmitLinkAsync();
        var stranger = await NewUserAsync();
        var mine = await NewItemAsync(_outsider, "https://example.test/o1");
        var theirs = await NewItemAsync(_pending, "https://example.test/o2");
        await PublicAdd().AddItemAsync(_outsider, publicId, mine, null);
        await PublicAdd().AddItemAsync(_pending, publicId, theirs, null);
        var memberItem = await NewItemAsync(_submitter, "https://example.test/o3");
        await Add().AddAsync(_submitter, _sharedId, memberItem);
        _db.ChangeTracker.Clear();

        var own = (await PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, null))!;
        Assert.Equal(["https://example.test/o1"], own.Items.Select(entry => entry.Url));
        // 3 wait for the Owner in all - this caller is told only about their own one.
        Assert.Equal(3, (await _collections.GetAsync(_owner, _sharedId)).PendingSubmissionCount);
        Assert.Equal(1, own.TotalCount);
        var other = (await PublicAdd().ListMyProposalsAsync(_pending, publicId, null, 50, null))!;
        Assert.Equal(["https://example.test/o2"], other.Items.Select(entry => entry.Url));
        var none = (await PublicAdd().ListMyProposalsAsync(stranger, publicId, null, 50, null))!;
        Assert.Empty(none.Items);
        Assert.Equal(0, none.TotalCount);
    }

    [Fact]
    public async Task PublicMyPending_AnonymousCallersNeverReachIt_TheEndpointRequiresASignedInJupleUser()
    {
        var authorize = typeof(Juple.Api.Controllers.PublicShareWriteController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), inherit: true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Single();
        Assert.Equal(Juple.Api.Authentication.AuthorizationPolicies.JupleUser, authorize.Policy);
        var action = typeof(Juple.Api.Controllers.PublicShareWriteController).GetMethod(nameof(Juple.Api.Controllers.PublicShareWriteController.ListMyProposalsAsync))!;
        Assert.Empty(action.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), inherit: true));
        await Task.CompletedTask;
    }

    [Fact]
    public async Task PublicMyPending_WhenThePublicLinkIsOffOrUnknown_NothingIsReachable()
    {
        var (publicId, _) = await OpenSubmitLinkAsync();
        var item = await NewItemAsync(_outsider, "https://example.test/gone");
        await PublicAdd().AddItemAsync(_outsider, publicId, item, null);
        Assert.NotNull(await PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, null));

        await new CollectionShareStore(_db).RevokeAsync(_owner, _sharedId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        Assert.Null(await PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, null));
        Assert.Null(await PublicAdd().ListMyProposalsAsync(_outsider, "no-such-public-id", null, 50, null));
    }

    [Fact]
    public async Task PublicMyPending_APasswordProtectedLink_NeedsTheUnlockGrant()
    {
        var (publicId, shareId) = await OpenSubmitLinkAsync();
        var item = await NewItemAsync(_outsider, "https://example.test/protected");
        await PublicAdd().AddItemAsync(_outsider, publicId, item, null);
        // The Owner now protects the Collection with its own share password.
        var protection = CollectionSharePassword.Create(_sharedId, "hash", "cipher", DateTimeOffset.UtcNow);
        _db.CollectionSharePasswords.Add(protection);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionLockedException>(() => PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, "not-a-grant"));
        // A grant for the wrong purpose (the Owner's lock) is not the share password's.
        var wrongPurpose = _tokens.Issue(_sharedId, CollectionUnlockSubject.ForPublicShare(shareId), protection.PasswordVersion, DateTimeOffset.UtcNow, CollectionUnlockPurpose.CollectionLock);
        await Assert.ThrowsAsync<CollectionLockedException>(() => PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, wrongPurpose.Token));

        var grant = _tokens.Issue(_sharedId, CollectionUnlockSubject.ForPublicShare(shareId), protection.PasswordVersion, DateTimeOffset.UtcNow, CollectionUnlockPurpose.SharePassword);
        var page = (await PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, grant.Token))!;
        Assert.Equal("https://example.test/protected", Assert.Single(page.Items).Url);
    }

    [Fact]
    public async Task PublicMyPending_ApprovedAndRejectedLeaveIt_AndApprovalMakesNoMembership()
    {
        var (publicId, _) = await OpenSubmitLinkAsync();
        var approved = await NewItemAsync(_outsider, "https://example.test/yes");
        var rejected = await NewItemAsync(_outsider, "https://example.test/no");
        var waiting = await NewItemAsync(_outsider, "https://example.test/still");
        foreach (var itemId in new[] { approved, rejected, waiting })
        {
            await PublicAdd().AddItemAsync(_outsider, publicId, itemId, null);
        }

        _db.ChangeTracker.Clear();
        Assert.Equal(3, (await PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, null))!.TotalCount);
        var queue = (await Review().ListAsync(_owner, _sharedId, null, 50, null)).Items;
        await Review().ApproveAsync(_owner, _sharedId, queue.Single(entry => entry.Url.EndsWith("/yes", StringComparison.Ordinal)).SubmissionId, null);
        await Review().RejectAsync(_owner, _sharedId, queue.Single(entry => entry.Url.EndsWith("/no", StringComparison.Ordinal)).SubmissionId, null);
        _db.ChangeTracker.Clear();

        var left = (await PublicAdd().ListMyProposalsAsync(_outsider, publicId, null, 50, null))!;
        Assert.Equal(["https://example.test/still"], left.Items.Select(entry => entry.Url));
        Assert.Equal(1, left.TotalCount);
        Assert.False(await _db.CollectionCollaborators.AnyAsync(entry => entry.CollectionId == _sharedId && entry.UserId == _outsider));
    }

    [Fact]
    public async Task PublicMyPending_BoundedQueries_NoMatterHowManyProposalsExist()
    {
        var (publicId, _) = await OpenSubmitLinkAsync();
        var counter = new CommandCounter();
        await using var counted = NewContext(counter);
        for (var i = 0; i < 6; i++)
        {
            var item = await NewItemAsync(_outsider, $"https://example.test/bounded-{i}");
            await PublicAdd().AddItemAsync(_outsider, publicId, item, null);
        }

        var service = new PublicCollectionWriteService(
            new PublicCollectionStore(counted), new CollectionStore(counted), _tokens, TimeProvider.System, null, new CollectionLinkSubmissionStore(counted));
        counter.Reset();
        var few = (await service.ListMyProposalsAsync(_outsider, publicId, null, 2, null))!;
        var queries = counter.Count;
        var all = (await service.ListMyProposalsAsync(_outsider, publicId, null, 50, null))!;

        Assert.Equal(2, few.Items.Count);
        Assert.Equal(6, all.Items.Count);
        // Resolve the link + count + one page - the same few statements for 2 rows or 6.
        Assert.InRange(queries, 1, 4);
        Assert.Equal(queries, counter.Count - queries);
    }

    // ---------- one proposal per link ----------

    [Fact]
    public async Task ALinkAlreadyThere_OrAlreadyWaiting_CannotBeProposedAgain()
    {
        var ownerItem = await NewItemAsync(_owner, "https://example.test/same");
        await Add().AddAsync(_owner, _sharedId, ownerItem);
        var sameAsLinked = await NewItemAsync(_submitter, "https://example.test/same");
        var there = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => Add().AddAsync(_submitter, _sharedId, sameAsLinked));
        Assert.Equal(CollectionCollaborationConflictException.LinkAlreadyInCollection, there.Code);

        var proposed = await NewItemAsync(_submitter, "https://example.test/waiting");
        await Add().AddAsync(_submitter, _sharedId, proposed);
        var again = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => Add().AddAsync(_submitter, _sharedId, proposed));
        Assert.Equal(CollectionCollaborationConflictException.LinkAlreadyPending, again.Code);

        // Someone else proposing the same link through the public link meets the same rule.
        await RaiseEveryoneAsync(CollectionCollaboratorRole.Submitter);
        var share = await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Submit);
        var outsiderSame = await NewItemAsync(_outsider, "https://example.test/waiting");
        var publicAgain = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => PublicAdd().AddItemAsync(_outsider, share.PublicId, outsiderSame, null));
        Assert.Equal(CollectionCollaborationConflictException.LinkAlreadyPending, publicAgain.Code);
        Assert.Equal(1, await _db.CollectionLinkSubmissions.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task TwoProposalsOfTheSameLinkAtOnce_OnlyOneIsKept()
    {
        await InviteAndAcceptAsync(_outsider, CollectionCollaboratorRole.Submitter);
        var first = await NewItemAsync(_submitter, "https://example.test/race");
        var second = await NewItemAsync(_outsider, "https://example.test/race");

        await using var db1 = NewContext();
        await using var db2 = NewContext();
        var results = await Task.WhenAll(
            Capture(() => Add(db1).AddAsync(_submitter, _sharedId, first)),
            Capture(() => Add(db2).AddAsync(_outsider, _sharedId, second)));

        Assert.Single(results, result => result is null);
        Assert.Single(results, result => result is CollectionCollaborationConflictException { Code: CollectionCollaborationConflictException.LinkAlreadyPending });
        Assert.Equal(1, await _db.CollectionLinkSubmissions.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    // ---------- approve / reject ----------

    [Fact]
    public async Task Approving_MakesItAnOrdinaryLinkOfTheProposersItem_AndTellsEveryoneButTheOwnerAndTheProposer()
    {
        var item = await NewItemAsync(_submitter, "https://example.test/approve-me");
        await Add().AddAsync(_submitter, _sharedId, item);
        var submissionId = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId)).Id;
        var before = await LinkCountAsync();

        await Review().ApproveAsync(_owner, _sharedId, submissionId, null);
        _db.ChangeTracker.Clear();

        var membership = await _db.CollectionItems.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == item);
        Assert.Equal(_submitter, membership.AddedByUserId);
        Assert.False(membership.AddedViaPublicShare);
        Assert.Equal(_submitter, await _db.Items.AsNoTracking().Where(entry => entry.Id == item).Select(entry => entry.UserId).SingleAsync());
        Assert.Equal(before + 1, await LinkCountAsync());
        Assert.False(await _db.CollectionLinkSubmissions.AnyAsync(entry => entry.Id == submissionId));
        Assert.Equal(0, (await _collections.GetAsync(_owner, _sharedId)).PendingSubmissionCount);

        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        var told = await _db.Notifications.AsNoTracking()
            .Where(entry => entry.Type == NotificationType.CollectionItemsAdded && entry.CollectionId == _sharedId)
            .ToListAsync();
        Assert.All(told, entry => Assert.Equal(_submitter, entry.ActorUserId));
        Assert.Equal([_viewer, _contributor], told.Select(entry => entry.UserId).Order());

        // Approving it again adds nothing.
        await Assert.ThrowsAsync<CollectionLinkSubmissionNotFoundException>(() => Review().ApproveAsync(_owner, _sharedId, submissionId, null));
        Assert.Equal(before + 1, await LinkCountAsync());
    }

    [Fact]
    public async Task ApprovingAPublicProposal_KeepsItsProposerUnnamed_ExactlyLikeADirectPublicAdd()
    {
        await RaiseEveryoneAsync(CollectionCollaboratorRole.Submitter);
        var share = await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Submit);
        var item = await NewItemAsync(_outsider, "https://example.test/public-approve");
        await PublicAdd().AddItemAsync(_outsider, share.PublicId, item, null);
        var submissionId = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId)).Id;

        await Review().ApproveAsync(_owner, _sharedId, submissionId, null);
        _db.ChangeTracker.Clear();

        Assert.True((await _db.CollectionItems.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == item)).AddedViaPublicShare);
        var asContributor = await new Juple.Application.Collections.GetCollectionItems.GetCollectionItemsService(_access, _collections, new NoImages())
            .GetAsync(_viewer, _sharedId, null, 50);
        Assert.Equal(CollectionItemAdderKinds.PublicLink, asContributor.Items.Single(entry => entry.ItemId == item).AddedBy!.Kind);
        Assert.All(
            await _db.Notifications.AsNoTracking().Where(entry => entry.Type == NotificationType.CollectionItemsAdded && entry.CollectionId == _sharedId).ToListAsync(),
            entry => Assert.Null(entry.ActorUserId));
    }

    [Fact]
    public async Task TwoApprovalsAtOnce_AddTheLinkOnce()
    {
        var item = await NewItemAsync(_submitter, "https://example.test/double");
        await Add().AddAsync(_submitter, _sharedId, item);
        var submissionId = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId)).Id;

        await using var db1 = NewContext();
        await using var db2 = NewContext();
        var results = await Task.WhenAll(
            Capture(() => Review(db1).ApproveAsync(_owner, _sharedId, submissionId, null)),
            Capture(() => Review(db2).ApproveAsync(_owner, _sharedId, submissionId, null)));

        Assert.Single(results, result => result is null);
        Assert.Single(results, result => result is CollectionLinkSubmissionNotFoundException);
        Assert.Equal(1, await _db.CollectionItems.CountAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == item));
    }

    [Fact]
    public async Task ALinkThatArrivedMeanwhile_OrADeletedItem_IsNotAdded_AndTheProposalIsCleared()
    {
        var proposed = await NewItemAsync(_submitter, "https://example.test/arrived");
        await Add().AddAsync(_submitter, _sharedId, proposed);
        var first = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == proposed)).Id;
        // The Owner adds the same link directly before approving.
        await Add().AddAsync(_owner, _sharedId, await NewItemAsync(_owner, "https://example.test/arrived"));

        var arrived = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => Review().ApproveAsync(_owner, _sharedId, first, null));
        Assert.Equal(CollectionCollaborationConflictException.LinkAlreadyInCollection, arrived.Code);
        _db.ChangeTracker.Clear();
        Assert.False(await LinkedAsync(proposed));
        Assert.False(await _db.CollectionLinkSubmissions.AnyAsync(entry => entry.Id == first));

        var gone = await NewItemAsync(_submitter, "https://example.test/gone");
        await Add().AddAsync(_submitter, _sharedId, gone);
        var second = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == gone)).Id;
        await _db.Items.Where(entry => entry.Id == gone).ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.DeletedAtUtc, DateTimeOffset.UtcNow));

        var unavailable = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => Review().ApproveAsync(_owner, _sharedId, second, null));
        Assert.Equal(CollectionCollaborationConflictException.SubmissionUnavailable, unavailable.Code);
        Assert.False(await LinkedAsync(gone));
    }

    [Fact]
    public async Task Rejecting_RemovesTheProposal_AndAddsNothing()
    {
        var item = await NewItemAsync(_submitter, "https://example.test/reject-me");
        await Add().AddAsync(_submitter, _sharedId, item);
        var submissionId = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId)).Id;
        var before = await LinkCountAsync();

        await Review().RejectAsync(_owner, _sharedId, submissionId, null);
        await Review().RejectAsync(_owner, _sharedId, submissionId, null); // idempotent

        Assert.False(await _db.CollectionLinkSubmissions.AnyAsync(entry => entry.Id == submissionId));
        Assert.False(await LinkedAsync(item));
        Assert.Equal(before, await LinkCountAsync());
        // The proposer's own Item stays in their library.
        Assert.True(await _db.Items.AnyAsync(entry => entry.Id == item && entry.DeletedAtUtc == null));
    }

    [Fact]
    public async Task OnlyTheOwner_SeesApprovesOrRejects()
    {
        var item = await NewItemAsync(_submitter, "https://example.test/owner-only");
        await Add().AddAsync(_submitter, _sharedId, item);
        var submissionId = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId)).Id;

        foreach (var member in new[] { _viewer, _submitter, _contributor })
        {
            await Assert.ThrowsAsync<CollectionForbiddenException>(() => Review().ListAsync(member, _sharedId, null, 50, null));
            await Assert.ThrowsAsync<CollectionForbiddenException>(() => Review().ApproveAsync(member, _sharedId, submissionId, null));
            await Assert.ThrowsAsync<CollectionForbiddenException>(() => Review().RejectAsync(member, _sharedId, submissionId, null));
        }

        foreach (var stranger in new[] { _pending, _outsider })
        {
            await Assert.ThrowsAsync<CollectionNotFoundException>(() => Review().ListAsync(stranger, _sharedId, null, 50, null));
            await Assert.ThrowsAsync<CollectionNotFoundException>(() => Review().ApproveAsync(stranger, _sharedId, submissionId, null));
            await Assert.ThrowsAsync<CollectionNotFoundException>(() => Review().RejectAsync(stranger, _sharedId, submissionId, null));
        }

        Assert.True(await _db.CollectionLinkSubmissions.AnyAsync(entry => entry.Id == submissionId));
        var page = await Review().ListAsync(_owner, _sharedId, null, 50, null);
        var listed = Assert.Single(page.Items);
        Assert.Equal("https://example.test/owner-only", listed.Url);
        Assert.Equal(await JupleIdOfAsync(_submitter), listed.Proposer!.JupleId);
        Assert.False(listed.ViaPublicShare);
    }

    [Fact]
    public async Task ChangingRolesOrThePublicLink_NeverApprovesOrDropsAWaitingProposal()
    {
        var item = await NewItemAsync(_submitter, "https://example.test/stays");
        await Add().AddAsync(_submitter, _sharedId, item);

        await _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, await JupleIdOfAsync(_submitter), CollectionCollaboratorRole.Viewer);
        await _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, await JupleIdOfAsync(_submitter), CollectionCollaboratorRole.Contributor);
        await RaiseEveryoneAsync(CollectionCollaboratorRole.Contributor);
        await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Write);
        await new CollectionShareStore(_db).RevokeAsync(_owner, _sharedId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        Assert.True(await _db.CollectionLinkSubmissions.AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == item));
        Assert.False(await LinkedAsync(item));
    }

    // ---------- the Owner-confirmed raise ----------

    [Fact]
    public async Task EnablingTheLinkWithRaiseLowerRoles_RaisesEveryoneBelow_AndNobodyAbove_InOneStep()
    {
        // Fixture: Viewer, Submitter and Contributor members, plus a pending Viewer invitation.
        var share = await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Write, raiseLowerRoles: true);

        Assert.Equal(CollectionSharePermission.Write, share.Permission);
        _db.ChangeTracker.Clear();
        var members = await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _sharedId).ToListAsync();
        Assert.Equal(3, members.Count);
        Assert.All(members, member => Assert.Equal(CollectionCollaboratorRole.Contributor, member.Role));
        var invitation = await _db.CollectionInvitations.SingleAsync(entry => entry.CollectionId == _sharedId && entry.InvitedUserId == _pending);
        Assert.Equal(CollectionCollaboratorRole.Contributor, invitation.Role);
        Assert.Equal(CollectionInvitationStatus.Pending, invitation.Status);
    }

    [Fact]
    public async Task ChangingTheLinkWithRaiseLowerRoles_RaisesOnlyThoseBelowTheNewMinimum_NeverLowersAnyone()
    {
        await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Read);

        var changed = await _shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Submit, raiseLowerRoles: true);

        Assert.Equal(CollectionSharePermission.Submit, changed!.Permission);
        _db.ChangeTracker.Clear();
        var roles = await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _sharedId).Select(entry => entry.Role).ToListAsync();
        // The Viewer became a Submitter; the Submitter and the Contributor are exactly as they were.
        Assert.Equal(1, roles.Count(role => role == CollectionCollaboratorRole.Contributor));
        Assert.Equal(2, roles.Count(role => role == CollectionCollaboratorRole.Submitter));
        Assert.DoesNotContain(CollectionCollaboratorRole.Viewer, roles);
        var invitation = await _db.CollectionInvitations.SingleAsync(entry => entry.CollectionId == _sharedId && entry.InvitedUserId == _pending);
        Assert.Equal(CollectionCollaboratorRole.Submitter, invitation.Role);
    }

    [Fact]
    public async Task WithoutRaiseLowerRoles_ThePermissionStillIsRefused_AndNobodyIsChanged()
    {
        await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Read);

        var refused = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(
            () => _shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Write));

        Assert.Equal(CollectionCollaborationConflictException.PublicSharePermissionMismatch, refused.Code);
        _db.ChangeTracker.Clear();
        Assert.Equal(CollectionSharePermission.Read, (await _shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Read))!.Permission);
        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _sharedId && entry.Role == CollectionCollaboratorRole.Viewer));
    }

    [Fact]
    public async Task RaiseLowerRoles_IsOwnerOnly_AndATrulyLowerPermissionChangesNobody()
    {
        // Someone else's attempt to raise is refused like any other share management by a non-owner.
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => _shares.EnableAsync(_outsider, _sharedId, CollectionSharePermission.Write, raiseLowerRoles: true));
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => _shares.EnableAsync(_contributor, _sharedId, CollectionSharePermission.Write, raiseLowerRoles: true));

        // Read is the floor: nothing is below it, so asking to raise changes nobody.
        await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Read, raiseLowerRoles: true);
        _db.ChangeTracker.Clear();
        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _sharedId && entry.Role == CollectionCollaboratorRole.Viewer));
    }

    [Fact]
    public async Task AFailureWhileRaisingAndChangingTheLink_RollsEverythingBack()
    {
        await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Read);
        await using var failing = NewContext(new BeforeSaveInterceptor(_ => throw new InvalidOperationException("boom")));
        var failingShares = new EnableCollectionShareService(new CollectionShareStore(failing), TimeProvider.System);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => failingShares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Write, raiseLowerRoles: true));

        await AssertNothingChangedAsync(CollectionSharePermission.Read);
    }

    [Fact]
    public async Task AFailureWhileRaisingAndEnablingTheLink_LeavesNoLinkAndNoChangedRole()
    {
        await using var failing = NewContext(new BeforeSaveInterceptor(_ => throw new InvalidOperationException("boom")));
        var failingShares = new EnableCollectionShareService(new CollectionShareStore(failing), TimeProvider.System);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => failingShares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Write, raiseLowerRoles: true));

        await AssertNothingChangedAsync(expectedLink: null);
    }

    [Fact]
    public async Task AnInvitationAnsweredWhileRaising_IsAConcurrencyConflict_NotAFailure_AndNothingIsChanged()
    {
        await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Read);
        // Between the store reading the pending invitation and writing it, the invitee answers.
        await using var racing = NewContext(new BeforeSaveInterceptor(async cancellationToken =>
        {
            await using var invitee = NewContext();
            await invitee.CollectionInvitations
                .Where(entry => entry.CollectionId == _sharedId && entry.InvitedUserId == _pending)
                .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Status, CollectionInvitationStatus.Declined), cancellationToken);
        }));
        var racingShares = new EnableCollectionShareService(new CollectionShareStore(racing), TimeProvider.System);

        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => racingShares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Write, raiseLowerRoles: true));

        _db.ChangeTracker.Clear();
        Assert.Equal(CollectionSharePermission.Read, (await _db.CollectionShares.SingleAsync(entry => entry.CollectionId == _sharedId && entry.IsActive)).Permission);
        // Members were rolled back with it; only the invitee's own answer stands.
        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _sharedId && entry.Role == CollectionCollaboratorRole.Viewer));
        Assert.Equal(CollectionInvitationStatus.Declined,
            (await _db.CollectionInvitations.SingleAsync(entry => entry.CollectionId == _sharedId && entry.InvitedUserId == _pending)).Status);
    }

    [Fact]
    public async Task AnInvitationAnsweredWhileRaisingForANewLink_IsAlsoAConcurrencyConflict()
    {
        await using var racing = NewContext(new BeforeSaveInterceptor(async cancellationToken =>
        {
            await using var invitee = NewContext();
            await invitee.CollectionInvitations
                .Where(entry => entry.CollectionId == _sharedId && entry.InvitedUserId == _pending)
                .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Status, CollectionInvitationStatus.Declined), cancellationToken);
        }));
        var racingShares = new EnableCollectionShareService(new CollectionShareStore(racing), TimeProvider.System);

        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => racingShares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Write, raiseLowerRoles: true));

        _db.ChangeTracker.Clear();
        Assert.False(await _db.CollectionShares.AnyAsync(entry => entry.CollectionId == _sharedId && entry.IsActive));
        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _sharedId && entry.Role == CollectionCollaboratorRole.Viewer));
    }

    /// <summary>The fixture's roles exactly as set up (Viewer, Submitter, Contributor, pending Viewer) and the link as expected.</summary>
    private async Task AssertNothingChangedAsync(CollectionSharePermission? expectedLink)
    {
        _db.ChangeTracker.Clear();
        var link = await _db.CollectionShares.SingleOrDefaultAsync(entry => entry.CollectionId == _sharedId && entry.IsActive);
        Assert.Equal(expectedLink, link?.Permission);
        var roles = await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _sharedId).Select(entry => entry.Role).ToListAsync();
        Assert.Equal(1, roles.Count(role => role == CollectionCollaboratorRole.Viewer));
        Assert.Equal(1, roles.Count(role => role == CollectionCollaboratorRole.Submitter));
        Assert.Equal(1, roles.Count(role => role == CollectionCollaboratorRole.Contributor));
        var invitation = await _db.CollectionInvitations.SingleAsync(entry => entry.CollectionId == _sharedId && entry.InvitedUserId == _pending);
        Assert.Equal(CollectionCollaboratorRole.Viewer, invitation.Role);
        Assert.Equal(CollectionInvitationStatus.Pending, invitation.Status);
    }

    private sealed class CommandCounter : DbCommandInterceptor
    {
        public int Count { get; private set; }

        public void Reset() => Count = 0;

        public override ValueTask<InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command,
            CommandEventData eventData,
            InterceptionResult<System.Data.Common.DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Count++;
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    private sealed class BeforeSaveInterceptor(Func<CancellationToken, Task> action) : SaveChangesInterceptor
    {
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            await action(cancellationToken);
            return result;
        }
    }

    // ---------- the three-level minimum ----------

    [Fact]
    public async Task ThePublicLink_IsTheMinimumForEveryone_AtThreeLevels()
    {
        // A Viewer member: the link may be 읽기 전용 only.
        var tooHigh = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Submit));
        Assert.Equal(CollectionCollaborationConflictException.PublicSharePermissionMismatch, tooHigh.Code);

        // Everyone at least 승인 후 추가 (the pending invitation too): 승인 후 추가 is fine, 링크 추가 is not.
        await _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, await JupleIdOfAsync(_viewer), CollectionCollaboratorRole.Submitter);
        await _db.CollectionInvitations.Where(entry => entry.InvitedUserId == _pending)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Submitter));
        _db.ChangeTracker.Clear();
        await _shares.EnableAsync(_owner, _sharedId, CollectionSharePermission.Submit);
        var write = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Write));
        Assert.Equal(CollectionCollaborationConflictException.PublicSharePermissionMismatch, write.Code);

        // While the link is 승인 후 추가, nobody may be made 읽기 전용 - by invitation or by role change.
        var newcomer = await NewUserAsync();
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(
            () => _collaboration.InviteAsync(_owner, _sharedId, JupleIdOf(newcomer), CollectionCollaboratorRole.Viewer));
        await _collaboration.InviteAsync(_owner, _sharedId, JupleIdOf(newcomer), CollectionCollaboratorRole.Submitter);
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(
            () => _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, JupleIdOf(_submitter), CollectionCollaboratorRole.Viewer));
    }

    // ---------- helpers ----------

    private static async Task<Exception?> Capture(Func<Task> action)
    {
        try
        {
            await action();
            return null;
        }
        catch (Exception exception)
        {
            return exception;
        }
    }

    private async Task RaiseEveryoneAsync(CollectionCollaboratorRole role)
    {
        await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _sharedId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, role));
        await _db.CollectionInvitations.Where(entry => entry.CollectionId == _sharedId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, role));
        _db.ChangeTracker.Clear();
    }

    private Task<bool> LinkedAsync(long itemId) =>
        _db.CollectionItems.AsNoTracking().AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == itemId);

    private Task<int> LinkCountAsync() =>
        _db.CollectionItems.AsNoTracking().CountAsync(entry => entry.CollectionId == _sharedId);

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

    private string JupleIdOf(long userId) =>
        _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).Single();

    private sealed class NoImages : Juple.Application.Images.IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"users/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(null);
    }
}
