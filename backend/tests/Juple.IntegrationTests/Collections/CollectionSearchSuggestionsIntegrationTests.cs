using Juple.Application.Collections;
using Juple.Application.Collections.ListCollections;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// The quick suggestions under the Collections search box (GET /api/v1/collections/search-suggestions), against the real schema:
/// the same scopes, access and privacy rules as the list search, a hard limit in SQL, relevance order.
/// </summary>
public sealed class CollectionSearchSuggestionsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _member;
    private long _stranger;

    private long _prefix;      // name "Tian Collection": three links that match "tian"
    private long _contains;    // name "Fan of tian": no links
    private long _lockedOwn;   // the Owner's lock; a link titled "tian hidden"
    private long _gated;       // shared with _member behind an access password; a link "tian gated"
    private long _trips;       // shared with _member; a link "tian trips" on trips.example.test
    private long _favorite;    // favorite; name "Favorite one"
    private long _dupA;        // "Dup A" and "Dup B" hold the SAME item "Dup tian item"
    private long _dupB;
    private long _foreign;     // someone else's, never shared: "tian foreign"
    private long _memberOwn;   // the member's own, a link "tian member own"

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _stranger = await NewUserAsync();

        var store = new CollectionStore(_db);
        var now = DateTimeOffset.UtcNow;
        // Created oldest first so "newest first" can be told from "starts with".
        _contains = await CreateAsync(store, _owner, "Fan of tian", now.AddSeconds(-20));
        _prefix = await CreateAsync(store, _owner, "Tian Collection", now.AddSeconds(-30));
        _lockedOwn = await CreateAsync(store, _owner, "Locked Stuff", now.AddSeconds(-19));
        _gated = await CreateAsync(store, _owner, "Gated Shared", now.AddSeconds(-18));
        _trips = await CreateAsync(store, _owner, "Trips", now.AddSeconds(-17));
        _favorite = await CreateAsync(store, _owner, "Favorite one", now.AddSeconds(-16));
        _dupA = await CreateAsync(store, _owner, "Dup A", now.AddSeconds(-15));
        _dupB = await CreateAsync(store, _owner, "Dup B", now.AddSeconds(-14));
        _memberOwn = await CreateAsync(store, _member, "Member Own", now.AddSeconds(-13));
        _foreign = await CreateAsync(store, _stranger, "Foreign", now.AddSeconds(-12));

        await AddLinkAsync(_owner, _prefix, "https://www.youtube.com/watch?v=1", "Mili - TIAN TIAN [Limbus Company]");
        await AddLinkAsync(_owner, _prefix, "https://www.youtube.com/watch?v=2", "Another tian song");
        await AddLinkAsync(_owner, _prefix, "https://www.youtube.com/watch?v=3", "Third tian song");
        await AddLinkAsync(_owner, _lockedOwn, "https://locked.example.test/x", "tian hidden");
        await AddLinkAsync(_owner, _gated, "https://hidden.example.test/y", "tian gated");
        await AddLinkAsync(_owner, _trips, "https://trips.example.test/z", "tian trips");
        await AddLinkAsync(_member, _memberOwn, "https://example.test/own", "tian member own");
        await AddLinkAsync(_stranger, _foreign, "https://example.test/foreign", "tian foreign");
        var dupItem = await AddLinkAsync(_owner, _dupA, "https://dup.example.test/item", "Dup tian item");
        await new CollectionStore(_db).AddAsync(_owner, _dupB, dupItem, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        await store.SetFavoriteAsync(_owner, _favorite, true, now);
        await new CollectionLockStore(_db).LockAsync(_lockedOwn, now);
        await ShareAsync(_trips, _member);
        await ShareAsync(_gated, _member);
        _db.CollectionSharePasswords.Add(CollectionSharePassword.Create(_gated, "hash", "sealed", now));
        await _db.SaveChangesAsync();
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

    private async Task<CollectionSearchSuggestions> SuggestAsync(long userId, CollectionListScope scope, string term)
    {
        Assert.True(CollectionListSearch.TryCreate(term, out var search));
        Assert.NotNull(search);
        return await new CollectionStore(_db).SuggestAsync(userId, scope, search!);
    }

    private static List<long> Ids(CollectionSearchSuggestions result) => result.Collections.Select(collection => collection.Id).ToList();

    [Fact]
    public async Task CollectionName_Matches_AndAStartsWithComesBeforeAContainsEvenWhenOlder()
    {
        var result = await SuggestAsync(_owner, CollectionListScope.All, "tian");
        // "Tian Collection" is the OLDEST of the two, but it starts with the term.
        Assert.Equal([_prefix, _contains], Ids(result));
    }

    [Fact]
    public async Task LinkTitle_Url_AndHostname_Match_WithTheCollectionAndHost()
    {
        var title = (await SuggestAsync(_owner, CollectionListScope.Owned, "mili - tian")).Links;
        var hit = Assert.Single(title);
        Assert.Equal(_prefix, hit.CollectionId);
        Assert.Equal("Tian Collection", hit.CollectionName);
        Assert.Equal("Mili - TIAN TIAN [Limbus Company]", hit.Title);
        Assert.Equal("youtube.com", hit.Hostname);
        Assert.True(hit.IsMine);

        // URL / host: "trips.example" is only in a URL.
        var byHost = (await SuggestAsync(_owner, CollectionListScope.Owned, "trips.example")).Links;
        Assert.Equal("tian trips", Assert.Single(byHost).Title);
    }

    [Fact]
    public async Task LinkRanking_TitleStartsWith_ThenTitleContains_ThenUrl()
    {
        await AddLinkAsync(_owner, _dupA, "https://tian.rank.example.test/", null);   // only the URL matches
        var links = (await SuggestAsync(_owner, CollectionListScope.Owned, "tian")).Links;
        Assert.NotEmpty(links);
        // A title that STARTS with the term first ("tian hidden"/"tian gated" are hidden or others'; "tian trips" is the Owner's own).
        Assert.Equal("tian trips", links[0].Title);
        // The URL-only match (its title falls back to the host) comes after every title match.
        var byUrl = (await SuggestAsync(_owner, CollectionListScope.Owned, "tian.rank")).Links;
        Assert.Equal("tian.rank.example.test", Assert.Single(byUrl).Title);
    }

    [Fact]
    public async Task OneCharacter_Works_AndCaseDoesNotMatter()
    {
        var one = await SuggestAsync(_owner, CollectionListScope.Owned, "T");
        Assert.Contains(_prefix, Ids(one));
        Assert.NotEmpty(one.Links);
        var upper = await SuggestAsync(_owner, CollectionListScope.Owned, "TIAN");
        var lower = await SuggestAsync(_owner, CollectionListScope.Owned, "tian");
        Assert.Equal(Ids(lower), Ids(upper));
        Assert.Equal(lower.Links.Select(link => link.ItemId), upper.Links.Select(link => link.ItemId));
    }

    [Fact]
    public async Task Scopes_Narrow_TheSameWayTheListDoes()
    {
        Assert.Equal([_favorite], Ids(await SuggestAsync(_owner, CollectionListScope.Favorites, "Favorite")));
        Assert.Empty((await SuggestAsync(_owner, CollectionListScope.Favorites, "Tian")).Collections);
        Assert.Contains(_prefix, Ids(await SuggestAsync(_owner, CollectionListScope.Owned, "Tian")));

        // Shared with the member: only the shared ones - a link of an owned-only Collection never shows.
        var shared = await SuggestAsync(_member, CollectionListScope.Shared, "tian");
        Assert.DoesNotContain(shared.Links, link => link.CollectionId == _memberOwn);
        Assert.Contains(shared.Links, link => link.CollectionId == _trips);
        Assert.False(shared.Links.First(link => link.CollectionId == _trips).IsMine);

        var memberAll = await SuggestAsync(_member, CollectionListScope.All, "tian");
        Assert.Contains(memberAll.Links, link => link.CollectionId == _memberOwn && link.IsMine);
    }

    [Fact]
    public async Task InaccessibleCollections_AreNeverReturned()
    {
        var stranger = await SuggestAsync(_stranger, CollectionListScope.All, "tian");
        Assert.DoesNotContain(stranger.Links, link => link.CollectionId != _foreign);
        Assert.DoesNotContain(Ids(await SuggestAsync(_owner, CollectionListScope.All, "Foreign")), id => id == _foreign);
        var memberSeesOwners = await SuggestAsync(_member, CollectionListScope.All, "tian");
        Assert.DoesNotContain(memberSeesOwners.Links, link => link.CollectionId == _foreign || link.CollectionId == _prefix);
    }

    [Fact]
    public async Task LockedCollection_OffersItsNameOnly_NeverItsHiddenLinks()
    {
        var byHiddenLink = await SuggestAsync(_owner, CollectionListScope.Owned, "tian hidden");
        Assert.Empty(byHiddenLink.Links);
        Assert.DoesNotContain(_lockedOwn, Ids(byHiddenLink));      // not even through its link
        var byHost = await SuggestAsync(_owner, CollectionListScope.Owned, "locked.example");
        Assert.Empty(byHost.Links);
        Assert.Empty(byHost.Collections);
        // By its own name it is offered.
        Assert.Contains(_lockedOwn, Ids(await SuggestAsync(_owner, CollectionListScope.Owned, "Locked")));
    }

    [Fact]
    public async Task AccessPassword_HidesLinksFromMembers_ButNotFromTheOwner_AndTheNameStillMatches()
    {
        var member = await SuggestAsync(_member, CollectionListScope.Shared, "tian gated");
        Assert.Empty(member.Links);
        Assert.DoesNotContain(_gated, Ids(member));
        Assert.Contains(_gated, Ids(await SuggestAsync(_member, CollectionListScope.Shared, "Gated")));

        var owner = await SuggestAsync(_owner, CollectionListScope.Owned, "tian gated");
        Assert.Contains(owner.Links, link => link.CollectionId == _gated);
    }

    [Fact]
    public async Task SuggestionsAndTheList_AgreeOnWhatIsHiddenAndWhatIsNot()
    {
        // The list search and the suggestions are separate queries over the same rule: for every hidden / visible term they must agree.
        var store = new CollectionStore(_db);
        foreach (var (user, scope) in new[] { (_owner, CollectionListScope.Owned), (_member, CollectionListScope.Shared), (_member, CollectionListScope.All) })
        {
            foreach (var term in new[] { "tian hidden", "tian gated", "tian trips", "locked.example", "hidden.example", "trips.example" })
            {
                Assert.True(CollectionListSearch.TryCreate(term, out var search));
                var listed = (await store.ListByScopeAsync(user, scope, null, null, null, 50, search: search)).Items.Select(item => item.Id).ToHashSet();
                var suggested = await SuggestAsync(user, scope, term);
                foreach (var link in suggested.Links)
                {
                    Assert.Contains(link.CollectionId, listed);
                }

                foreach (var collection in suggested.Collections)
                {
                    Assert.Contains(collection.Id, listed);
                }
            }
        }
    }

    [Fact]
    public async Task TrashedLink_IsNoSuggestion()
    {
        await _db.Database.ExecuteSqlRawAsync("UPDATE items.Items SET DeletedAtUtc = SYSUTCDATETIME() WHERE UserId = {0} AND Title = {1}", _owner, "tian trips");
        _db.ChangeTracker.Clear();
        Assert.DoesNotContain((await SuggestAsync(_owner, CollectionListScope.Owned, "tian trips")).Links, link => link.Title == "tian trips");
    }

    [Fact]
    public async Task Memo_IsNeverSearched_NorReturned()
    {
        await _db.Database.ExecuteSqlRawAsync("UPDATE items.Items SET Memo = {0} WHERE UserId = {1}", "zzz-private-memo-token", _owner);
        _db.ChangeTracker.Clear();
        var result = await SuggestAsync(_owner, CollectionListScope.All, "zzz-private-memo-token");
        Assert.Empty(result.Links);
        Assert.Empty(result.Collections);
    }

    [Fact]
    public async Task SpecialCharacters_MatchLiterally()
    {
        foreach (var term in new[] { "%", "_", "[a-z]", "' OR 1=1 --", "\\" })
        {
            var result = await SuggestAsync(_owner, CollectionListScope.All, term);
            Assert.Empty(result.Links);
            Assert.Empty(result.Collections);
        }

        Assert.NotEmpty((await SuggestAsync(_owner, CollectionListScope.Owned, "[Limbus Company]")).Links);
    }

    [Fact]
    public async Task OneCollection_NeverFillsTheLinkList_AndASharedItemAppearsOnce()
    {
        var links = (await SuggestAsync(_owner, CollectionListScope.Owned, "tian")).Links;
        Assert.True(links.Count(link => link.CollectionId == _prefix) <= 2);
        Assert.Equal(links.Count, links.Select(link => link.ItemId).Distinct().Count());
        Assert.Single(links, link => link.Title == "Dup tian item");
    }

    [Fact]
    public async Task Results_AreLimited_InSql()
    {
        var store = new CollectionStore(_db);
        for (var index = 0; index < 7; index++)
        {
            var id = await CreateAsync(store, _owner, $"Limit {index}", DateTimeOffset.UtcNow.AddSeconds(-5 - index));
            for (var link = 0; link < 3; link++)
            {
                await AddLinkAsync(_owner, id, $"https://limit.example.test/{index}/{link}", $"limit title {index}-{link}");
            }
        }

        var result = await SuggestAsync(_owner, CollectionListScope.Owned, "limit");
        Assert.Equal(4, result.Collections.Count);
        Assert.Equal(4, result.Links.Count);
        Assert.True(result.Links.GroupBy(link => link.CollectionId).All(group => group.Count() <= 2));
    }

    [Fact]
    public async Task NoMatch_IsEmpty_AndTheTermIsValidated()
    {
        var none = await SuggestAsync(_owner, CollectionListScope.All, "no-such-thing-anywhere");
        Assert.Empty(none.Collections);
        Assert.Empty(none.Links);

        Assert.True(CollectionListSearch.TryCreate("  ", out var blank));
        Assert.Null(blank);                                           // the endpoint answers 400 for it
        Assert.False(CollectionListSearch.TryCreate(new string('a', 101), out _));
        Assert.True(CollectionListSearch.TryCreate("tian", out var term));
        Assert.Equal("tian%", term!.PrefixPattern);
        Assert.True(CollectionListSearch.TryCreate("50%_[", out var special));
        Assert.Equal("50\\%\\_\\[%", special!.PrefixPattern);
    }

    [Fact]
    public async Task TheCollectionsAreTheListCards_WithoutTheMemoOrMemberLists()
    {
        var result = await SuggestAsync(_owner, CollectionListScope.Owned, "Tian");
        var card = result.Collections.First(collection => collection.Id == _prefix);
        Assert.Equal("Tian Collection", card.Name);
        Assert.Equal(CollectionDtoAccessRoles.Owner, card.AccessRole);
        var json = System.Text.Json.JsonSerializer.Serialize(result);
        Assert.DoesNotContain("memo", json, StringComparison.OrdinalIgnoreCase);
    }

    // ---------- helpers ----------

    private static async Task<long> CreateAsync(CollectionStore store, long userId, string name, DateTimeOffset createdAt) =>
        (await store.CreateAsync(userId, name, name.ToUpperInvariant(), CollectionIcon.Folder, createdAt)).Id;

    private async Task<long> AddLinkAsync(long userId, long collectionId, string url, string? title)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        if (title is not null)
        {
            await _db.Database.ExecuteSqlRawAsync("UPDATE items.Items SET Title = {0} WHERE Id = {1}", title, saved.Entry.Id);
        }

        await new CollectionStore(_db).AddAsync(userId, collectionId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private async Task ShareAsync(long collectionId, long inviteeId)
    {
        _db.CollectionCollaborators.Add(new CollectionCollaborator(collectionId, inviteeId, CollectionCollaboratorRole.Contributor, _owner, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }
}
