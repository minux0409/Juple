using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Domain.Collections;
using Juple.Domain.Images;
using Juple.Domain.Users;
using Juple.Infrastructure.Billing;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Juple.IntegrationTests.TestSupport;

namespace Juple.IntegrationTests.Billing;

/// <summary>
/// The retention deletion dry-run (counts only) against the real schema: another owner's Collection is never in the plan, an owned
/// Collection with members is kept, and links that other people see are kept. The plan writes nothing.
/// </summary>
public sealed class DataRetentionDeletionPlanIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    public async Task InitializeAsync()
    {
        var connectionString = LocalRetentionEnvironment.RequireConnectionString();
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
    }

    public async Task DisposeAsync()
    {
        if (_db is null) return;
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.DisposeAsync();
    }

    [Fact]
    public async Task ThePlan_KeepsSharedCollectionsWithMembersAndLinksOthersSee_AndNeverIncludesAnotherOwnersCollection()
    {
        var expired = await NewUserAsync();
        var friend = await NewUserAsync();

        var collections = new CollectionStore(_db);
        var access = new CollectionAccessService(new CollectionAccessStore(_db), new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)),
        })), TimeProvider.System);
        var collaboration = new CollectionCollaborationService(access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        var add = new AddItemToCollectionService(access, collections, TimeProvider.System);

        var privateCollection = (await collections.CreateAsync(expired, "Alone", "ALONE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var sharedOwned = (await collections.CreateAsync(expired, "With friend", "WITH FRIEND", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var friendsCollection = (await collections.CreateAsync(friend, "Friend's", "FRIEND'S", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await InviteAndAcceptAsync(collaboration, expired, sharedOwned, friend);
        await InviteAndAcceptAsync(collaboration, friend, friendsCollection, expired);

        var onlyPrivate = await NewItemAsync(expired, "https://example.test/only-private", withPhoto: true);
        var inSharedOwned = await NewItemAsync(expired, "https://example.test/in-shared-owned", withPhoto: true);
        var inFriends = await NewItemAsync(expired, "https://example.test/in-friends", withPhoto: false);
        var loose = await NewItemAsync(expired, "https://example.test/loose", withPhoto: false);
        var friendsOwn = await NewItemAsync(friend, "https://example.test/friend", withPhoto: true);
        await add.AddAsync(expired, privateCollection, onlyPrivate);
        await add.AddAsync(expired, sharedOwned, inSharedOwned);
        await add.AddAsync(expired, friendsCollection, inFriends);
        await add.AddAsync(friend, friendsCollection, friendsOwn);
        (await _db.Items.SingleAsync(item => item.Id == loose)).SoftDelete(DateTimeOffset.UtcNow);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        var before = await SnapshotAsync();

        var plan = await new DataRetentionDeletionPlanner(_db).PlanAsync(expired);

        Assert.Equal(new Juple.Application.Billing.DataRetentionDeletionPlan(
            LinksToDelete: 2,              // only-private and the trashed loose link
            LinksKeptForOthers: 2,         // in the owned Collection with a member, and in the friend's Collection
            PhotosToDelete: 1,
            PhotosOfKeptLinksToClear: 1,
            CollectionsToDelete: 1,        // "Alone"
            CollectionsKeptWithMembers: 1), plan);
        Assert.Equal(before, await SnapshotAsync());

        // The friend's own plan never counts the expired person's links in the friend's Collection.
        var friendsPlan = await new DataRetentionDeletionPlanner(_db).PlanAsync(friend);
        Assert.Equal((0, 1, 0, 1, 0, 1), (friendsPlan.LinksToDelete, friendsPlan.LinksKeptForOthers, friendsPlan.PhotosToDelete, friendsPlan.PhotosOfKeptLinksToClear, friendsPlan.CollectionsToDelete, friendsPlan.CollectionsKeptWithMembers));
    }

    private async Task<(int Items, int Images, int Collections, int Memberships)> SnapshotAsync() =>
        (await _db.Items.CountAsync(item => _userIds.Contains(item.UserId)),
         await _db.ItemImages.CountAsync(image => _db.Items.Any(item => item.Id == image.ItemId && _userIds.Contains(item.UserId))),
         await _db.Collections.CountAsync(collection => _userIds.Contains(collection.UserId)),
         await _db.CollectionItems.CountAsync(membership => _userIds.Contains(membership.AddedByUserId)));

    private static async Task InviteAndAcceptAsync(CollectionCollaborationService collaboration, long ownerId, long collectionId, long inviteeId)
    {
        var invitation = await collaboration.InviteAsync(ownerId, collectionId, await collaboration.GetMyJupleIdAsync(inviteeId));
        await collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewItemAsync(long userId, string url, bool withPhoto)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        if (withPhoto)
        {
            _db.ItemImages.Add(new ItemImage(saved.Entry.Id, $"items/{userId}/{saved.Entry.Id}/{Guid.NewGuid():N}.main.webp", "image/webp", 10, 0, DateTimeOffset.UtcNow));
            await _db.SaveChangesAsync();
        }

        return saved.Entry.Id;
    }
}
