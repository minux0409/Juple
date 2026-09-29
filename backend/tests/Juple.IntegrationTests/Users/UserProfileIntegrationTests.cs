using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Friends;
using Juple.Application.Images;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Friends;
using Juple.Infrastructure.Images;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Users;

/// <summary>
/// Profile photo and nickname policy against the real schema: the row lifecycle, that every
/// people-list DTO carries the photo from the same query that already reads the person (no per-row
/// profile lookups), that a pre-existing nickname is never rewritten, and - against Azurite - that
/// the photo Blob sits inside the prefix account deletion already cleans up.
/// </summary>
public sealed class UserProfileIntegrationTests : IAsyncLifetime
{
    private static readonly byte[] PngBytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];

    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _alice;
    private long _bob;
    private RecordingProfileImageStorage _storage = null!;
    private UserProfileService _profiles = null!;
    private FriendService _friends = null!;
    private CollectionCollaborationService _collaboration = null!;
    private CollectionStore _collections = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _alice = await NewUserAsync();
        _bob = await NewUserAsync();

        _storage = new RecordingProfileImageStorage();
        var directory = new UserDirectoryStore(_db);
        _profiles = new UserProfileService(new UserProfileStore(_db), TimeProvider.System, _storage);
        _friends = new FriendService(directory, new FriendStore(_db, _storage), TimeProvider.System);
        _collections = new CollectionStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            access, directory, new CollectionCollaborationStore(_db, _storage), TimeProvider.System, profileImageStorage: _storage);
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
    public async Task ProfileImage_UploadReplaceRemove_UpdatesTheRow_AndCleansUpOnlyReplacedBlobs()
    {
        var first = await _profiles.SetProfileImageAsync(_alice, PngBytes);
        var firstBlob = await BlobOfAsync(_alice);
        Assert.StartsWith($"items/{_alice}/profile/", firstBlob);
        Assert.Equal(UserProfileImageVersion.From(firstBlob!), first.ProfileImageVersion);

        var second = await _profiles.SetProfileImageAsync(_alice, PngBytes);
        var secondBlob = await BlobOfAsync(_alice);
        Assert.NotEqual(firstBlob, secondBlob);
        Assert.NotEqual(first.ProfileImageVersion, second.ProfileImageVersion);
        Assert.Equal([firstBlob!], _storage.Deleted);

        var removed = await _profiles.RemoveProfileImageAsync(_alice);
        Assert.Null(removed.ProfileImageUrl);
        Assert.Null(await BlobOfAsync(_alice));
        Assert.Equal([firstBlob!, secondBlob!], _storage.Deleted);

        // The other user's row is never touched.
        Assert.Null(await BlobOfAsync(_bob));
    }

    [Fact]
    public async Task ExistingNickname_ThatTheNewPolicyRejects_IsKeptAndReadable_UntilTheUserChangesIt()
    {
        // Written the way a pre-policy nickname already sits in the database.
        var user = await _db.Users.SingleAsync(entry => entry.Id == _alice);
        user.SetDisplayName("Juple Official", DateTimeOffset.UtcNow);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Equal("Juple Official", (await _profiles.GetAsync(_alice)).DisplayName);
        Assert.Equal("Juple Official", (await _collaboration.LookupAsync(_bob, await JupleIdOfAsync(_alice))).DisplayName);

        var rejected = await Assert.ThrowsAsync<InvalidDisplayNameException>(() => _profiles.SetDisplayNameAsync(_alice, "Juple Official"));
        Assert.Equal(NicknameErrorCodes.Reserved, rejected.Code);
        _db.ChangeTracker.Clear();
        Assert.Equal("Juple Official", (await _profiles.GetAsync(_alice)).DisplayName);

        Assert.Equal("앨리스", (await _profiles.SetDisplayNameAsync(_alice, "앨리스")).DisplayName);
    }

    [Fact]
    public async Task ProfilePhoto_ReachesEveryPeopleList_FromTheQueryThatAlreadyReadsThePerson()
    {
        await _profiles.SetProfileImageAsync(_alice, PngBytes);
        await _profiles.SetProfileImageAsync(_bob, PngBytes);
        var aliceVersion = UserProfileImageVersion.From((await BlobOfAsync(_alice))!);
        var bobVersion = UserProfileImageVersion.From((await BlobOfAsync(_bob))!);
        var bobJupleId = await JupleIdOfAsync(_bob);

        // Exact Juple ID lookup.
        var lookup = await _collaboration.LookupAsync(_alice, bobJupleId);
        Assert.Equal(bobVersion, lookup.ProfileImageVersion);
        Assert.NotNull(lookup.ProfileImageUrl);

        // Friend requests (both directions) and the accepted friend.
        var outgoing = await _friends.SendRequestAsync(_alice, bobJupleId);
        Assert.Equal(bobVersion, outgoing.ProfileImageVersion);
        var incoming = Assert.Single(await _friends.ListRequestsAsync(_bob));
        Assert.Equal(aliceVersion, incoming.ProfileImageVersion);
        var accepted = await _friends.AcceptAsync(_bob, incoming.RequestId);
        Assert.Equal(aliceVersion, accepted.ProfileImageVersion);
        var friend = Assert.Single((await _friends.ListFriendsAsync(_alice, null, null, 20)).Items);
        Assert.Equal(bobVersion, friend.ProfileImageVersion);

        // Collection invitation (Owner's pending list, invitee's received list) and participants.
        var collectionId = (await _collections.CreateAsync(_alice, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var invitation = await _collaboration.InviteAsync(_alice, collectionId, bobJupleId);
        Assert.Equal(bobVersion, invitation.ProfileImageVersion);
        Assert.Equal(bobVersion, Assert.Single((await _collaboration.GetOverviewAsync(_alice, collectionId)).PendingInvitations).ProfileImageVersion);
        var received = Assert.Single(await _collaboration.ListReceivedInvitationsAsync(_bob));
        Assert.Equal(aliceVersion, received.OwnerProfileImageVersion);

        await _collaboration.AcceptInvitationAsync(_bob, invitation.InvitationId);
        Assert.Equal(bobVersion, Assert.Single((await _collaboration.GetOverviewAsync(_alice, collectionId)).Collaborators).ProfileImageVersion);
        var participants = (await _collaboration.GetParticipantsAsync(_bob, collectionId)).Participants;
        Assert.Equal(aliceVersion, participants.Single(person => person.Role == "owner").ProfileImageVersion);
        Assert.Equal(bobVersion, participants.Single(person => person.IsMe).ProfileImageVersion);

        // A person without a photo is simply "no photo" - never another person's.
        await _profiles.RemoveProfileImageAsync(_bob);
        var afterRemoval = (await _collaboration.GetParticipantsAsync(_alice, collectionId)).Participants.Single(person => !person.IsMe);
        Assert.Null(afterRemoval.ProfileImageUrl);
        Assert.Null(afterRemoval.ProfileImageVersion);
    }

    [Fact]
    public async Task ProfilePhotoBlob_OnAzurite_IsSignedOnlyForItsOwner_AndIsRemovedByTheAccountDeletionPrefix()
    {
        var container = TestBlobContainerClientFactory.Create();
        var store = new ItemImageStore(
            _db, TestBlobContainerClientFactory.Service, container,
            TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

        var blobName = await store.UploadProfileImageAsync(_alice, ImageFormat.Png, PngBytes);
        Assert.StartsWith($"items/{_alice}/profile/", blobName);
        Assert.EndsWith(".png", blobName);
        Assert.True(await container.GetBlobClient(blobName).ExistsAsync());

        Assert.NotNull(await store.CreateProfileImageReadUrlAsync(_alice, blobName));
        // Another user's id with this name is never signed, and never deletes it.
        Assert.Null(await store.CreateProfileImageReadUrlAsync(_bob, blobName));
        await store.DeleteProfileImageAsync(_bob, blobName);
        Assert.True(await container.GetBlobClient(blobName).ExistsAsync());

        // Exactly the prefix DeleteAccountService registers for cleanup.
        Assert.StartsWith(store.GetUserBlobPrefix(_alice), blobName);
        Assert.True(await store.DeleteBlobsByPrefixAsync(store.GetUserBlobPrefix(_alice)));
        Assert.False(await container.GetBlobClient(blobName).ExistsAsync());
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<string?> BlobOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.ProfileImageBlobName).SingleAsync();

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    /// <summary>No Blob I/O - names like the real store, signs every call with a new URL.</summary>
    private sealed class RecordingProfileImageStorage : IUserProfileImageStorage
    {
        private int signCount;

        public List<string> Deleted { get; } = [];

        public Task<string> UploadProfileImageAsync(long userId, ImageFormat format, byte[] content, CancellationToken cancellationToken = default) =>
            Task.FromResult($"items/{userId}/profile/{Guid.NewGuid():N}.png");

        public Task DeleteProfileImageAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            Deleted.Add(blobName);
            return Task.CompletedTask;
        }

        public Task<Uri?> CreateProfileImageReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(new Uri($"https://blob.example/{blobName}?sig={Interlocked.Increment(ref signCount)}"));
    }
}
