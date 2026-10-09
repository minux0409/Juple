using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.ShareLink;
using Juple.Application.Push;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// 컬렉션 링크 공유 (a member passes the canonical link on): works for a PRIVATE link as well as a public one, never sends it to someone who
/// already belongs (Owner, member) or holds a pending invitation - decided by the server under the Collection lock, so a stale picker cannot
/// override it - and the resulting notification opens the same share resolver (it carries the link's publicId, not a Collection id).
/// </summary>
public sealed class CollectionLinkShareIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _invited;
    private long _friend;
    private long _collectionId;
    private string _publicId = null!;
    private CollectionAccessService _access = null!;
    private EnableCollectionShareService _shares = null!;
    private CollectionCollaborationService _collaboration = null!;
    private readonly RecordingPushSender _sender = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run these integration tests.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _invited = await NewUserAsync();
        _friend = await NewUserAsync();
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _shares = new EnableCollectionShareService(new CollectionShareStore(_db), TimeProvider.System);
        _collaboration = new CollectionCollaborationService(_access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);

        _collectionId = (await new CollectionStore(_db).CreateAsync(_owner, "게임", "게임", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        _publicId = (await _shares.MakePrivateAsync(_owner, _collectionId)).PublicId; // a PRIVATE link
        _db.ChangeTracker.Clear();
        await InviteAsync(_member, accept: true);
        await InviteAsync(_invited, accept: false);
        await new PushDeviceRegistrationStore(_db).RegisterAsync(
            _friend, PushPlatform.Android, Guid.NewGuid().ToString("N"), "t-" + Guid.NewGuid().ToString("N"), "ko", DateTimeOffset.UtcNow);
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

    private ShareCollectionLinkService Service() =>
        new(_access, new UserDirectoryStore(_db), new CollectionLinkShareStore(_db), TimeProvider.System);

    private async Task<string> CodeOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private async Task InviteAsync(long userId, bool accept)
    {
        var invitation = await _collaboration.InviteAsync(_owner, _collectionId, await CodeOfAsync(userId), CollectionCollaboratorRole.Viewer);
        if (accept)
        {
            await _collaboration.AcceptInvitationAsync(userId, invitation.InvitationId);
        }

        _db.ChangeTracker.Clear();
    }

    private Task<int> LinkEventsToAsync(long userId) =>
        _db.NotificationEvents.AsNoTracking().CountAsync(entry => entry.Type == NotificationType.CollectionLinkShared && entry.RecipientUserId == userId);

    [Fact]
    public async Task AMemberCanPassOnAPrivateLink_ToAFriendWhoIsNotInside()
    {
        var result = await Service().ShareAsync(_member, _collectionId, [await CodeOfAsync(_friend)]);

        Assert.Equal([await CodeOfAsync(_friend)], result.Sent);
        Assert.Empty(result.Skipped!);
        Assert.Equal(1, await LinkEventsToAsync(_friend));
    }

    [Fact]
    public async Task TheLinkIsNeverSentToTheOwnerAMemberOrAPendingInvitee_AStalePickerCannotOverrideIt()
    {
        var codes = new[] { await CodeOfAsync(_owner), await CodeOfAsync(_invited), await CodeOfAsync(_friend) };

        var result = await Service().ShareAsync(_member, _collectionId, codes);

        Assert.Equal([await CodeOfAsync(_friend)], result.Sent);
        Assert.Equal(new[] { codes[0], codes[1] }.Order(), result.Skipped!.Order());
        Assert.Equal(0, await LinkEventsToAsync(_owner));
        Assert.Equal(0, await LinkEventsToAsync(_invited));
        Assert.Equal(1, await LinkEventsToAsync(_friend));

        // The Owner sending to the member (already in) is skipped as well.
        var ownerSend = await Service().ShareAsync(_owner, _collectionId, [await CodeOfAsync(_member)]);
        Assert.Empty(ownerSend.Sent);
        Assert.Equal([await CodeOfAsync(_member)], ownerSend.Skipped!);
        Assert.Equal(0, await LinkEventsToAsync(_member));
    }

    [Fact]
    public async Task WithoutAnyActiveLink_NothingIsSent()
    {
        await new CollectionShareStore(_db).RevokeAsync(_owner, _collectionId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        var friendCode = await CodeOfAsync(_friend);
        var conflict = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => Service().ShareAsync(_member, _collectionId, [friendCode]));

        Assert.Equal(CollectionCollaborationConflictException.PublicLinkInactive, conflict.Code);
        Assert.Equal(0, await LinkEventsToAsync(_friend));
    }

    [Fact]
    public async Task TheNotificationOfAPrivateLink_CarriesTheLinksPublicId_SoItOpensTheSameResolverAsAnyShareLink()
    {
        await Service().ShareAsync(_member, _collectionId, [await CodeOfAsync(_friend)]);

        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.Dispatcher(_db, _sender).RunOnceAsync();
        _db.ChangeTracker.Clear();

        var push = Assert.Single(_sender.SentTo(_friend), sent => sent.Payload.Type == "collectionLinkShared");
        Assert.Equal(_publicId, push.Payload.Data["publicId"]);
        Assert.False(push.Payload.Data.ContainsKey("collectionId"));
    }

    [Fact]
    public async Task APrivateNonMember_CannotReadAnythingThroughThePublicEndpoints_ButTheLinkStateExistsForTheParticipationPreview()
    {
        var store = new PublicCollectionStore(_db);

        Assert.Null(await store.GetStateAsync(_publicId));
        Assert.Null(await store.GetItemsAsync(_publicId, null, 20));
        var link = (await store.GetLinkStateAsync(_publicId))!;
        Assert.False(link.IsPublic);
        Assert.Equal("Folder", link.Icon);
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
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
