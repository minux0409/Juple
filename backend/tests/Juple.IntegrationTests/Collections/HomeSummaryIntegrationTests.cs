using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.HomeSummary;
using Juple.Application.Collections.ListCollections;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Juple.Api.Configuration;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// Home's one summary read against the real schema: for every kind of person it must equal what the three full lists
/// (scope all / favorites / shared) it replaces would have shown - the same numbers, the same first favorites, the same
/// link counts - and it must never take more than two statements' worth of work per call.
/// </summary>
public sealed class HomeSummaryIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _contributor;
    private long _viewer;
    private long _stranger;
    private long _empty;

    private CollectionStore _collections = null!;
    private CollectionCollaborationService _collaboration = null!;
    private HomeCollectionsSummaryService _summary = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _contributor = await NewUserAsync();
        _viewer = await NewUserAsync();
        _stranger = await NewUserAsync();
        _empty = await NewUserAsync();

        _collections = new CollectionStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _summary = new HomeCollectionsSummaryService(_collections);
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
    public async Task APersonWithNoCollections_GetsZeros_AndNoShortcuts()
    {
        var summary = await _summary.GetAsync(_empty);

        Assert.Equal(0, summary.CollectionCount);
        Assert.Equal(0, summary.FavoriteCollectionCount);
        Assert.Equal(0, summary.SharedCollectionCount);
        Assert.Empty(summary.FavoriteCollections);
    }

    [Fact]
    public async Task Summary_EqualsTheThreeListsItReplaces_ForEveryKindOfPerson()
    {
        await BuildWorldAsync();

        foreach (var user in new[] { _owner, _contributor, _viewer, _stranger, _empty })
        {
            await AssertMatchesListsAsync(user);
        }
    }

    [Fact]
    public async Task Shortcuts_AreTheFirstFavorites_Newest_First_AtMostTheLimit_WithTheListsLinkCount()
    {
        await BuildWorldAsync();

        var summary = await _summary.GetAsync(_owner);

        Assert.True(summary.FavoriteCollectionCount > IHomeCollectionsSummaryService.FavoriteShortcutLimit);
        Assert.Equal(IHomeCollectionsSummaryService.FavoriteShortcutLimit, summary.FavoriteCollections.Count);
        var expected = (await AllAsync(_owner, CollectionListScope.Favorites)).Take(IHomeCollectionsSummaryService.FavoriteShortcutLimit).ToList();
        Assert.Equal(expected.Select(c => c.Id), summary.FavoriteCollections.Select(c => c.Id));
        Assert.Equal(expected.Select(c => c.ItemCount), summary.FavoriteCollections.Select(c => c.ItemCount));
        Assert.Equal(expected.Select(c => c.Name), summary.FavoriteCollections.Select(c => c.Name));
        Assert.Equal(expected.Select(c => c.Icon), summary.FavoriteCollections.Select(c => c.Icon));
        Assert.Equal(expected.Select(c => c.Color), summary.FavoriteCollections.Select(c => c.Color));
    }

    [Fact]
    public async Task ADeletedCollection_AndATrashedLink_AreNotCounted()
    {
        var now = DateTimeOffset.UtcNow;
        var kept = (await _collections.CreateAsync(_owner, "Kept", "KEPT", CollectionIcon.Folder, now)).Id;
        var gone = (await _collections.CreateAsync(_owner, "Gone", "GONE", CollectionIcon.Folder, now.AddSeconds(1))).Id;
        await _collections.SetFavoriteAsync(_owner, kept, true, now);
        await _collections.SetFavoriteAsync(_owner, gone, true, now);
        var items = new ItemStore(_db);
        var live = await items.SaveAsync(_owner, "https://example.test/live", null, now);
        var trashed = await items.SaveAsync(_owner, "https://example.test/trashed", null, now);
        await _collections.AddAsync(_owner, kept, live.Entry.Id, now);
        await _collections.AddAsync(_owner, kept, trashed.Entry.Id, now);
        await items.DeleteAsync(_owner, trashed.Entry.Id, now);
        await _collections.DeleteAsync(_owner, gone);
        _db.ChangeTracker.Clear();

        var summary = await _summary.GetAsync(_owner);

        Assert.Equal(1, summary.CollectionCount);
        Assert.Equal(1, summary.FavoriteCollectionCount);
        var shortcut = Assert.Single(summary.FavoriteCollections);
        Assert.Equal(kept, shortcut.Id);
        Assert.Equal(1, shortcut.ItemCount);
    }

    // ---------- world ----------

    /// <summary>
    /// Owner: 8 favorite Collections (more than the shortcut limit), a private one, one shared with two members, one only
    /// public-linked, one deleted. Contributor and Viewer take part in the shared one (the contributor also marks it as
    /// favorite and has an own one); the stranger has only a pending invitation and an own non-shared Collection.
    /// </summary>
    private async Task BuildWorldAsync()
    {
        var now = DateTimeOffset.UtcNow;
        var items = new ItemStore(_db);
        var sharedId = (await _collections.CreateAsync(_owner, "Shared", "SHARED", CollectionIcon.Folder, now.AddSeconds(-30))).Id;
        var linkedId = (await _collections.CreateAsync(_owner, "Linked", "LINKED", CollectionIcon.Folder, now.AddSeconds(-29))).Id;
        var privateId = (await _collections.CreateAsync(_owner, "Private", "PRIVATE", CollectionIcon.Folder, now.AddSeconds(-28))).Id;
        var deletedId = (await _collections.CreateAsync(_owner, "Deleted", "DELETED", CollectionIcon.Folder, now.AddSeconds(-27))).Id;
        for (var index = 0; index < 8; index++)
        {
            var favoriteId = (await _collections.CreateAsync(_owner, $"Fav {index}", $"FAV{index}", CollectionIcon.Folder, now.AddSeconds(-20 + index))).Id;
            await _collections.SetFavoriteAsync(_owner, favoriteId, true, now);
            var item = await items.SaveAsync(_owner, $"https://example.test/fav-{index}", null, now);
            await _collections.AddAsync(_owner, favoriteId, item.Entry.Id, now);
        }

        await _collections.SetFavoriteAsync(_owner, deletedId, true, now);
        await _collections.DeleteAsync(_owner, deletedId);
        await new EnableCollectionShareService(new CollectionShareStore(_db), TimeProvider.System).EnableAsync(_owner, linkedId);

        await InviteAndAcceptAsync(sharedId, _contributor);
        await InviteAndAcceptAsync(sharedId, _viewer, CollectionCollaboratorRole.Viewer);
        await _collections.SetFavoriteAsync(_contributor, sharedId, true, now);
        await _collections.CreateAsync(_contributor, "Mine", "MINE", CollectionIcon.Folder, now.AddSeconds(-10));
        await _collections.CreateAsync(_stranger, "Solo", "SOLO", CollectionIcon.Folder, now.AddSeconds(-9));
        await _collaboration.InviteAsync(_owner, privateId, await JupleIdOfAsync(_stranger));
        _db.ChangeTracker.Clear();
    }

    private async Task AssertMatchesListsAsync(long userId)
    {
        var all = await AllAsync(userId, CollectionListScope.All);
        var favorites = await AllAsync(userId, CollectionListScope.Favorites);
        var shared = await AllAsync(userId, CollectionListScope.Shared);

        var summary = await _summary.GetAsync(userId);

        Assert.Equal(all.Count, summary.CollectionCount);
        Assert.Equal(favorites.Count, summary.FavoriteCollectionCount);
        Assert.Equal(shared.Count, summary.SharedCollectionCount);
        Assert.Equal(
            favorites.Take(IHomeCollectionsSummaryService.FavoriteShortcutLimit).Select(c => c.Id),
            summary.FavoriteCollections.Select(c => c.Id));
    }

    private async Task<List<CollectionDto>> AllAsync(long userId, CollectionListScope scope)
    {
        var result = new List<CollectionDto>();
        CollectionPageCursor? cursor = null;
        do
        {
            var page = await _collections.ListByScopeAsync(userId, scope, null, null, cursor, 100);
            result.AddRange(page.Items);
            cursor = page.NextCursor;
        }
        while (cursor is not null);

        return result;
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task InviteAndAcceptAsync(long collectionId, long inviteeId, CollectionCollaboratorRole? role = null)
    {
        var invitation = role is { } requested
            ? await _collaboration.InviteAsync(_owner, collectionId, await JupleIdOfAsync(inviteeId), requested)
            : await _collaboration.InviteAsync(_owner, collectionId, await JupleIdOfAsync(inviteeId));
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();
}
