using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Images;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// The Collection Details link search (GET collections/{id}/items?q=) against the real schema: only this Collection's
/// links, matched on title or link only (never a memo - not even the caller's own, and never another member's), trash
/// excluded, newest added first and paged by the same keyset cursor without duplicates or gaps, behind the list's own
/// access and lock gates.
/// </summary>
public sealed class CollectionItemSearchIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Now = new(2026, 10, 6, 0, 0, 0, TimeSpan.Zero);

    private JupleDbContext _db = null!;
    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private long _owner;
    private long _other;
    private long _stranger;
    private long _searchedId;
    private long _neighbourId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _collections = new CollectionStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);

        var owner = new User("ko-KR", "Asia/Seoul", null, Now, Now);
        var other = new User("ko-KR", "Asia/Seoul", null, Now, Now);
        var stranger = new User("ko-KR", "Asia/Seoul", null, Now, Now);
        _db.Users.AddRange(owner, other, stranger);
        await _db.SaveChangesAsync();
        (_owner, _other, _stranger) = (owner.Id, other.Id, stranger.Id);

        _searchedId = (await _collections.CreateAsync(_owner, "Searched", "SEARCHED", CollectionIcon.Folder, Now.AddSeconds(-2))).Id;
        _neighbourId = (await _collections.CreateAsync(_owner, "Neighbour", "NEIGHBOUR", CollectionIcon.Folder, Now.AddSeconds(-1))).Id;

        var memberships = new List<(Item Item, long CollectionId)>();
        Item Link(long userId, string url, string? title, string? memo, long collectionId)
        {
            var item = new Item(userId, url, Now.AddDays(-30));
            item.UpdateDetails(title, memo);
            memberships.Add((item, collectionId));
            return item;
        }

        // 45 title matches (more than one page) with ties on AddedAtUtc, plus URL-only matches.
        for (var index = 0; index < 45; index++)
        {
            Link(_owner, $"https://shop.example/{index}", $"Blue Sneaker {index}", null, _searchedId);
        }

        Link(_owner, "https://sneaker-store.example/a", "Running gear", null, _searchedId);
        Link(_owner, "https://plain.example/1", "Nothing to see", "my sneaker memo", _searchedId); // own memo: not matched
        Link(_other, "https://plain.example/2", "Also nothing", "secret sneaker plan", _searchedId); // another member's memo
        Link(_owner, "https://plain.example/3", "100% cotton_tee", null, _searchedId); // LIKE wildcards are literal
        Link(_owner, "https://shop.example/neighbour", "Blue Sneaker elsewhere", null, _neighbourId);
        Link(_owner, "https://shop.example/trashed", "Blue Sneaker trashed", null, _searchedId);

        _db.Items.AddRange(memberships.Select(membership => membership.Item));
        await _db.SaveChangesAsync();
        _db.CollectionItems.AddRange(memberships.Select((membership, index) =>
            new CollectionItem(membership.CollectionId, membership.Item.Id, _owner, Now.AddMinutes(-(index / 3)), index * 16)));
        await _db.SaveChangesAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE items.Items SET DeletedAtUtc = {Now} WHERE UserId = {_owner} AND Url = 'https://shop.example/trashed'");
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in new[] { _owner, _other, _stranger })
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private GetCollectionItemsService Items() => new(_access, _collections, new NoImages());

    private async Task<List<CollectionItemEntryDto>> SearchAllAsync(string term, CollectionItemSort sort, int pageSize)
    {
        var seen = new List<CollectionItemEntryDto>();
        CollectionItemPageCursor? cursor = null;
        do
        {
            var page = await Items().SearchAsync(_owner, _searchedId, term, cursor, pageSize, sort);
            Assert.True(page.Items.Count <= pageSize);
            seen.AddRange(page.Items);
            cursor = page.NextCursor;
        }
        while (cursor is not null);

        return seen;
    }

    [Theory]
    [InlineData(CollectionItemSort.DateDesc)]
    [InlineData(CollectionItemSort.DateAsc)]
    public async Task Search_MatchesTitleOrLink_OnlyInThisCollection_PagedWithoutDuplicatesOrGaps(CollectionItemSort sort)
    {
        var results = await SearchAllAsync("sneaker", sort, 10);

        // 45 titles + 1 link; never the neighbour Collection's, the trashed one or a memo.
        Assert.Equal(46, results.Count);
        Assert.Equal(results.Count, results.Select(entry => entry.ItemId).Distinct().Count());
        Assert.DoesNotContain(results, entry => entry.Url.Contains("neighbour", StringComparison.Ordinal));
        Assert.DoesNotContain(results, entry => entry.Url.Contains("trashed", StringComparison.Ordinal));
        Assert.DoesNotContain(results, entry => entry.Url.StartsWith("https://plain.example/", StringComparison.Ordinal));
        Assert.Contains(results, entry => entry.Url == "https://sneaker-store.example/a");

        var order = results.Select(entry => (entry.AddedAtUtc, entry.ItemId)).ToList();
        var expected = sort == CollectionItemSort.DateDesc
            ? order.OrderByDescending(key => key.AddedAtUtc).ThenByDescending(key => key.ItemId).ToList()
            : order.OrderBy(key => key.AddedAtUtc).ThenBy(key => key.ItemId).ToList();
        Assert.Equal(expected, order);
    }

    [Fact]
    public async Task Search_NeverMatchesAMemo_AndTreatsLikeWildcardsLiterally()
    {
        Assert.Empty(await SearchAllAsync("secret sneaker", CollectionItemSort.DateDesc, 50));
        Assert.Empty(await SearchAllAsync("my sneaker memo", CollectionItemSort.DateDesc, 50));

        var literal = await SearchAllAsync("0% cotton_", CollectionItemSort.DateDesc, 50);
        Assert.Equal(["https://plain.example/3"], literal.Select(entry => entry.Url));
        Assert.Empty(await SearchAllAsync("_x_", CollectionItemSort.DateDesc, 50));
    }

    [Fact]
    public async Task Search_KeepsTheListsAccessAndLockGates()
    {
        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => Items().SearchAsync(_stranger, _searchedId, "sneaker", null, 10, CollectionItemSort.DateDesc));

        await new CollectionLockStore(_db).LockAsync(_searchedId, Now);
        _db.ChangeTracker.Clear();
        // The Owner does not bypass the lock: nothing is searched without a grant.
        await Assert.ThrowsAsync<CollectionLockedException>(
            () => Items().SearchAsync(_owner, _searchedId, "sneaker", null, 10, CollectionItemSort.DateDesc));
    }

    private sealed class NoImages : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.FromResult<Uri?>(null);
    }
}
