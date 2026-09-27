using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.SetCollectionFavorite;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// Per-user favorites, the Categories list scopes, participant summaries and display names -
/// against the real schema, through the same services/stores production wires together.
/// </summary>
public sealed class CollectionFavoritesAndParticipantsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _contributor;
    private long _secondContributor;
    private long _invitee;
    private long _stranger;
    private long _sharedId;
    private long _ownerPrivateId;
    private long _contributorOwnId;

    private CollectionStore _collections = null!;
    private CollectionCollaborationService _collaboration = null!;
    private SetCollectionFavoriteService _favorites = null!;
    private UserProfileService _profiles = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _contributor = await NewUserAsync();
        _secondContributor = await NewUserAsync();
        _invitee = await NewUserAsync();
        _stranger = await NewUserAsync();

        _collections = new CollectionStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _favorites = new SetCollectionFavoriteService(access, _collections, TimeProvider.System);
        _profiles = new UserProfileService(new UserProfileStore(_db), TimeProvider.System);

        var now = DateTimeOffset.UtcNow;
        _ownerPrivateId = (await _collections.CreateAsync(_owner, "Private", "PRIVATE", CollectionIcon.Folder, now.AddSeconds(-3))).Id;
        _contributorOwnId = (await _collections.CreateAsync(_contributor, "Mine", "MINE", CollectionIcon.Folder, now.AddSeconds(-2))).Id;
        _sharedId = (await _collections.CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, now.AddSeconds(-1))).Id;

        var itemStore = new ItemStore(_db);
        var ownerItem = await itemStore.SaveAsync(_owner, "https://example.test/owner", null, now);
        var contributorItem = await itemStore.SaveAsync(_contributor, "https://example.test/contributor", null, now);
        await _collections.AddAsync(_owner, _sharedId, ownerItem.Entry.Id, now);

        await InviteAndAcceptAsync(_sharedId, _contributor);
        await InviteAndAcceptAsync(_sharedId, _secondContributor);
        await _collections.AddAsync(_contributor, _sharedId, contributorItem.Entry.Id, now);
        // Pending only - never a participant.
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_invitee));

        await _profiles.SetDisplayNameAsync(_owner, "피카츄");
        await _profiles.SetDisplayNameAsync(_contributor, "파이리");
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

    // ---------- favorites ----------

    [Fact]
    public async Task OwnerAndContributor_FavoriteIndependently_AndNeverSeeEachOthersMark()
    {
        await _favorites.SetFavoriteAsync(_contributor, _sharedId, new SetCollectionFavoriteCommand(true));

        Assert.True((await _collections.GetAsync(_contributor, _sharedId)).IsFavorite);
        Assert.False((await _collections.GetAsync(_owner, _sharedId)).IsFavorite);
        Assert.False((await _collections.GetAsync(_secondContributor, _sharedId)).IsFavorite);

        await _favorites.SetFavoriteAsync(_owner, _sharedId, new SetCollectionFavoriteCommand(true));
        await _favorites.SetFavoriteAsync(_contributor, _sharedId, new SetCollectionFavoriteCommand(false));

        Assert.True((await _collections.GetAsync(_owner, _sharedId)).IsFavorite);
        Assert.False((await _collections.GetAsync(_contributor, _sharedId)).IsFavorite);
    }

    [Fact]
    public async Task WithoutAccess_FavoriteIsNotFound_AndLeavesNoRow()
    {
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => _favorites.SetFavoriteAsync(_stranger, _sharedId, new SetCollectionFavoriteCommand(true)));
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => _favorites.SetFavoriteAsync(_invitee, _sharedId, new SetCollectionFavoriteCommand(true)));
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => _collections.SetFavoriteAsync(_stranger, _sharedId, true, DateTimeOffset.UtcNow));

        Assert.False(await _db.CollectionFavorites.AnyAsync(favorite => favorite.UserId == _stranger || favorite.UserId == _invitee));
    }

    [Fact]
    public async Task RemovingACollaborator_RemovesTheirFavoriteMark_ButNotAnyoneElses()
    {
        await _favorites.SetFavoriteAsync(_contributor, _sharedId, new SetCollectionFavoriteCommand(true));
        await _favorites.SetFavoriteAsync(_secondContributor, _sharedId, new SetCollectionFavoriteCommand(true));

        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, await JupleIdOfAsync(_contributor));

        Assert.False(await _db.CollectionFavorites.AnyAsync(favorite => favorite.UserId == _contributor && favorite.CollectionId == _sharedId));
        Assert.True(await _db.CollectionFavorites.AnyAsync(favorite => favorite.UserId == _secondContributor && favorite.CollectionId == _sharedId));
        Assert.DoesNotContain(
            (await _collections.ListByScopeAsync(_contributor, CollectionListScope.Favorites, null, null, null, 50)).Items,
            collection => collection.Id == _sharedId);
    }

    [Fact]
    public async Task AccountDeletion_ClearsTheUsersOwnMarks_AndMarksOnTheirCollectionsCascade()
    {
        await _favorites.SetFavoriteAsync(_contributor, _sharedId, new SetCollectionFavoriteCommand(true));
        await _favorites.SetFavoriteAsync(_contributor, _contributorOwnId, new SetCollectionFavoriteCommand(true));
        await _favorites.SetFavoriteAsync(_secondContributor, _sharedId, new SetCollectionFavoriteCommand(true));

        // The Contributor deleting their account never blocks on their marks.
        await new AccountDeletionStore(_db).DeleteAllDataAsync(_contributor, $"test/{_contributor}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_contributor);
        Assert.False(await _db.CollectionFavorites.AnyAsync(favorite => favorite.UserId == _contributor));

        // The Owner deleting theirs removes the Collection and everyone's marks on it.
        await new AccountDeletionStore(_db).DeleteAllDataAsync(_owner, $"test/{_owner}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_owner);
        Assert.False(await _db.CollectionFavorites.AnyAsync(favorite => favorite.CollectionId == _sharedId));
    }

    // ---------- list scopes ----------

    [Fact]
    public async Task Scopes_SplitByServerRole_OneOrdering_AndReportTheCallersOwnFavorite()
    {
        await _favorites.SetFavoriteAsync(_contributor, _sharedId, new SetCollectionFavoriteCommand(true));

        var all = (await _collections.ListByScopeAsync(_contributor, CollectionListScope.All, null, null, null, 50)).Items;
        var owned = (await _collections.ListByScopeAsync(_contributor, CollectionListScope.Owned, null, null, null, 50)).Items;
        var shared = (await _collections.ListByScopeAsync(_contributor, CollectionListScope.Shared, null, null, null, 50)).Items;
        var favorites = (await _collections.ListByScopeAsync(_contributor, CollectionListScope.Favorites, null, null, null, 50)).Items;

        // Newest first across owned and shared rows alike (Trip was created after Mine).
        Assert.Equal([_sharedId, _contributorOwnId], all.Select(collection => collection.Id));
        Assert.Equal([_contributorOwnId], owned.Select(collection => collection.Id));
        Assert.Equal([_sharedId], shared.Select(collection => collection.Id));
        Assert.Equal([_sharedId], favorites.Select(collection => collection.Id));

        var trip = all.Single(collection => collection.Id == _sharedId);
        Assert.Equal(CollectionDtoAccessRoles.Contributor, trip.AccessRole);
        Assert.True(trip.IsFavorite);
        Assert.Equal(2, trip.ItemCount); // every active Item, whoever added it
        Assert.Equal("피카츄", trip.OwnerDisplayName);
        Assert.Equal(CollectionDtoAccessRoles.Owner, all.Single(collection => collection.Id == _contributorOwnId).AccessRole);

        // The Owner's own view of the same Collection: not a favorite for them, owner role.
        var ownerTrip = (await _collections.ListByScopeAsync(_owner, CollectionListScope.All, null, null, null, 50)).Items
            .Single(collection => collection.Id == _sharedId);
        Assert.Equal(CollectionDtoAccessRoles.Owner, ownerTrip.AccessRole);
        Assert.False(ownerTrip.IsFavorite);
        Assert.Empty((await _collections.ListByScopeAsync(_owner, CollectionListScope.Favorites, null, null, null, 50)).Items);
    }

    [Fact]
    public async Task AllScope_PagesAcrossOwnedAndSharedRows_WithoutDuplicatesOrGaps()
    {
        var first = await _collections.ListByScopeAsync(_contributor, CollectionListScope.All, null, null, null, 1);
        var second = await _collections.ListByScopeAsync(_contributor, CollectionListScope.All, null, null, first.NextCursor, 1);

        Assert.Equal(_sharedId, Assert.Single(first.Items).Id);
        Assert.Equal(_contributorOwnId, Assert.Single(second.Items).Id);
        Assert.Null(second.NextCursor);
    }

    // ---------- participants ----------

    [Fact]
    public async Task CardSummary_ShowsOtherParticipantsOnly_OwnerFirst_PendingExcluded()
    {
        var contributorView = await _collections.GetAsync(_contributor, _sharedId);
        Assert.Equal(2, contributorView.OtherParticipantCount); // Owner + the second Contributor
        Assert.Equal(
            [("피카츄", CollectionDtoAccessRoles.Owner), ((string?)null, CollectionDtoAccessRoles.Contributor)],
            contributorView.ParticipantPreview!.Select(participant => (participant.DisplayName, participant.Role)));
        Assert.Equal(await JupleIdOfAsync(_secondContributor), contributorView.ParticipantPreview![1].JupleId);

        var ownerView = await _collections.GetAsync(_owner, _sharedId);
        Assert.Equal(2, ownerView.OtherParticipantCount); // both Contributors, never the pending invitee
        Assert.Equal("파이리", ownerView.ParticipantPreview![0].DisplayName);

        // A Collection without collaborators has no summary at all.
        var privateView = await _collections.GetAsync(_owner, _ownerPrivateId);
        Assert.Null(privateView.ParticipantPreview);
        Assert.Equal(0, privateView.OtherParticipantCount);
    }

    [Fact]
    public async Task ParticipantList_IsVisibleToContributors_ReadOnly_AndOnlyTheOwnerSeesPendingInvitations()
    {
        var ownerView = await _collaboration.GetParticipantsAsync(_owner, _sharedId);
        Assert.True(ownerView.CanManage);
        Assert.Equal(3, ownerView.Participants.Count);
        Assert.True(ownerView.Participants[0].IsMe);
        Assert.Equal(CollectionDtoAccessRoles.Owner, ownerView.Participants[0].Role);
        Assert.Equal(await JupleIdOfAsync(_invitee), Assert.Single(ownerView.PendingInvitations).JupleId);

        var contributorView = await _collaboration.GetParticipantsAsync(_contributor, _sharedId);
        Assert.False(contributorView.CanManage);
        Assert.Empty(contributorView.PendingInvitations);
        Assert.Equal(["피카츄", "파이리", null], contributorView.Participants.Select(participant => participant.DisplayName));
        Assert.True(contributorView.Participants.Single(participant => participant.DisplayName == "파이리").IsMe);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collaboration.GetParticipantsAsync(_stranger, _sharedId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collaboration.GetParticipantsAsync(_invitee, _sharedId));
    }

    [Fact]
    public async Task RemovedCollaborator_DisappearsFromParticipantsAndSummary()
    {
        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, await JupleIdOfAsync(_secondContributor));

        Assert.Equal(2, (await _collaboration.GetParticipantsAsync(_owner, _sharedId)).Participants.Count);
        var summary = await _collections.GetAsync(_contributor, _sharedId);
        Assert.Equal(1, summary.OtherParticipantCount);
        Assert.Equal(CollectionDtoAccessRoles.Owner, Assert.Single(summary.ParticipantPreview!).Role);
    }

    // ---------- display name ----------

    [Fact]
    public async Task DisplayName_IsSetTrimmedClearedAndNotUnique_AndReachesInvitationsAndLookup()
    {
        Assert.Equal(new UserProfileDto("피카츄", await JupleIdOfAsync(_owner)), await _profiles.GetAsync(_owner));

        // Duplicates are fine - it is not an identifier.
        Assert.Equal("피카츄", (await _profiles.SetDisplayNameAsync(_stranger, "  피카츄  ")).DisplayName);

        var lookup = await _collaboration.LookupAsync(_owner, await JupleIdOfAsync(_contributor));
        Assert.Equal("파이리", lookup.DisplayName);

        var received = Assert.Single(await _collaboration.ListReceivedInvitationsAsync(_invitee));
        Assert.Equal("피카츄", received.OwnerDisplayName);
        Assert.Equal(await JupleIdOfAsync(_owner), received.OwnerJupleId);

        await Assert.ThrowsAsync<InvalidDisplayNameException>(() => _profiles.SetDisplayNameAsync(_owner, "two\nlines"));
        Assert.Equal("피카츄", (await _profiles.GetAsync(_owner)).DisplayName);

        Assert.Null((await _profiles.SetDisplayNameAsync(_owner, "")).DisplayName);
        Assert.Null((await _collections.GetAsync(_contributor, _sharedId)).OwnerDisplayName);
    }

    [Fact]
    public async Task DisplayName_EveryMaxValidValue_IsActuallyStorable_AndRoundTripsExactly()
    {
        var family = "\U0001F468\u200D\U0001F469\u200D\U0001F467";
        var stacked = (int marks) => "e" + new string('\u0301', marks);
        foreach (var value in new[]
                 {
                     string.Concat(Enumerable.Repeat("가", UserDisplayName.MaxTextElements)),
                     string.Concat(Enumerable.Repeat(family, UserDisplayName.MaxTextElements)),
                     string.Concat(Enumerable.Repeat(stacked(16), 29)) + stacked(18), // exactly 512 units
                 })
        {
            Assert.True(UserDisplayName.TryNormalize(value, out _, out _));
            Assert.Equal(value, (await _profiles.SetDisplayNameAsync(_stranger, value)).DisplayName);
            _db.ChangeTracker.Clear();
            Assert.Equal(value, (await _profiles.GetAsync(_stranger)).DisplayName);
        }
    }

    // ---------- helpers ----------

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task InviteAndAcceptAsync(long collectionId, long inviteeId)
    {
        var invitation = await _collaboration.InviteAsync(_owner, collectionId, await JupleIdOfAsync(inviteeId));
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();
}
