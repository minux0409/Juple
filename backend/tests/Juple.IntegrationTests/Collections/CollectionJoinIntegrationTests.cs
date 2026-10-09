using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.Join;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.SharePassword;
using Juple.Application.Collections.NotificationPreference;
using Juple.Application.Collections.Public;
using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// The corrected product model, against the real schema. The one public/private decision is CollectionShare.IsPublic (공용 컬렉션):
/// ON = anybody with the link opens the shared Collection (no membership, no request); OFF = the same link shows no content and only lets
/// a signed-in non-member ask the Owner to join (CollectionJoinRequest). An approval always makes a Viewer. There is no self-join.
/// </summary>
public sealed class CollectionJoinIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _alice;
    private long _bob;
    private long _collectionId;
    private string _publicId = null!;
    private CollectionUnlockTokenProtector _tokens = null!;
    private CollectionAccessService _access = null!;
    private EnableCollectionShareService _shares = null!;
    private CollectionCollaborationService _collaboration = null!;
    private CollectionJoinService _join = null!;
    private SocialNotificationPublisher _publisher = null!;
    private readonly RecordingPushSender _sender = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run these integration tests.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _owner = await NewUserAsync();
        _alice = await NewUserAsync();
        _bob = await NewUserAsync();
        var profiles = new UserProfileService(new UserProfileStore(_db), TimeProvider.System);
        await profiles.SetDisplayNameAsync(_owner, "피카츄");
        await profiles.SetDisplayNameAsync(_alice, "꼬부기");

        _publisher = new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _shares = new EnableCollectionShareService(new CollectionShareStore(_db), TimeProvider.System);
        _collaboration = new CollectionCollaborationService(_access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _join = new CollectionJoinService(
            new CollectionJoinStore(_db), new PublicCollectionStore(_db), new PublicShareMembershipStore(_db), _access, _tokens, TimeProvider.System, _publisher);

        _collectionId = (await new CollectionStore(_db).CreateAsync(_owner, "여행", "여행", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        // The Owner's link starts private (공용 컬렉션 OFF) - the situation a join request exists in.
        _publicId = (await _shares.MakePrivateAsync(_owner, _collectionId)).PublicId;
        _db.ChangeTracker.Clear();
        await RegisterDeviceAsync(_owner);
        await RegisterDeviceAsync(_alice);
        await RegisterDeviceAsync(_bob);
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

    private async Task MakePublicAsync(CollectionSharePermission permission = CollectionSharePermission.Read)
    {
        await _shares.EnableAsync(_owner, _collectionId);
        await _shares.SetPermissionAsync(_owner, _collectionId, permission);
        _db.ChangeTracker.Clear();
    }

    private async Task MakePrivateAsync()
    {
        await _shares.MakePrivateAsync(_owner, _collectionId);
        _db.ChangeTracker.Clear();
    }

    private async Task<CollectionCollaboratorRole?> RoleOfAsync(long userId) =>
        await _db.CollectionCollaborators.AsNoTracking()
            .Where(entry => entry.CollectionId == _collectionId && entry.UserId == userId)
            .Select(entry => (CollectionCollaboratorRole?)entry.Role)
            .SingleOrDefaultAsync();

    private async Task<List<CollectionJoinRequest>> RequestsOfAsync(long userId) =>
        await _db.CollectionJoinRequests.AsNoTracking()
            .Where(entry => entry.CollectionId == _collectionId && entry.RequesterUserId == userId)
            .OrderBy(entry => entry.Id)
            .ToListAsync();

    private async Task<CollectionJoinRequestStatus> OnlyStatusAsync(long userId) => Assert.Single(await RequestsOfAsync(userId)).Status;

    private async Task<long> RequestIdOfAsync(long userId) => Assert.Single(await RequestsOfAsync(userId)).Id;

    // ---------- the link and the one public/private decision ----------

    [Fact]
    public async Task TheLinkSurvivesTheToggle_SameUrlAndPublicId_AndOnlyTheContentsAreOnOrOff()
    {
        var privateLink = (await new CollectionShareStore(_db).GetActiveAsync(_owner, _collectionId))!;
        Assert.False(privateLink.IsPublic);

        await MakePublicAsync(CollectionSharePermission.Submit);
        var publicLink = (await new CollectionShareStore(_db).GetActiveAsync(_owner, _collectionId))!;
        Assert.Equal((privateLink.PublicId, true, CollectionSharePermission.Submit), (publicLink.PublicId, publicLink.IsPublic, publicLink.Permission));

        await MakePrivateAsync();
        var again = (await new CollectionShareStore(_db).GetActiveAsync(_owner, _collectionId))!;
        Assert.Equal((privateLink.PublicId, false), (again.PublicId, again.IsPublic));
        // Idempotent in both directions: nothing minted, nothing duplicated.
        await MakePrivateAsync();
        await MakePublicAsync(CollectionSharePermission.Submit);
        await MakePublicAsync(CollectionSharePermission.Submit);
        Assert.Equal(1, await _db.CollectionShares.CountAsync(entry => entry.CollectionId == _collectionId));
    }

    [Fact]
    public async Task APrivateLinkCanBeCreatedOnItsOwn_AndAnExistingLinkIsRevokedOnlyByTheExplicitAction()
    {
        var otherId = (await new CollectionStore(_db).CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();

        var created = await _shares.MakePrivateAsync(_owner, otherId);

        Assert.False(created.IsPublic);
        Assert.Equal(created.PublicId, (await _shares.MakePrivateAsync(_owner, otherId)).PublicId);
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _shares.MakePrivateAsync(_alice, otherId));
        await new CollectionShareStore(_db).RevokeAsync(_owner, otherId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        Assert.Null(await new CollectionShareStore(_db).GetActiveAsync(_owner, otherId));
    }

    [Fact]
    public async Task AShareEnabledTheOldWayStaysPublic()
    {
        var otherId = (await new CollectionStore(_db).CreateAsync(_owner, "Open", "OPEN", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();

        var share = await _shares.EnableAsync(_owner, otherId);

        Assert.True(share.IsPublic);
        Assert.True(new CollectionShare(otherId, "x", DateTimeOffset.UtcNow).IsPublic);
    }

    // ---------- what each audience gets ----------

    [Fact]
    public async Task PublicOn_ANonMemberReadsTheContentsThroughTheLink_WithNoRequestAndNoMembership()
    {
        await MakePublicAsync();

        Assert.NotNull(await new PublicCollectionStore(_db).GetStateAsync(_publicId));
        var conflict = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _join.RequestAsync(_alice, _publicId, null));
        Assert.Equal(CollectionCollaborationConflictException.JoinNotAllowed, conflict.Code);

        Assert.Null(await RoleOfAsync(_alice));
        Assert.Empty(await RequestsOfAsync(_alice));
        var resolved = (await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!;
        Assert.Equal((false, true, false), (resolved.IsMember, resolved.IsPublic, resolved.JoinRequestPending));
    }

    [Fact]
    public async Task PublicOff_TheSameLinkServesNoContent_ButAnExplicitRequestIsPossible_AndOpeningAloneCreatesNothing()
    {
        // Nothing public: not the state, so neither items nor the write path.
        Assert.Null(await new PublicCollectionStore(_db).GetStateAsync(_publicId));
        // Only the participation prompt is possible - and merely resolving the link writes nothing.
        var resolved = (await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!;
        Assert.Equal((false, false, false), (resolved.IsMember, resolved.IsPublic, resolved.JoinRequestPending));
        Assert.Empty(await RequestsOfAsync(_alice));
        Assert.Null(await RoleOfAsync(_alice));

        var requested = await _join.RequestAsync(_alice, _publicId, null);

        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.Requested, null, null), requested);
        Assert.Equal(CollectionJoinRequestStatus.Pending, await OnlyStatusAsync(_alice));
        Assert.Null(await RoleOfAsync(_alice)); // asking is not membership
    }

    [Fact]
    public async Task PublicOff_TheLandingKnowsTheNameOnly_NeverAnItemOrAPermission()
    {
        var dto = (await PublicService().GetCollectionAsync(_publicId))!;

        Assert.Equal(("여행", false, null, false), (dto.Name, dto.IsLocked, dto.Permission, dto.IsPublic));
    }

    [Theory]
    [InlineData(CollectionCollaboratorRole.Contributor)]
    [InlineData(CollectionCollaboratorRole.Submitter)]
    [InlineData(CollectionCollaboratorRole.Viewer)]
    public async Task AMember_IsAlwaysAMember_WhetherTheCollectionIsPublicOrPrivate(CollectionCollaboratorRole role)
    {
        await InviteAndAcceptAsync(_alice, role);

        foreach (var makePublic in new[] { true, false })
        {
            if (makePublic)
            {
                await MakePublicAsync();
            }
            else
            {
                await MakePrivateAsync();
            }

            var resolved = (await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!;
            Assert.Equal((true, _collectionId, role.ToString().ToLowerInvariant()), (resolved.IsMember, resolved.CollectionId, resolved.Role));
        }

        // Asking again is answered as "already a member" - never a request, never a second row.
        Assert.Equal(CollectionJoinOutcomes.AlreadyMember, (await _join.RequestAsync(_alice, _publicId, null))!.Outcome);
        Assert.Empty(await RequestsOfAsync(_alice));
        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _collectionId && entry.UserId == _alice));
    }

    [Fact]
    public async Task TheOwner_IsAlwaysAMember_OfPublicAndPrivateAlike()
    {
        foreach (var makePublic in new[] { false, true })
        {
            if (makePublic)
            {
                await MakePublicAsync();
            }

            var resolved = (await new PublicShareMembershipStore(_db).GetAsync(_publicId, _owner))!;
            Assert.Equal((true, _collectionId, "owner"), (resolved.IsMember, resolved.CollectionId, resolved.Role));
        }

        await MakePrivateAsync();
        Assert.Equal(CollectionJoinOutcomes.AlreadyMember, (await _join.RequestAsync(_owner, _publicId, null))!.Outcome);
        Assert.Empty(await RequestsOfAsync(_owner));
    }

    [Fact]
    public async Task AnUnknownOrRevokedLink_IsUnavailable_ToEveryone()
    {
        Assert.Null(await _join.RequestAsync(_alice, "does-not-exist-" + Guid.NewGuid().ToString("N"), null));
        await new CollectionShareStore(_db).RevokeAsync(_owner, _collectionId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        Assert.Null(await _join.RequestAsync(_alice, _publicId, null));
        Assert.Null(await new PublicShareMembershipStore(_db).GetAsync(_publicId, _owner));
    }

    // ---------- the request, and the requester's pending placeholder ----------

    [Fact]
    public async Task ARequest_IsOneWaitingRow_ASecondTapAddsNone()
    {
        var first = await _join.RequestAsync(_alice, _publicId, null);
        var second = await _join.RequestAsync(_alice, _publicId, null);

        Assert.Equal(CollectionJoinOutcomes.Requested, first!.Outcome);
        Assert.Equal(CollectionJoinOutcomes.AlreadyRequested, second!.Outcome);
        Assert.Equal(CollectionJoinRequestStatus.Pending, await OnlyStatusAsync(_alice));
    }

    [Fact]
    public async Task TheDatabaseItself_RefusesTwoWaitingRequestsOfOnePerson()
    {
        _db.CollectionJoinRequests.Add(new CollectionJoinRequest(_collectionId, _alice, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.CollectionJoinRequests.Add(new CollectionJoinRequest(_collectionId, _alice, DateTimeOffset.UtcNow));

        await Assert.ThrowsAsync<DbUpdateException>(() => _db.SaveChangesAsync());
        _db.ChangeTracker.Clear();
    }

    [Fact]
    public async Task TheRequestersPendingProjection_IsTheirOwnNameAndLookOnly_NotAMembership()
    {
        await _join.RequestAsync(_alice, _publicId, null);

        var mine = Assert.Single(await _join.ListMineAsync(_alice));

        Assert.Equal(("여행", "Folder", _publicId), (mine.Name, mine.Icon, mine.PublicId));
        Assert.Empty(await _join.ListMineAsync(_bob)); // never somebody else's
        Assert.Empty(await _join.ListMineAsync(_owner));
        Assert.Null(await RoleOfAsync(_alice));
        var serialized = System.Text.Json.JsonSerializer.Serialize(mine);
        Assert.DoesNotContain("UserId", serialized);
        Assert.DoesNotContain("CollectionId", serialized);
        // It is not an access path: the Collection's own authorization still refuses the requester.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _access.RequireAsync(_alice, _collectionId, CollectionPermission.View));
    }

    [Fact]
    public async Task ThePendingProjection_SurvivesARestartOfEverything_BecauseItIsServerState()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        _db.ChangeTracker.Clear();

        var fresh = new CollectionJoinService(
            new CollectionJoinStore(_db), new PublicCollectionStore(_db), new PublicShareMembershipStore(_db), _access, _tokens, TimeProvider.System, _publisher);

        Assert.Single(await fresh.ListMineAsync(_alice));
        Assert.True((await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!.JoinRequestPending);
    }

    [Fact]
    public async Task APendingRequestOfARevokedLink_IsNotListed()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await _join.RequestAsync(_bob, _publicId, null);

        await new CollectionShareStore(_db).RevokeAsync(_owner, _collectionId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        Assert.Empty(await _join.ListMineAsync(_alice));
        Assert.Empty(await _join.ListMineAsync(_bob));
    }

    [Fact]
    public async Task TheOwnersList_ShowsWaitingPeopleByPublicIdentityOnly_OldestFirst_AndOnlyToTheOwner()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await _join.RequestAsync(_bob, _publicId, null);

        var page = await _join.ListAsync(_owner, _collectionId, null, 20, null);

        Assert.Equal(2, page.Items.Count);
        Assert.Equal("꼬부기", page.Items[0].DisplayName);
        Assert.False(string.IsNullOrEmpty(page.Items[0].JupleId));
        Assert.True(page.Items[0].RequestId < page.Items[1].RequestId);
        Assert.DoesNotContain("UserId", System.Text.Json.JsonSerializer.Serialize(page));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _join.ListAsync(_alice, _collectionId, null, 20, null));
    }

    // ---------- approval and rejection ----------

    [Theory]
    [InlineData(CollectionSharePermission.Read)]
    [InlineData(CollectionSharePermission.Submit)]
    [InlineData(CollectionSharePermission.Write)]
    public async Task Approving_AlwaysMakesAViewer_NeverDerivedFromTheLinksStoredPermission(CollectionSharePermission storedPermission)
    {
        // The permission only means something while the contents are public; a private link just remembers it.
        await MakePublicAsync(storedPermission);
        await MakePrivateAsync();
        await _join.RequestAsync(_alice, _publicId, null);
        var requestId = await RequestIdOfAsync(_alice);

        await _join.ApproveAsync(_owner, _collectionId, requestId, null);

        Assert.Equal(CollectionCollaboratorRole.Viewer, await RoleOfAsync(_alice));
        var resolved = Assert.Single(await RequestsOfAsync(_alice));
        Assert.Equal((CollectionJoinRequestStatus.Approved, _owner), (resolved.Status, resolved.ResolvedByUserId));
        Assert.NotNull(resolved.ResolvedAtUtc);
        // The placeholder is gone; the real membership is there.
        Assert.Empty(await _join.ListMineAsync(_alice));
        var member = (await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!;
        Assert.Equal((true, _collectionId, "viewer"), (member.IsMember, member.CollectionId, member.Role));
        // A second approval finds nothing waiting and adds nothing.
        await Assert.ThrowsAsync<CollectionJoinRequestNotFoundException>(() => _join.ApproveAsync(_owner, _collectionId, requestId, null));
        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _collectionId && entry.UserId == _alice));
    }

    [Fact]
    public async Task AnApprovedViewer_ThenSeesTheCollectionThroughTheNormalAccessPath_ButCannotAdd()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await _join.ApproveAsync(_owner, _collectionId, await RequestIdOfAsync(_alice), null);

        await _access.RequireAsync(_alice, _collectionId, CollectionPermission.View);
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _access.RequireAsync(_alice, _collectionId, CollectionPermission.AddItem));
    }

    [Fact]
    public async Task Rejecting_GrantsNothing_RemovesThePlaceholder_IsIdempotent_AndOnlyTheOwnerMay()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        var requestId = await RequestIdOfAsync(_alice);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _join.RejectAsync(_bob, _collectionId, requestId, null));
        await _join.RejectAsync(_owner, _collectionId, requestId, null);
        await _join.RejectAsync(_owner, _collectionId, requestId, null);

        Assert.Null(await RoleOfAsync(_alice));
        Assert.Equal(CollectionJoinRequestStatus.Rejected, await OnlyStatusAsync(_alice));
        Assert.Empty(await _join.ListMineAsync(_alice)); // no dimmed "rejected" card is left behind
        // A declined person may ask again (a new row), as long as the link is private.
        Assert.Equal(CollectionJoinOutcomes.Requested, (await _join.RequestAsync(_alice, _publicId, null))!.Outcome);
        Assert.Equal([CollectionJoinRequestStatus.Rejected, CollectionJoinRequestStatus.Pending], (await RequestsOfAsync(_alice)).Select(row => row.Status).ToList());
    }

    [Fact]
    public async Task OnlyTheOwnerApproves_NotEvenAMemberOfTheCollection()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        var requestId = await RequestIdOfAsync(_alice);
        await InviteAndAcceptAsync(_bob, CollectionCollaboratorRole.Contributor);

        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _join.ApproveAsync(_bob, _collectionId, requestId, null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _join.RejectAsync(_bob, _collectionId, requestId, null));
        Assert.Null(await RoleOfAsync(_alice));
    }

    [Fact]
    public async Task EvenARequestStillMarkedPending_CannotBeApprovedOnceTheContentsArePublic()
    {
        // The store's own re-check, independent of the clean-up: a row left Pending (e.g. by an older revision) is refused at approval.
        await _join.RequestAsync(_alice, _publicId, null);
        var requestId = await RequestIdOfAsync(_alice);
        await _db.CollectionShares.Where(entry => entry.CollectionId == _collectionId && entry.IsActive)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.IsPublic, true));

        var refused = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _join.ApproveAsync(_owner, _collectionId, requestId, null));

        Assert.Equal(CollectionCollaborationConflictException.JoinNotAllowed, refused.Code);
        Assert.Null(await RoleOfAsync(_alice));
        Assert.Equal(CollectionJoinRequestStatus.Pending, await OnlyStatusAsync(_alice));
    }

    // ---------- the lifecycle: when a waiting request stops being valid ----------

    [Fact]
    public async Task PublicOffToOn_MakesWaitingRequestsObsolete_NobodyBecomesAMember_NobodyIsTold()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await _join.RequestAsync(_bob, _publicId, null);

        await MakePublicAsync();

        Assert.Equal(CollectionJoinRequestStatus.Obsolete, await OnlyStatusAsync(_alice));
        Assert.Equal(CollectionJoinRequestStatus.Obsolete, await OnlyStatusAsync(_bob));
        Assert.Null(await RoleOfAsync(_alice));
        Assert.Null(await RoleOfAsync(_bob));
        Assert.Empty(await _join.ListMineAsync(_alice)); // the placeholder disappears
        Assert.Empty((await _join.ListAsync(_owner, _collectionId, null, 20, null)).Items);
        // They can now simply open the public Collection through the link.
        Assert.NotNull(await new PublicCollectionStore(_db).GetStateAsync(_publicId));
        await RunPipelineAsync();
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.Type == NotificationType.JoinRequestRejected || entry.Type == NotificationType.JoinRequestApproved));
    }

    [Fact]
    public async Task StayingPrivate_NeverObsoletesAWaitingRequest_ThatIsExactlyTheStateRequestsLiveIn()
    {
        await _join.RequestAsync(_alice, _publicId, null);

        await MakePrivateAsync(); // already private: idempotent
        await MakePrivateAsync();

        Assert.Equal(CollectionJoinRequestStatus.Pending, await OnlyStatusAsync(_alice));
    }

    [Fact]
    public async Task AfterObsolete_ThePrivateLinkAcceptsAFreshRequest_AndTheOldOneNeverRevives()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        var oldId = await RequestIdOfAsync(_alice);
        await MakePublicAsync();
        await MakePrivateAsync();

        Assert.False((await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!.JoinRequestPending);
        Assert.Equal(CollectionJoinOutcomes.Requested, (await _join.RequestAsync(_alice, _publicId, null))!.Outcome);
        await Assert.ThrowsAsync<CollectionJoinRequestNotFoundException>(() => _join.ApproveAsync(_owner, _collectionId, oldId, null));
        await _join.RejectAsync(_owner, _collectionId, oldId, null);

        var rows = await RequestsOfAsync(_alice);
        Assert.Equal([CollectionJoinRequestStatus.Obsolete, CollectionJoinRequestStatus.Pending], rows.Select(row => row.Status).ToList());
    }

    [Fact]
    public async Task ExplicitlyRevokingTheLink_MakesWaitingRequestsObsolete_AndTheyCannotBeAnswered()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        var requestId = await RequestIdOfAsync(_alice);

        await new CollectionShareStore(_db).RevokeAsync(_owner, _collectionId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        Assert.Equal(CollectionJoinRequestStatus.Obsolete, await OnlyStatusAsync(_alice));
        await Assert.ThrowsAsync<CollectionJoinRequestNotFoundException>(() => _join.ApproveAsync(_owner, _collectionId, requestId, null));
        await _join.RejectAsync(_owner, _collectionId, requestId, null); // a quiet no-op
        await RunPipelineAsync();
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.Type == NotificationType.JoinRequestRejected || entry.Type == NotificationType.JoinRequestApproved));
        Assert.Null(await RoleOfAsync(_alice));
    }

    [Fact]
    public async Task DeletingTheCollection_MakesWaitingRequestsObsolete()
    {
        await _join.RequestAsync(_alice, _publicId, null);

        await new CollectionStore(_db).DeleteAsync(_owner, _collectionId);
        _db.ChangeTracker.Clear();

        Assert.Equal(CollectionJoinRequestStatus.Obsolete, await OnlyStatusAsync(_alice));
    }

    [Fact]
    public async Task AnInvitationAcceptedWhileARequestWaits_LeavesOneMembership_AndTheRequestObsolete()
    {
        await _join.RequestAsync(_alice, _publicId, null);

        await InviteAndAcceptAsync(_alice, CollectionCollaboratorRole.Contributor);

        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _collectionId && entry.UserId == _alice));
        Assert.Equal(CollectionCollaboratorRole.Contributor, await RoleOfAsync(_alice));
        Assert.Equal(CollectionJoinRequestStatus.Obsolete, await OnlyStatusAsync(_alice));
        Assert.Empty((await _join.ListAsync(_owner, _collectionId, null, 20, null)).Items);
    }

    [Fact]
    public async Task ARequestWhoseRequesterBecameAMemberUnnoticed_ResolvesWithoutASecondMembership()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        var requestId = await RequestIdOfAsync(_alice);
        _db.CollectionCollaborators.Add(new CollectionCollaborator(_collectionId, _alice, CollectionCollaboratorRole.Viewer, _owner, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        await _join.ApproveAsync(_owner, _collectionId, requestId, null);

        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _collectionId && entry.UserId == _alice));
        Assert.Equal(CollectionJoinRequestStatus.Obsolete, await OnlyStatusAsync(_alice));
        await RunPipelineAsync();
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.UserId == _alice && entry.Type == NotificationType.JoinRequestApproved));
    }

    // ---------- a password-protected link ----------

    private async Task SetSharePasswordAsync(string password)
    {
        var hasher = new CollectionLockPasswordHasher();
        var sealer = new CollectionSharePasswordProtector(Options.Create(new CollectionSharePasswordOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        await new CollectionSharePasswordService(
                _access, new CollectionSharePasswordStore(_db), hasher, sealer,
                new CollectionPasswordVerifier(new CollectionLockStore(_db), hasher), _tokens, TimeProvider.System)
            .SetAsync(_owner, _collectionId, password, password, null);
        _db.ChangeTracker.Clear();
    }

    private PublicCollectionService PublicService()
    {
        var lockStore = new CollectionLockStore(_db);
        return new PublicCollectionService(
            new PublicCollectionStore(_db), lockStore, new CollectionPasswordVerifier(lockStore, new CollectionLockPasswordHasher()), _tokens, TimeProvider.System,
            new CollectionSharePasswordStore(_db));
    }

    [Fact]
    public async Task PrivateWithAPassword_TheGrantComesBeforeTheRequest_AndIsNeverMembership()
    {
        await SetSharePasswordAsync("board-pass");

        // Before the password nothing is known, not even the name or that the link is private.
        Assert.Equal(new PublicCollectionDto(Name: null, IsLocked: true), await PublicService().GetCollectionAsync(_publicId));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _join.RequestAsync(_alice, _publicId, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _join.RequestAsync(_alice, _publicId, "not-a-grant"));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => PublicService().UnlockAsync(_publicId, "wrong-pass"));
        Assert.Empty(await RequestsOfAsync(_alice));

        var grant = (await PublicService().UnlockAsync(_publicId, "board-pass"))!;
        var landing = (await PublicService().GetCollectionAsync(_publicId, grant.Token))!;
        Assert.Equal(("여행", false), (landing.Name, landing.IsPublic));
        // Proving the password is not membership - nor a request.
        Assert.Null(await RoleOfAsync(_alice));
        Assert.Empty(await RequestsOfAsync(_alice));
        Assert.False((await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!.IsMember);

        Assert.Equal(CollectionJoinOutcomes.Requested, (await _join.RequestAsync(_alice, _publicId, grant.Token))!.Outcome);
        Assert.Null(await RoleOfAsync(_alice)); // still only waiting for the Owner
    }

    [Fact]
    public async Task PublicWithAPassword_NeedsNoRequestAtAll()
    {
        await MakePublicAsync();
        await SetSharePasswordAsync("board-pass");

        var grant = (await PublicService().UnlockAsync(_publicId, "board-pass"))!;
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _join.RequestAsync(_alice, _publicId, grant.Token));
        Assert.Null(await RoleOfAsync(_alice));
    }

    [Fact]
    public async Task AGrantOfAnotherLink_DoesNotOpenThisOne()
    {
        await SetSharePasswordAsync("board-pass");
        var grant = (await PublicService().UnlockAsync(_publicId, "board-pass"))!;

        var otherId = (await new CollectionStore(_db).CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        var other = await _shares.MakePrivateAsync(_owner, otherId);
        var hasher = new CollectionLockPasswordHasher();
        await new CollectionSharePasswordService(
                _access, new CollectionSharePasswordStore(_db), hasher,
                new CollectionSharePasswordProtector(Options.Create(new CollectionSharePasswordOptions { EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) })),
                new CollectionPasswordVerifier(new CollectionLockStore(_db), hasher), _tokens, TimeProvider.System)
            .SetAsync(_owner, otherId, "other-pass", "other-pass", null);
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionLockedException>(() => _join.RequestAsync(_alice, other.PublicId, grant.Token));
    }

    // ---------- notifications (R40-C rules) ----------

    [Fact]
    public async Task ARequest_TellsTheOwnerOnce_NamingTheRequester_AndTheAnswerReachesTheRequesterRegardlessOfAMute()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await _join.RequestAsync(_alice, _publicId, null); // a repeat tells nobody again
        await RunPipelineAsync();

        var received = Assert.Single(await RowsAsync(NotificationType.JoinRequestReceived));
        Assert.Equal((_owner, _alice, _collectionId), (received.UserId, received.ActorUserId, received.CollectionId));
        Assert.Null(received.ReadAtUtc);
        Assert.Single(_sender.SentTo(_owner), sent => sent.Payload.Type == "joinRequest");

        await _join.ApproveAsync(_owner, _collectionId, await RequestIdOfAsync(_alice), null);
        await RunPipelineAsync();

        Assert.Single(_sender.SentTo(_alice), sent => sent.Payload.Type == "joinRequestApproved");
        Assert.Single(await RowsAsync(NotificationType.JoinRequestApproved));
    }

    [Fact]
    public async Task WithTheOwnersCollectionMuted_TheRequestStillReachesTheInbox_ButNoPushIsSent()
    {
        await new CollectionNotificationPreferenceService(_access, new CollectionNotificationPreferenceStore(_db), TimeProvider.System).SetAsync(_owner, _collectionId, false);
        _db.ChangeTracker.Clear();

        await _join.RequestAsync(_alice, _publicId, null);
        await RunPipelineAsync();

        var row = Assert.Single(await RowsAsync(NotificationType.JoinRequestReceived));
        Assert.Null(row.ReadAtUtc);
        Assert.DoesNotContain(_sender.SentTo(_owner), sent => sent.Payload.Type == "joinRequest");
    }

    [Fact]
    public async Task ARejection_TellsTheRequester_AndNoStaleOwnerPushIsSentForAnAlreadyAnsweredRequest()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await _join.RejectAsync(_owner, _collectionId, await RequestIdOfAsync(_alice), null); // before the dispatcher ran
        await RunPipelineAsync();

        Assert.DoesNotContain(_sender.SentTo(_owner), sent => sent.Payload.Type == "joinRequest");
        Assert.Single(_sender.SentTo(_alice), sent => sent.Payload.Type == "joinRequestRejected");
    }

    [Fact]
    public async Task AccountDeletion_RemovesTheRequestersWaitingRequests()
    {
        await _join.RequestAsync(_alice, _publicId, null);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_alice, $"test/{_alice}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_alice);

        Assert.False(await _db.CollectionJoinRequests.AnyAsync(entry => entry.RequesterUserId == _alice));
    }

    // ---------- 컬렉션 추가: saving a PUBLIC Collection is an explicit, immediate Viewer membership ----------

    [Fact]
    public async Task PublicSave_OpeningAndCancellingCreateNothing_OnlyTheExplicitSaveMakesAViewer()
    {
        await MakePublicAsync();

        // Opening the link = resolving it: nothing is written.
        Assert.False((await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!.IsMember);
        Assert.Null(await RoleOfAsync(_alice));
        Assert.Empty(await _join.ListMineAsync(_alice));

        var saved = await _join.SavePublicAsync(_alice, _publicId, null);

        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.Joined, _collectionId, "viewer"), saved);
        Assert.Equal(CollectionCollaboratorRole.Viewer, await RoleOfAsync(_alice));
        // The next opening of the link is a member: CollectionDetails.
        var again = (await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!;
        Assert.Equal((true, _collectionId, "viewer"), (again.IsMember, again.CollectionId, again.Role));
    }

    [Theory]
    [InlineData(CollectionSharePermission.Read)]
    [InlineData(CollectionSharePermission.Submit)]
    [InlineData(CollectionSharePermission.Write)]
    public async Task PublicSave_IsAlwaysAViewer_TheLinksPermissionNeverDecidesTheRole(CollectionSharePermission permission)
    {
        await MakePublicAsync(permission);

        await _join.SavePublicAsync(_alice, _publicId, null);

        Assert.Equal(CollectionCollaboratorRole.Viewer, await RoleOfAsync(_alice));
    }

    [Fact]
    public async Task PublicSave_IsIdempotent_AMemberOrTheOwnerNeverGetsASecondRow()
    {
        await MakePublicAsync();

        Assert.Equal(CollectionJoinOutcomes.Joined, (await _join.SavePublicAsync(_alice, _publicId, null))!.Outcome);
        Assert.Equal(CollectionJoinOutcomes.AlreadyMember, (await _join.SavePublicAsync(_alice, _publicId, null))!.Outcome);
        Assert.Equal(CollectionJoinOutcomes.AlreadyMember, (await _join.SavePublicAsync(_owner, _publicId, null))!.Outcome);

        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _collectionId && entry.UserId == _alice));
        Assert.Null(await RoleOfAsync(_owner));
        // An existing Contributor keeps their role - saving never downgrades anybody.
        await InviteAndAcceptAsync(_bob, CollectionCollaboratorRole.Contributor);
        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.AlreadyMember, _collectionId, "contributor"), await _join.SavePublicAsync(_bob, _publicId, null));
        Assert.Equal(CollectionCollaboratorRole.Contributor, await RoleOfAsync(_bob));
    }

    [Fact]
    public async Task PublicSave_IsRefused_WhenTheLinkIsPrivate_OrWasTurnedOffBeforeTheSave()
    {
        await MakePublicAsync();
        Assert.False((await new PublicShareMembershipStore(_db).GetAsync(_publicId, _alice))!.IsMember);
        await MakePrivateAsync(); // the Owner switches OFF while the dialog is open

        var refused = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _join.SavePublicAsync(_alice, _publicId, null));

        Assert.Equal(CollectionCollaborationConflictException.JoinNotAllowed, refused.Code);
        Assert.Null(await RoleOfAsync(_alice));
    }

    [Fact]
    public async Task PublicSave_OfARevokedOrUnknownLink_IsUnavailable()
    {
        await MakePublicAsync();
        await new CollectionShareStore(_db).RevokeAsync(_owner, _collectionId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        Assert.Null(await _join.SavePublicAsync(_alice, _publicId, null));
        Assert.Null(await _join.SavePublicAsync(_alice, "does-not-exist-" + Guid.NewGuid().ToString("N"), null));
        Assert.Null(await RoleOfAsync(_alice));
    }

    [Fact]
    public async Task PublicSave_NeedsTheLinksPasswordGrant_AndThePasswordAloneSavesNothing()
    {
        await MakePublicAsync();
        await SetSharePasswordAsync("board-pass");

        await Assert.ThrowsAsync<CollectionLockedException>(() => _join.SavePublicAsync(_alice, _publicId, null));
        var grant = (await PublicService().UnlockAsync(_publicId, "board-pass"))!;
        Assert.Null(await RoleOfAsync(_alice)); // unlocking saved nothing

        Assert.Equal(CollectionJoinOutcomes.Joined, (await _join.SavePublicAsync(_alice, _publicId, grant.Token))!.Outcome);
        Assert.Equal(CollectionCollaboratorRole.Viewer, await RoleOfAsync(_alice));
    }

    [Fact]
    public async Task PublicSave_ClearsTheSavingPersonsOwnWaitingRequest_AndAnOwnersRequestIsNeverAffected()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await _join.RequestAsync(_bob, _publicId, null);
        // Both are waiting under the private link; the Owner now makes it public (their requests become Obsolete) - and Alice saves.
        await MakePublicAsync();

        await _join.SavePublicAsync(_alice, _publicId, null);

        Assert.Equal(CollectionJoinRequestStatus.Obsolete, await OnlyStatusAsync(_alice));
        Assert.Empty(await _join.ListMineAsync(_alice));
        Assert.Equal(CollectionCollaboratorRole.Viewer, await RoleOfAsync(_alice));
        Assert.Null(await RoleOfAsync(_bob));
    }

    [Fact]
    public async Task PublicSave_NotifiesNobodyOfARequest()
    {
        await MakePublicAsync();

        await _join.SavePublicAsync(_alice, _publicId, null);
        await RunPipelineAsync();

        Assert.False(await _db.Notifications.AnyAsync(entry => entry.Type == NotificationType.JoinRequestReceived));
    }

    // ---------- 참여 요청 count: the owner's action badge ----------

    private async Task<CollectionDto> OwnerCardAsync(long userId)
    {
        _db.ChangeTracker.Clear();
        return await new CollectionStore(_db).GetAsync(userId, _collectionId);
    }

    [Fact]
    public async Task TheOwnersCard_CountsWaitingJoinRequests_IntoItsActionBadge_AndEveryOutcomeTakesThemOut()
    {
        Assert.Equal((0, 0), ((await OwnerCardAsync(_owner)).PendingJoinRequestCount, (await OwnerCardAsync(_owner)).AttentionCount));

        await _join.RequestAsync(_alice, _publicId, null);
        await _join.RequestAsync(_bob, _publicId, null);
        await _join.RequestAsync(_bob, _publicId, null); // a repeat is not a second one
        var two = await OwnerCardAsync(_owner);
        Assert.Equal((2, 2), (two.PendingJoinRequestCount, two.AttentionCount));

        await _join.ApproveAsync(_owner, _collectionId, await RequestIdOfAsync(_alice), null);
        Assert.Equal(1, (await OwnerCardAsync(_owner)).PendingJoinRequestCount);

        await _join.RejectAsync(_owner, _collectionId, await RequestIdOfAsync(_bob), null);
        var none = await OwnerCardAsync(_owner);
        Assert.Equal((0, 0), (none.PendingJoinRequestCount, none.AttentionCount));
    }

    [Fact]
    public async Task ObsoleteAndMembershipByAnotherPath_AlsoTakeARequestOutOfTheCount_AndAReRequestCountsAgain()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await _join.RequestAsync(_bob, _publicId, null);
        Assert.Equal(2, (await OwnerCardAsync(_owner)).PendingJoinRequestCount);

        await InviteAndAcceptAsync(_alice, CollectionCollaboratorRole.Contributor); // another path: Pending -> Obsolete
        Assert.Equal(1, (await OwnerCardAsync(_owner)).PendingJoinRequestCount);

        await MakePublicAsync(); // the contents become public: everything waiting becomes Obsolete
        Assert.Equal(0, (await OwnerCardAsync(_owner)).PendingJoinRequestCount);

        await MakePrivateAsync();
        await _join.RequestAsync(_bob, _publicId, null);
        Assert.Equal(1, (await OwnerCardAsync(_owner)).PendingJoinRequestCount);
    }

    [Fact]
    public async Task OnlyTheOwnerSeesTheCount_AMemberAndTheRequesterSeeNoActionBadge()
    {
        await InviteAndAcceptAsync(_bob, CollectionCollaboratorRole.Contributor);
        await _join.RequestAsync(_alice, _publicId, null);

        var member = await OwnerCardAsync(_bob);
        Assert.Equal((0, 0), (member.PendingJoinRequestCount, member.AttentionCount));
        Assert.Equal(1, (await OwnerCardAsync(_owner)).PendingJoinRequestCount);
    }

    [Fact]
    public async Task TheActionBadgeAndTheNotificationUnreadCount_AreDifferentThings_NeverAddedTogether()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        await RunPipelineAsync();

        // The durable "참여 요청" notification exists and is unread (the global inbox counts it)...
        var received = Assert.Single(await RowsAsync(NotificationType.JoinRequestReceived));
        Assert.Null(received.ReadAtUtc);
        // ...yet the card's action badge counts the waiting request exactly once (it is not 2: notification + request).
        var card = await OwnerCardAsync(_owner);
        Assert.Equal((1, 1, 0), (card.PendingJoinRequestCount, card.AttentionCount, card.UnreadNewLinkCount));
        // Reading the notification changes the inbox only - the task stays until it is answered.
        await _db.Notifications.Where(entry => entry.Id == received.Id).ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.ReadAtUtc, DateTimeOffset.UtcNow));
        Assert.Equal(1, (await OwnerCardAsync(_owner)).AttentionCount);
    }

    // ---------- the Collection's own profile photo in the requester's pending projection ----------

    private sealed class FakeIconStorage : Juple.Application.Collections.SetCollectionIconImage.ICollectionIconImageStorage
    {
        public Task<string> UploadCollectionIconAsync(long ownerUserId, long collectionId, Juple.Application.Images.ImageFormat format, byte[] content, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteCollectionIconAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<Uri?> CreateCollectionIconReadUrlAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(new Uri($"https://blob.test/{ownerUserId}/{blobName}?sig=1"));
    }

    [Fact]
    public async Task ThePendingProjection_CarriesTheCollectionsOwnPhoto_OrNothingWhenItHasNone_AndNeverAnItemImage()
    {
        await _join.RequestAsync(_alice, _publicId, null);
        var withStorage = new CollectionJoinService(
            new CollectionJoinStore(_db, null, new FakeIconStorage()), new PublicCollectionStore(_db), new PublicShareMembershipStore(_db), _access, _tokens, TimeProvider.System, _publisher);

        var plain = Assert.Single(await withStorage.ListMineAsync(_alice));
        Assert.Null(plain.IconImageUrl);
        Assert.Null(plain.IconImageVersion);

        await _db.Collections.Where(entry => entry.Id == _collectionId).ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.IconImageBlobName, "cover-1.jpg"));
        var photo = Assert.Single(await withStorage.ListMineAsync(_alice));
        Assert.StartsWith($"https://blob.test/{_owner}/cover-1.jpg", photo.IconImageUrl);
        Assert.Equal(Juple.Application.Collections.SetCollectionIconImage.CollectionIconImageVersion.From("cover-1.jpg"), photo.IconImageVersion);
        // The storage layout (blob name) never leaves the server in the DTO fields.
        Assert.DoesNotContain("IconImageBlobName", System.Text.Json.JsonSerializer.Serialize(photo));
    }

    [Fact]
    public async Task ThePublicLinkIdentity_CarriesThePhoto_SignedForTheOwner_AndStillNothingElse()
    {
        await _db.Collections.Where(entry => entry.Id == _collectionId).ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.IconImageBlobName, "cover-2.jpg"));
        var lockStore = new CollectionLockStore(_db);
        var service = new PublicCollectionService(
            new PublicCollectionStore(_db), lockStore, new CollectionPasswordVerifier(lockStore, new CollectionLockPasswordHasher()), _tokens, TimeProvider.System,
            new CollectionSharePasswordStore(_db), new FakeIconStorage());

        var dto = (await service.GetCollectionAsync(_publicId))!;

        Assert.False(dto.IsPublic);
        Assert.StartsWith($"https://blob.test/{_owner}/cover-2.jpg", dto.IconImageUrl);
        Assert.Equal(("여행", null), (dto.Name, dto.Permission));
        var keys = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(dto)).RootElement.EnumerateObject().Select(property => property.Name).Order().ToList();
        Assert.Equal(["Color", "Icon", "IconImageUrl", "IconImageVersion", "IsLocked", "IsPublic", "Name", "Permission"], keys);
    }

    // ---------- helpers ----------

    private async Task RunPipelineAsync()
    {
        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.Dispatcher(_db, _sender).RunOnceAsync();
        _db.ChangeTracker.Clear();
    }

    private async Task<List<Notification>> RowsAsync(NotificationType type)
    {
        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        return await _db.Notifications.AsNoTracking()
            .Where(entry => entry.Type == type && _userIds.Contains(entry.UserId))
            .ToListAsync();
    }

    private async Task InviteAndAcceptAsync(long inviteeId, CollectionCollaboratorRole role)
    {
        var jupleId = await _db.Users.AsNoTracking().Where(user => user.Id == inviteeId).Select(user => user.PublicCode).SingleAsync();
        var invitation = await _collaboration.InviteAsync(_owner, _collectionId, jupleId, role);
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

    private async Task RegisterDeviceAsync(long userId)
    {
        await new PushDeviceRegistrationStore(_db).RegisterAsync(
            userId, PushPlatform.Android, Guid.NewGuid().ToString("N"), "test-token-" + Guid.NewGuid().ToString("N"), "ko", DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
    }

    private sealed class RecordingPushSender : IPushSender
    {
        private readonly List<(long UserId, PushNotificationPayload Payload)> _sent = [];

        public IReadOnlyList<(long UserId, PushNotificationPayload Payload)> SentTo(long userId) =>
            _sent.Where(sent => sent.UserId == userId).ToList();

        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            _sent.Add((device.UserId, payload));
            return Task.FromResult(PushSendResult.Sent("test-message"));
        }
    }
}
