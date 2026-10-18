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
/// The Collections list's text search (GET /api/v1/collections?q=): a Collection is listed when its name - or one of its links'
/// title / URL - contains the term, inside the SAME access rules, scopes and paging as the plain list, against the real schema.
/// </summary>
public sealed class CollectionListSearchIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _member;
    private long _stranger;

    private long _limbus;       // name "림버스"; link "Mili - Rendezvous [Limbus Company]" on youtube.com
    private long _trips;        // shared with _member; a link on example.test, no title
    private long _lockedOwn;    // the Owner's own lock; a link titled "Mili secret"
    private long _gatedShared;  // shared with _member behind an access password; a link titled "Mili gated"
    private long _favorite;     // the Owner's favorite; name "Mili favorites"
    private long _empty;        // "Empty": no links
    private long _memberOwn;    // the member's own collection with a "mili" link
    private long _foreign;      // another person's, never shared: a "Mili" link

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
        _limbus = (await store.CreateAsync(_owner, "림버스", "림버스", CollectionIcon.Folder, now.AddSeconds(-10))).Id;
        _trips = (await store.CreateAsync(_owner, "Trips", "TRIPS", CollectionIcon.Folder, now.AddSeconds(-9))).Id;
        _lockedOwn = (await store.CreateAsync(_owner, "Locked Stuff", "LOCKED STUFF", CollectionIcon.Folder, now.AddSeconds(-8))).Id;
        _gatedShared = (await store.CreateAsync(_owner, "Gated Shared", "GATED SHARED", CollectionIcon.Folder, now.AddSeconds(-7))).Id;
        _favorite = (await store.CreateAsync(_owner, "Mili favorites", "MILI FAVORITES", CollectionIcon.Folder, now.AddSeconds(-6))).Id;
        _empty = (await store.CreateAsync(_owner, "Empty", "EMPTY", CollectionIcon.Folder, now.AddSeconds(-5))).Id;
        _memberOwn = (await store.CreateAsync(_member, "Member Own", "MEMBER OWN", CollectionIcon.Folder, now.AddSeconds(-4))).Id;
        _foreign = (await store.CreateAsync(_stranger, "Foreign", "FOREIGN", CollectionIcon.Folder, now.AddSeconds(-3))).Id;

        await AddLinkAsync(_owner, _limbus, "https://www.youtube.com/watch?v=aaa", "Mili - Rendezvous [Limbus Company]");
        await AddLinkAsync(_owner, _limbus, "https://www.youtube.com/watch?v=bbb", "Mili - Rendezvous (again) [Limbus Company]");
        await AddLinkAsync(_owner, _trips, "https://example.test/Alpha-Beach", null);
        await AddLinkAsync(_owner, _lockedOwn, "https://hidden.test/x", "Mili secret");
        await AddLinkAsync(_owner, _gatedShared, "https://hidden.test/y", "Mili gated");
        await AddLinkAsync(_member, _memberOwn, "https://example.test/own", "mili in my own");
        await AddLinkAsync(_stranger, _foreign, "https://example.test/foreign", "Mili foreign");

        await store.SetFavoriteAsync(_owner, _favorite, true, now);
        await new CollectionLockStore(_db).LockAsync(_lockedOwn, now);

        // _member joins Trips and Gated Shared; Gated Shared is behind the Owner's access password for members.
        await ShareAsync(_trips, _member);
        await ShareAsync(_gatedShared, _member);
        _db.CollectionSharePasswords.Add(CollectionSharePassword.Create(_gatedShared, "hash", "sealed", now));
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

    private static CollectionListSearch? Q(string? term)
    {
        Assert.True(CollectionListSearch.TryCreate(term, out var search));
        return search;
    }

    private async Task<List<long>> ListAsync(long userId, CollectionListScope scope, string? term, int limit = 50)
    {
        var page = await new CollectionStore(_db).ListByScopeAsync(userId, scope, null, null, null, limit, search: Q(term));
        return page.Items.Select(item => item.Id).ToList();
    }

    [Fact]
    public async Task Name_MatchesContains_CaseInsensitive_AndKoreanWorks()
    {
        Assert.Equal([_favorite], (await ListAsync(_owner, CollectionListScope.All, "FAVORITES")));
        Assert.Contains(_limbus, await ListAsync(_owner, CollectionListScope.All, "림"));
        Assert.Equal([_limbus], await ListAsync(_owner, CollectionListScope.Owned, "버스"));
    }

    [Fact]
    public async Task LinkTitle_Url_AndHostname_KeepTheCollection_CaseInsensitive()
    {
        var byTitle = await ListAsync(_owner, CollectionListScope.Owned, "mili - rendezvous");
        Assert.Equal([_limbus], byTitle);

        Assert.Contains(_limbus, await ListAsync(_owner, CollectionListScope.Owned, "YouTube"));
        Assert.Contains(_limbus, await ListAsync(_owner, CollectionListScope.Owned, "youtube.com"));
        Assert.Contains(_trips, await ListAsync(_owner, CollectionListScope.Owned, "alpha-beach"));
        Assert.Contains(_trips, await ListAsync(_owner, CollectionListScope.Owned, "example.test"));
    }

    [Fact]
    public async Task NameOrLink_BothKept_AndANameMatchWithNoLinks_Stays()
    {
        var ids = await ListAsync(_owner, CollectionListScope.Owned, "Mili");
        Assert.Contains(_limbus, ids);     // by link
        Assert.Contains(_favorite, ids);   // by name (no links at all)
        Assert.DoesNotContain(_empty, ids);
        Assert.DoesNotContain(_trips, ids);
    }

    [Fact]
    public async Task ManyMatchingLinks_StillOneRowPerCollection()
    {
        var ids = await ListAsync(_owner, CollectionListScope.Owned, "Limbus Company");
        Assert.Single(ids, _limbus);
        Assert.Single(ids);
    }

    [Fact]
    public async Task NoMatch_IsEmpty_AndEmptyOrBlankTermIsTheUnchangedList()
    {
        Assert.Empty(await ListAsync(_owner, CollectionListScope.All, "no-such-thing-anywhere"));
        var plain = (await new CollectionStore(_db).ListByScopeAsync(_owner, CollectionListScope.All, null, null, null, 50)).Items.Select(item => item.Id).ToList();
        Assert.Equal(plain, await ListAsync(_owner, CollectionListScope.All, null));
        Assert.Equal(plain, await ListAsync(_owner, CollectionListScope.All, ""));
        Assert.Equal(plain, await ListAsync(_owner, CollectionListScope.All, "   "));
    }

    [Fact]
    public async Task Search_ComposesWithEveryScope()
    {
        // favorites: only the Owner's favorite marks
        Assert.Equal([_favorite], await ListAsync(_owner, CollectionListScope.Favorites, "mili"));
        // owned: mine only - the member's own and the shared-with-me ones are not "mine" for the Owner view of _member
        var memberOwned = await ListAsync(_member, CollectionListScope.Owned, "mili");
        Assert.Equal([_memberOwn], memberOwned);
        // shared: what is shared with the member (Trips by its link, Gated Shared by NOTHING of its hidden links)
        var memberShared = await ListAsync(_member, CollectionListScope.Shared, "alpha");
        Assert.Equal([_trips], memberShared);
        // all: owned + shared
        var memberAll = await ListAsync(_member, CollectionListScope.All, "mili");
        Assert.Contains(_memberOwn, memberAll);
        Assert.DoesNotContain(_gatedShared, memberAll);
    }

    [Fact]
    public async Task InaccessibleCollections_AreNeverReturned_NorHintedAt()
    {
        Assert.DoesNotContain(_foreign, await ListAsync(_owner, CollectionListScope.All, "Mili foreign"));
        Assert.DoesNotContain(_foreign, await ListAsync(_member, CollectionListScope.All, "foreign"));
        Assert.Empty(await ListAsync(_stranger, CollectionListScope.Shared, "Mili"));
        // The Owner's collections are invisible to a person who is not in them, whatever the term.
        var strangerSeen = await ListAsync(_stranger, CollectionListScope.All, "Mili");
        Assert.Equal([_foreign], strangerSeen);
    }

    [Fact]
    public async Task LockedOwn_IsFoundByNameOnly_NeverByItsHiddenLinks()
    {
        Assert.DoesNotContain(_lockedOwn, await ListAsync(_owner, CollectionListScope.Owned, "Mili secret"));
        Assert.DoesNotContain(_lockedOwn, await ListAsync(_owner, CollectionListScope.Owned, "hidden.test"));
        Assert.Contains(_lockedOwn, await ListAsync(_owner, CollectionListScope.Owned, "Locked Stuff"));
    }

    [Fact]
    public async Task MemberBehindAnAccessPassword_FindsItByNameOnly_ButTheOwnerStillSearchesItsLinks()
    {
        Assert.DoesNotContain(_gatedShared, await ListAsync(_member, CollectionListScope.Shared, "Mili gated"));
        Assert.DoesNotContain(_gatedShared, await ListAsync(_member, CollectionListScope.Shared, "hidden.test"));
        Assert.Contains(_gatedShared, await ListAsync(_member, CollectionListScope.Shared, "Gated Shared"));
        // The Owner's own list: the access password is for MEMBERS, the Owner has no lock on it.
        Assert.Contains(_gatedShared, await ListAsync(_owner, CollectionListScope.Owned, "Mili gated"));
    }

    [Fact]
    public async Task Memo_IsNeverSearched()
    {
        await _db.Database.ExecuteSqlRawAsync(
            "UPDATE items.Items SET Memo = {0} WHERE UserId = {1}", "zzz-private-memo-token", _owner);
        _db.ChangeTracker.Clear();
        Assert.Empty(await ListAsync(_owner, CollectionListScope.All, "zzz-private-memo-token"));
    }

    [Fact]
    public async Task TrashedLinks_AreNoLinksOfTheCollection()
    {
        await _db.Database.ExecuteSqlRawAsync(
            "UPDATE items.Items SET DeletedAtUtc = SYSUTCDATETIME() WHERE UserId = {0} AND Title LIKE {1}", _owner, "Mili - Rendezvous%");
        _db.ChangeTracker.Clear();
        Assert.DoesNotContain(_limbus, await ListAsync(_owner, CollectionListScope.Owned, "Rendezvous"));
    }

    [Fact]
    public async Task SpecialCharacters_MatchLiterally_NeverAsWildcards()
    {
        Assert.Empty(await ListAsync(_owner, CollectionListScope.Owned, "%"));
        Assert.Empty(await ListAsync(_owner, CollectionListScope.Owned, "_"));
        Assert.Empty(await ListAsync(_owner, CollectionListScope.Owned, "[a-z]"));
        Assert.Empty(await ListAsync(_owner, CollectionListScope.Owned, "' OR 1=1 --"));
        Assert.Empty(await ListAsync(_owner, CollectionListScope.Owned, "\\"));
        // A real bracket in a title still matches itself.
        Assert.Contains(_limbus, await ListAsync(_owner, CollectionListScope.Owned, "[Limbus Company]"));
    }

    [Fact]
    public async Task OneCharacter_SearchesTheSameThingsAsLongerTerms_NameTitleAndUrl()
    {
        // The same fields whatever the length: the name ...
        Assert.Contains(_limbus, await ListAsync(_owner, CollectionListScope.Owned, "림"));
        // ... a link TITLE ("Mili - Rendezvous [Limbus Company]", and "Mili favorites" is a name) ...
        var m = await ListAsync(_owner, CollectionListScope.Owned, "M");
        Assert.Contains(_limbus, m);
        Assert.Contains(_favorite, m);
        // ... and a link URL / host: "x" is only in the URLs of Trips ("example.test") - never in its name.
        Assert.Contains(_trips, await ListAsync(_owner, CollectionListScope.Owned, "x"));
        Assert.Contains(_trips, await ListAsync(_owner, CollectionListScope.Owned, "xa"));
        // A 1-character term still obeys the rules: no memo, nothing behind a lock, no other person's Collection.
        Assert.DoesNotContain(_lockedOwn, await ListAsync(_owner, CollectionListScope.Owned, "h"));
        Assert.DoesNotContain(_foreign, await ListAsync(_owner, CollectionListScope.All, "f"));
    }

    [Fact]
    public async Task Pagination_FollowsTheSearchedList_WithoutGapsOrRepeats()
    {
        var all = await ListAsync(_owner, CollectionListScope.Owned, "e");
        Assert.True(all.Count >= 3);

        var store = new CollectionStore(_db);
        var seen = new List<long>();
        CollectionPageCursor? cursor = null;
        do
        {
            var page = await store.ListByScopeAsync(_owner, CollectionListScope.Owned, null, null, cursor, 2, search: Q("e"));
            seen.AddRange(page.Items.Select(item => item.Id));
            cursor = page.NextCursor;
        }
        while (cursor is not null);

        Assert.Equal(all, seen);
        Assert.Equal(seen.Count, seen.Distinct().Count());
    }

    [Fact]
    public async Task LegacyOwnedList_WithSearch_KeepsTheFavoriteFilter()
    {
        var store = new CollectionStore(_db);
        var favoritesOnly = (await store.ListAsync(_owner, null, null, true, null, 50, Q("mili"))).Items.Select(item => item.Id).ToList();
        Assert.Equal([_favorite], favoritesOnly);
        var withoutSearch = (await store.ListAsync(_owner, null, null, null, null, 50)).Items.Count;
        Assert.True(withoutSearch >= 6);
    }

    [Fact]
    public void TheTerm_IsTrimmed_AndAHundredCharactersIsTheLimit()
    {
        Assert.True(CollectionListSearch.TryCreate("  mili  ", out var trimmed));
        Assert.Equal("%mili%", trimmed!.Pattern);
        Assert.True(CollectionListSearch.TryCreate(new string('a', 100), out _));
        Assert.False(CollectionListSearch.TryCreate(new string('a', 101), out _));
        Assert.True(CollectionListSearch.TryCreate(null, out var none));
        Assert.Null(none);
        Assert.True(CollectionListSearch.TryCreate("a", out var one));
        Assert.Equal("%a%", one!.Pattern);
        Assert.True(CollectionListSearch.TryCreate("50%_[", out var special));
        Assert.Equal("%50\\%\\_\\[%", special!.Pattern);
    }

    // ---------- helpers ----------

    private async Task AddLinkAsync(long userId, long collectionId, string url, string? title)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        if (title is not null)
        {
            await _db.Database.ExecuteSqlRawAsync("UPDATE items.Items SET Title = {0} WHERE Id = {1}", title, saved.Entry.Id);
        }

        await new CollectionStore(_db).AddAsync(userId, collectionId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
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
