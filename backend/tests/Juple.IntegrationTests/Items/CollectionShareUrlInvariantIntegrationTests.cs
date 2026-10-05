using Juple.Application.Collections.CopyItems;
using Juple.Application.Collections.Public;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.UrlMetadata;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

/// <summary>
/// A Juple Collection share URL never becomes an ordinary saved link - on the real schema, through every path that
/// creates an Item from a URL: the normal save (POST /inbox) and 내 컬렉션으로 복사 (which copies other people's links).
/// </summary>
public sealed class CollectionShareUrlInvariantIntegrationTests : IAsyncLifetime
{
    private const string BaseUrl = "https://dev.juple.co.kr";
    private const string Id = "AbCdEfGh_ijkLMNOpqrSTUV-wxyz0123";

    private JupleDbContext _db = null!;
    private long _alice;
    private long _bob;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        var now = DateTimeOffset.UtcNow;
        var alice = new User("en-US", "UTC", null, now, now);
        var bob = new User("en-US", "UTC", null, now, now);
        _db.Users.AddRange(alice, bob);
        await _db.SaveChangesAsync();
        (_alice, _bob) = (alice.Id, bob.Id);
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in new[] { _alice, _bob })
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private sealed class Detector : ICollectionShareUrlDetector
    {
        public string? FindPublicId(string? url) => CollectionShareUrl.TryGetPublicId(url, BaseUrl);
    }

    private sealed class Resolver : IUrlMetadataResolver
    {
        public Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default) =>
            Task.FromResult(new UrlMetadataResult(null, null, null));
    }

    [Fact]
    public async Task TheNormalSave_RefusesAShareUrl_WritesNoItem_AndStillSavesOrdinaryUrls()
    {
        var service = new InboxEntrySaveService(new ItemStore(_db), TimeProvider.System, new Resolver(), new Detector());

        foreach (var url in new[] { $"https://dev.juple.co.kr/c/{Id}", $" https://dev.juple.co.kr/c/{Id}?utm_source=kakao ", $"https://dev.juple.co.kr/c/{Id}/#top" })
        {
            var exception = await Assert.ThrowsAsync<CollectionShareUrlNotSavableException>(() =>
                service.SaveAsync(_alice, new SaveInboxEntryCommand(url, Guid.NewGuid())));
            Assert.Equal(Id, exception.PublicId);
        }

        Assert.Equal(0, await _db.Items.CountAsync(item => item.UserId == _alice));

        // Not Collection links: another path of the site, a lookalike host, plain http.
        foreach (var url in new[] { "https://dev.juple.co.kr/about", $"https://dev.juple.co.kr.evil.test/c/{Id}", $"http://dev.juple.co.kr/c/{Id}" })
        {
            await service.SaveAsync(_alice, new SaveInboxEntryCommand(url, Guid.NewGuid()));
        }

        Assert.Equal(3, await _db.Items.CountAsync(item => item.UserId == _alice));
    }

    [Fact]
    public async Task CopyingAnotherPersonsLinks_NeverTurnsALegacyShareUrlIntoANewSavedLink()
    {
        var now = DateTimeOffset.UtcNow;
        var collections = new CollectionStore(_db);
        var source = (await collections.CreateAsync(_bob, "Source", "SOURCE", CollectionIcon.Folder, now)).Id;
        var destination = (await collections.CreateAsync(_alice, "Dest", "DEST", CollectionIcon.Folder, now)).Id;
        // Rows from before the rule existed: bob's own links, one of them a Collection share URL.
        var ordinary = new Item(_bob, "https://example.test/ordinary", now);
        var legacy = new Item(_bob, $"https://dev.juple.co.kr/c/{Id}", now);
        _db.Items.AddRange(ordinary, legacy);
        await _db.SaveChangesAsync();
        _db.CollectionItems.AddRange(new CollectionItem(source, ordinary.Id, _bob, now, 0), new CollectionItem(source, legacy.Id, _bob, now, 16));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var result = await new CollectionItemCopyStore(_db, new Detector())
            .CopyAsync(_alice, source, [ordinary.Id, legacy.Id], destination, now);

        Assert.Equal(1, result.Copied);
        Assert.Equal(1, result.Unavailable); // skipped like an unavailable link
        var mine = await _db.Items.AsNoTracking().Where(item => item.UserId == _alice).Select(item => item.Url).ToListAsync();
        Assert.Equal(["https://example.test/ordinary"], mine);
    }
}
