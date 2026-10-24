using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.GetCollectionShare;
using Juple.Application.Collections.Join;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// A Collection has a link to pass on from the moment it is created (a PRIVATE one: nothing public, join requests only), whoever passes it
/// on. The request a stranger makes with it always lands in the OWNER's waiting list - the link carries no "issuer", so a member passing it
/// on can neither bypass the approval nor make the request vanish.
/// </summary>
public sealed class CollectionInitialLinkIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _stranger;
    private long _otherStranger;
    private long _collectionId;
    private CollectionShareStore _shares = null!;
    private CollectionJoinStore _join = null!;
    private CollectionCollaborationService _collaboration = null!;
    private GetCollectionShareLinkService _memberLink = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run these integration tests.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _stranger = await NewUserAsync();
        _otherStranger = await NewUserAsync();

        _shares = new CollectionShareStore(_db);
        _join = new CollectionJoinStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _memberLink = new GetCollectionShareLinkService(access, _shares, new CollectionLinkEnsurer(_shares, TimeProvider.System));

        _collectionId = (await new CollectionStore(_db).CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        var invitation = await _collaboration.InviteAsync(_owner, _collectionId, await JupleIdOfAsync(_member), CollectionCollaboratorRole.Viewer);
        await _collaboration.AcceptInvitationAsync(_member, invitation.InvitationId);
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

    [Fact]
    public async Task ANewCollection_HasOneActivePrivateLink_AndIsNotCountedAsShared()
    {
        var link = Assert.Single(await _db.CollectionShares.AsNoTracking().Where(share => share.CollectionId == _collectionId).ToListAsync());

        Assert.True(link.IsActive);
        Assert.False(link.IsPublic);
        Assert.Equal(32, link.PublicId.Length);
        // A private link shares nothing: the card's "shared" marker still reads the public link only.
        var summary = await new CollectionStore(_db).GetAsync(_owner, _collectionId);
        Assert.False(summary.IsPublicShareActive);
    }

    [Fact]
    public async Task EveryNewCollection_GetsItsOwnDistinctLink()
    {
        var store = new CollectionStore(_db);
        var second = (await store.CreateAsync(_owner, "Second", "SECOND", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var third = (await store.CreateAsync(_owner, "Third", "THIRD", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();

        var ids = await _db.CollectionShares.AsNoTracking()
            .Where(share => share.CollectionId == _collectionId || share.CollectionId == second || share.CollectionId == third)
            .Select(share => share.PublicId).ToListAsync();

        Assert.Equal(3, ids.Distinct().Count());
    }

    [Fact]
    public async Task ADuplicateNameStillFails_AndLeavesNeitherACollectionNorALink()
    {
        var before = await _db.CollectionShares.CountAsync();

        await Assert.ThrowsAsync<CollectionNameConflictException>(() =>
            new CollectionStore(_db).CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow));

        _db.ChangeTracker.Clear();
        Assert.Equal(before, await _db.CollectionShares.CountAsync());
    }

    [Fact]
    public async Task TheLinkAMemberPassesOn_IsTheSameOneTheOwnerHas()
    {
        var owner = (await _shares.GetActiveAsync(_owner, _collectionId))!;
        var member = await _memberLink.GetActivePublicIdAsync(_member, _collectionId);

        Assert.Equal(owner.PublicId, member);
    }

    [Fact]
    public async Task ARequestThroughALinkTheMemberPassedOn_LandsInTheOwnersWaitingList_ExactlyOnce()
    {
        var publicId = (await _memberLink.GetActivePublicIdAsync(_member, _collectionId))!;

        var first = await _join.RequestAsync(publicId, _stranger, DateTimeOffset.UtcNow);
        var again = await _join.RequestAsync(publicId, _stranger, DateTimeOffset.UtcNow);
        var other = await _join.RequestAsync(publicId, _otherStranger, DateTimeOffset.UtcNow);

        Assert.Equal(CollectionJoinStoreStatus.Requested, first.Status);
        Assert.Equal(CollectionJoinStoreStatus.AlreadyRequested, again.Status);
        Assert.Equal(CollectionJoinStoreStatus.Requested, other.Status);
        // Whoever passed the link on, the person asking goes to the OWNER of the Collection - no membership is created by asking.
        Assert.Equal(_owner, first.OwnerUserId);
        var waiting = await _join.ListPendingAsync(_collectionId, null, 50);
        Assert.Equal(2, waiting.Items.Count);
        Assert.False(await _db.CollectionCollaborators.AnyAsync(row => row.CollectionId == _collectionId && row.UserId == _stranger));
    }

    [Fact]
    public async Task AMemberAndTheOwner_AskingThroughTheLink_AreAlreadyInside_AndCreateNothing()
    {
        var publicId = (await _memberLink.GetActivePublicIdAsync(_member, _collectionId))!;

        Assert.Equal(CollectionJoinStoreStatus.AlreadyMember, (await _join.RequestAsync(publicId, _member, DateTimeOffset.UtcNow)).Status);
        Assert.Equal(CollectionJoinStoreStatus.AlreadyMember, (await _join.RequestAsync(publicId, _owner, DateTimeOffset.UtcNow)).Status);
        Assert.Empty((await _join.ListPendingAsync(_collectionId, null, 50)).Items);
    }

    [Fact]
    public async Task OnlyTheOwnerDecides_AMemberWhoPassedTheLinkOnCannotApprove()
    {
        var publicId = (await _memberLink.GetActivePublicIdAsync(_member, _collectionId))!;
        var request = await _join.RequestAsync(publicId, _stranger, DateTimeOffset.UtcNow);

        await Assert.ThrowsAsync<CollectionJoinRequestNotFoundException>(() =>
            _join.ApproveAsync(_member, _collectionId, request.RequestId, DateTimeOffset.UtcNow));
        Assert.False(await _db.CollectionCollaborators.AnyAsync(row => row.CollectionId == _collectionId && row.UserId == _stranger));

        var approved = await _join.ApproveAsync(_owner, _collectionId, request.RequestId, DateTimeOffset.UtcNow);
        Assert.Equal("viewer", approved.Role);
    }

    [Fact]
    public async Task ATurnedOnPublicLink_KeepsTheSameAddress_AndNeedsNoRequest()
    {
        var before = (await _memberLink.GetActivePublicIdAsync(_member, _collectionId))!;

        var enabled = await _shares.EnableAsync(_owner, _collectionId, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow);

        Assert.Equal(before, enabled.PublicId);
        Assert.True(enabled.IsPublic);
        Assert.Equal(CollectionJoinStoreStatus.NotAllowed, (await _join.RequestAsync(before, _stranger, DateTimeOffset.UtcNow)).Status);
    }

    [Fact]
    public async Task ARevokedLink_IsDead_AndRequestsThroughItAreUnavailable()
    {
        var publicId = (await _memberLink.GetActivePublicIdAsync(_member, _collectionId))!;
        await _shares.RevokeAsync(_owner, _collectionId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        Assert.Equal(CollectionJoinStoreStatus.Unavailable, (await _join.RequestAsync(publicId, _stranger, DateTimeOffset.UtcNow)).Status);
        Assert.Null(await _memberLink.GetActivePublicIdAsync(_member, _collectionId));
    }

    [Fact]
    public async Task TheOwnersLinkAndAMembersLink_AreTheSameAddress_AndBothReachTheOwnersList()
    {
        var ownerLink = (await _shares.GetActiveAsync(_owner, _collectionId))!.PublicId;
        var memberLink = (await _memberLink.GetActivePublicIdAsync(_member, _collectionId))!;
        Assert.Equal(ownerLink, memberLink);

        Assert.Equal(CollectionJoinStoreStatus.Requested, (await _join.RequestAsync(ownerLink, _stranger, DateTimeOffset.UtcNow)).Status);
        Assert.Equal(CollectionJoinStoreStatus.Requested, (await _join.RequestAsync(memberLink, _otherStranger, DateTimeOffset.UtcNow)).Status);
        var waiting = await _join.ListPendingAsync(_collectionId, null, 50);
        Assert.Equal(2, waiting.Items.Count);
        // The requester's own placeholder list shows the waiting request too.
        Assert.Single(await _join.ListMineAsync(_stranger));
    }

    [Fact]
    public async Task AnExistingCollectionWithoutAnyLink_GivesAMemberALinkThatReachesTheOwnersList()
    {
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM collections.CollectionShares WHERE CollectionId = {_collectionId}");
        _db.ChangeTracker.Clear();

        var link = await _memberLink.GetActivePublicIdAsync(_member, _collectionId);

        Assert.NotNull(link);
        Assert.Equal(CollectionJoinStoreStatus.Requested, (await _join.RequestAsync(link!, _stranger, DateTimeOffset.UtcNow)).Status);
        Assert.Single((await _join.ListPendingAsync(_collectionId, null, 50)).Items);
        Assert.False((await _shares.GetActiveAsync(_owner, _collectionId))!.IsPublic);
    }

    [Fact]
    public async Task WithSharingOn_ASavedPublicLink_MakesAViewerAtOnce_AndNeverAWaitingRequest()
    {
        var link = (await _shares.EnableAsync(_owner, _collectionId, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow)).PublicId;

        var saved = await _join.SavePublicAsync(link, _stranger, DateTimeOffset.UtcNow);

        Assert.Equal(CollectionJoinStoreStatus.Joined, saved.Status);
        Assert.Equal("viewer", saved.Role);
        Assert.Empty((await _join.ListPendingAsync(_collectionId, null, 50)).Items);
        // Already inside: asking again changes nothing.
        Assert.Equal(CollectionJoinStoreStatus.AlreadyMember, (await _join.SavePublicAsync(link, _stranger, DateTimeOffset.UtcNow)).Status);
    }

    [Fact]
    public async Task APendingRequester_AskingAgainThroughTheOwnersOrTheMembersLink_StaysOneRequest()
    {
        var ownerLink = (await _shares.GetActiveAsync(_owner, _collectionId))!.PublicId;
        var memberLink = (await _memberLink.GetActivePublicIdAsync(_member, _collectionId))!;

        await _join.RequestAsync(ownerLink, _stranger, DateTimeOffset.UtcNow);
        var again = await _join.RequestAsync(memberLink, _stranger, DateTimeOffset.UtcNow);

        Assert.Equal(CollectionJoinStoreStatus.AlreadyRequested, again.Status);
        Assert.Single((await _join.ListPendingAsync(_collectionId, null, 50)).Items);
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) => (await _db.Users.AsNoTracking().SingleAsync(user => user.Id == userId)).PublicCode;
}
