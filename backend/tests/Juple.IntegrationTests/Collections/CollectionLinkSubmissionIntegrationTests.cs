using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
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

    private JupleDbContext NewContext() =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

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
