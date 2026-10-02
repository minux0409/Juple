using System.Data.Common;
using System.Security.Cryptography;
using System.Text.Json;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Notifications.Inbox;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.IntegrationTests.TestSupport;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Notifications;

/// <summary>
/// The Notification Inbox and the Collection attention badge against the real schema: ownership,
/// keyset paging, read state (one, all, per Collection), the historical backfill, privacy, the safe
/// fallbacks of a target that is gone, and that a page or a Collection list costs a fixed number of
/// round trips whatever its size.
/// </summary>
public sealed class NotificationInboxIntegrationTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _outsider;
    private long _collectionId;
    private int _keys;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = NewContext();
        _owner = await NewUserAsync("Owner");
        _member = await NewUserAsync("Member");
        _outsider = await NewUserAsync(null);
        _collectionId = await NewCollectionAsync(_owner, "여행");
        await JoinAsync(_collectionId, _member);
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        await _db.Notifications.Where(entry => _userIds.Contains(entry.UserId)).ExecuteDeleteAsync();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    [Fact]
    public async Task TheRecipient_SeesOnlyTheirOwnInboxRows_NewestFirst_InStableKeysetPages()
    {
        var mine = new List<long>();
        for (var index = 0; index < 5; index++)
        {
            mine.Add(await NotifyAsync(_member, NotificationType.CollectionItemsAdded, _owner));
        }

        await NotifyAsync(_owner, NotificationType.CollectionItemsAdded, _member);
        // A data-only refresh row is never part of the Inbox.
        await NotifyAsync(_member, NotificationType.CollectionContentChanged, _owner);

        var seen = new List<long>();
        long? cursor = null;
        do
        {
            var page = await Service().ListAsync(_member, cursor, 2, "ko");
            Assert.InRange(page.Items.Count, 1, 2);
            seen.AddRange(page.Items.Select(row => row.Id));
            cursor = page.NextCursor;
        }
        while (cursor is not null);

        Assert.Equal(mine.OrderDescending(), seen);
        Assert.Equal(5, (await Service().ListAsync(_member, null, null, null)).UnreadCount);
    }

    [Fact]
    public async Task ReadingOne_IsIdempotent_AndSomeoneElsesId_IsNotFound()
    {
        var id = await NotifyAsync(_member, NotificationType.CollectionItemsAdded, _owner);
        await NotifyAsync(_member, NotificationType.CollectionItemsAdded, _owner);

        var first = await Service().MarkReadAsync(_member, id);
        var firstReadAt = await ReadAtAsync(id);
        var again = await Service().MarkReadAsync(_member, id);

        Assert.Equal(1, first.UnreadCount);
        Assert.Equal(1, again.UnreadCount);
        Assert.Equal(firstReadAt, await ReadAtAsync(id));
        await Assert.ThrowsAsync<NotificationNotFoundException>(() => Service().MarkReadAsync(_owner, id));
        await Assert.ThrowsAsync<NotificationNotFoundException>(() => Service().GetAsync(_owner, id, null));
        // A data-only row of the caller's own is not an Inbox row either.
        var refresh = await NotifyAsync(_member, NotificationType.CollectionContentChanged, _owner);
        await Assert.ThrowsAsync<NotificationNotFoundException>(() => Service().MarkReadAsync(_member, refresh));
    }

    [Fact]
    public async Task ReadAll_MarksOnlyTheCallersRows_InOneSetBasedStatement()
    {
        for (var index = 0; index < 20; index++)
        {
            await NotifyAsync(_member, NotificationType.CollectionItemsAdded, _owner);
        }

        var others = await NotifyAsync(_owner, NotificationType.CollectionItemsAdded, _member);
        var counter = new CommandCounter();
        await using var db = NewContext(counter);

        var result = await Service(db).MarkAllReadAsync(_member);

        Assert.Equal(20, result.MarkedCount);
        Assert.Equal(0, result.UnreadCount);
        // The UPDATE and the remaining count - nothing per row.
        output.WriteLine($"read-all of 20: {counter.Count} commands");
        Assert.Equal(2, counter.Count);
        Assert.Null(await ReadAtAsync(others));
    }

    [Fact]
    public async Task APageOfThirtyMixedRows_CostsAFixedHandfulOfQueries_AndUsesLiteralInboxTypes()
    {
        var actors = new List<long>();
        for (var index = 0; index < 6; index++)
        {
            var actor = await NewUserAsync($"Actor{index}");
            actors.Add(actor);
        }

        var collections = new List<long>();
        for (var index = 0; index < 5; index++)
        {
            var collectionId = await NewCollectionAsync(_owner, $"C{index}");
            await JoinAsync(collectionId, _member);
            collections.Add(collectionId);
        }

        var item = await NewItemAsync(_member, "https://example.test/mine");
        _db.CollectionItems.Add(new CollectionItem(collections[0], item, _member, DateTimeOffset.UtcNow, 0));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var types = new[]
        {
            NotificationType.CollectionItemsAdded, NotificationType.CollectionItemReactionReceived,
            NotificationType.CollectionItemCommentReceived, NotificationType.FriendRequestReceived,
            NotificationType.CollectionLinkSubmissionApproved, NotificationType.CollectionLinkShared,
        };
        for (var index = 0; index < 30; index++)
        {
            var type = types[index % types.Length];
            await NotifyAsync(_member, type, actors[index % actors.Count], collections[index % collections.Count], subjectId: item);
        }

        var counter = new CommandCounter();
        await using var db = NewContext(counter);
        var page = await Service(db).ListAsync(_member, null, 30, "en");

        Assert.Equal(30, page.Items.Count);
        output.WriteLine($"Inbox page of 30 (6 actors, 5 Collections, 6 Types): {counter.Count} commands");
        // Rows, Collections, memberships, actors, public links, own links, unread count - never per row.
        Assert.InRange(counter.Count, 1, 8);
        var listing = counter.Texts.First(text => text.Contains("ORDER BY", StringComparison.Ordinal));
        Assert.Contains("IN (", listing, StringComparison.Ordinal);
        Assert.DoesNotContain("@types", listing, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ALargeInbox_PagesInBoundedSteps_CountsUnread_AndReadsAllAtOnce()
    {
        var nowUtc = DateTimeOffset.UtcNow;
        _db.Notifications.AddRange(Enumerable.Range(0, 1000).Select(index => Notification.Social(
            _member, NotificationType.CollectionItemsAdded, _owner, _collectionId, null, $"large:{Guid.NewGuid():N}", nowUtc.AddSeconds(index))));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var counter = new CommandCounter();
        await using var db = NewContext(counter);
        var ids = new HashSet<long>();
        long? cursor = null;
        var pages = 0;
        do
        {
            counter.Reset();
            var page = await Service(db).ListAsync(_member, cursor, 100, "ko");
            Assert.InRange(counter.Count, 1, 8);
            Assert.All(page.Items, row => Assert.True(ids.Add(row.Id)));
            Assert.Equal(1000, page.UnreadCount);
            cursor = page.NextCursor;
            pages++;
        }
        while (cursor is not null);

        Assert.Equal(1000, ids.Count);
        Assert.Equal(10, pages);
        counter.Reset();
        Assert.Equal(1000, (await Service(db).MarkAllReadAsync(_member)).MarkedCount);
        output.WriteLine($"1,000-row Inbox: {pages} pages; read-all {counter.Count} commands");
        Assert.Equal(2, counter.Count);
        Assert.Equal(0, await Service(db).CountUnreadAsync(_member));
    }

    [Fact]
    public async Task Actors_AreShownOnlyWherePermitted_AndNothingPrivateLeaves()
    {
        var item = await NewItemAsync(_member, "https://secret.example.test/private-path?token=abc");
        _db.CollectionItems.Add(new CollectionItem(_collectionId, item, _member, DateTimeOffset.UtcNow, 0));
        _db.CollectionItemComments.Add(new CollectionItemComment(_collectionId, item, _owner, "SECRET-COMMENT-TEXT", DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var comment = await NotifyAsync(_member, NotificationType.CollectionItemCommentReceived, _owner, subjectId: item);
        // A proposal never stores (so can never show) who sent it; a public-link add hides the adder.
        var proposal = await NotifyAsync(_owner, NotificationType.CollectionLinkSubmissionReceived, null, subjectId: 999);
        var viaPublicLink = await NotifyAsync(_member, NotificationType.CollectionItemsAdded, null);

        var memberPage = await Service().ListAsync(_member, null, null, "en");
        var commentRow = memberPage.Items.Single(row => row.Id == comment);
        Assert.Equal("Owner", commentRow.Actor!.DisplayName);
        Assert.Equal(new NotificationTargetDto(NotificationTargetKinds.CollectionItem, _collectionId, item, null, NotificationTargetFocus.Comments), commentRow.Target);
        Assert.Null(memberPage.Items.Single(row => row.Id == viaPublicLink).Actor);
        var proposalRow = (await Service().ListAsync(_owner, null, null, "en")).Items.Single(row => row.Id == proposal);
        Assert.Null(proposalRow.Actor);
        Assert.Equal(new NotificationTargetDto(NotificationTargetKinds.CollectionSubmissions, CollectionId: _collectionId), proposalRow.Target);

        var json = JsonSerializer.Serialize(memberPage);
        Assert.DoesNotContain("SECRET-COMMENT-TEXT", json, StringComparison.Ordinal);
        Assert.DoesNotContain("secret.example", json, StringComparison.Ordinal);
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain($"\"{_owner}\"", json, StringComparison.Ordinal);
        Assert.DoesNotContain("UserId", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ATargetThatIsGone_FallsBackSafely_AndNamesNothing()
    {
        var item = await NewItemAsync(_member, "https://example.test/gone");
        _db.CollectionItems.Add(new CollectionItem(_collectionId, item, _member, DateTimeOffset.UtcNow, 0));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        var reaction = await NotifyAsync(_member, NotificationType.CollectionItemReactionReceived, _owner, subjectId: item);

        // The link is trashed: its Collection is still open to the member.
        var entity = await _db.Items.SingleAsync(entry => entry.Id == item);
        entity.SoftDelete(DateTimeOffset.UtcNow);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        Assert.Equal(new NotificationTargetDto(NotificationTargetKinds.Collection, CollectionId: _collectionId), (await Service().GetAsync(_member, reaction, "ko")).Target);

        // The member is removed: nothing left to open, and the row names nothing.
        await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _collectionId && entry.UserId == _member).ExecuteDeleteAsync();
        var removed = await Service().GetAsync(_member, reaction, "ko");
        Assert.Equal(NotificationTargetDto.Unavailable, removed.Target);
        Assert.Null(removed.Body);
        Assert.Null(removed.CollectionName);
        Assert.Null(removed.Actor);

        // The Collection itself is deleted: the Owner's own row about it is unavailable too.
        var ownerRow = await NotifyAsync(_owner, NotificationType.CollectionLinkSubmissionReceived, null, subjectId: 5);
        var collection = await _db.Collections.SingleAsync(entry => entry.Id == _collectionId);
        collection.SoftDelete(DateTimeOffset.UtcNow);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        Assert.Equal(NotificationTargetDto.Unavailable, (await Service().GetAsync(_owner, ownerRow, "ko")).Target);
    }

    [Fact]
    public async Task TheAttentionBadge_IsPendingApprovals_PlusUnreadNewLinks_AndNothingElse()
    {
        var first = await NewItemAsync(_outsider, "https://example.test/p1");
        var second = await NewItemAsync(_outsider, "https://example.test/p2");
        _db.CollectionLinkSubmissions.AddRange(
            new CollectionLinkSubmission(_collectionId, first, _outsider, true, "https://example.test/p1", null, null, DateTimeOffset.UtcNow),
            new CollectionLinkSubmission(_collectionId, second, _outsider, true, "https://example.test/p2", null, null, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        for (var index = 0; index < 3; index++)
        {
            await NotifyAsync(_owner, NotificationType.CollectionItemsAdded, _member);
        }

        // Reactions, comments and approval-request notifications are the Inbox's, never the card's.
        await NotifyAsync(_owner, NotificationType.CollectionItemReactionReceived, _member, subjectId: first);
        await NotifyAsync(_owner, NotificationType.CollectionItemCommentReceived, _member, subjectId: first);
        var request = await NotifyAsync(_owner, NotificationType.CollectionLinkSubmissionReceived, null, subjectId: 1);
        await NotifyAsync(_member, NotificationType.CollectionItemsAdded, _owner);

        var owners = await CardAsync(_owner);
        Assert.Equal((2, 3, 5), (owners.PendingSubmissionCount, owners.UnreadNewLinkCount, owners.AttentionCount));
        // A member never sees (or is counted) the Owner's pending approvals.
        var members = await CardAsync(_member);
        Assert.Equal((0, 1, 1), (members.PendingSubmissionCount, members.UnreadNewLinkCount, members.AttentionCount));

        // Opening the Collection reads its new links only - the approvals are tasks, still waiting.
        var opened = await Service().MarkCollectionNewLinksReadAsync(_owner, _collectionId);
        Assert.Equal(3, opened.MarkedCount);
        owners = await CardAsync(_owner);
        Assert.Equal((2, 0, 2), (owners.PendingSubmissionCount, owners.UnreadNewLinkCount, owners.AttentionCount));
        Assert.Null(await ReadAtAsync(request));
        Assert.Equal(3, await Service().CountUnreadAsync(_owner));

        // Opening the 승인 대기 list reads the request notification - the request itself still waits.
        await Service().MarkCollectionSubmissionRequestsReadAsync(_owner, _collectionId);
        Assert.NotNull(await ReadAtAsync(request));
        Assert.Equal(2, (await CardAsync(_owner)).PendingSubmissionCount);

        // Answering one is what lowers the pending count.
        var submissionId = await _db.CollectionLinkSubmissions.Where(entry => entry.ItemId == first).Select(entry => entry.Id).SingleAsync();
        await new CollectionLinkSubmissionStore(_db).RejectAsync(_collectionId, submissionId);
        _db.ChangeTracker.Clear();
        owners = await CardAsync(_owner);
        Assert.Equal((1, 0, 1), (owners.PendingSubmissionCount, owners.UnreadNewLinkCount, owners.AttentionCount));
    }

    [Fact]
    public async Task MyOwnNewLink_NeverBadgesMyCard_ButItBadgesTheOtherMembers()
    {
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var add = new AddItemToCollectionService(
            new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System),
            new CollectionStore(_db),
            TimeProvider.System,
            new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance, new NoOpNotificationSignal()));

        await add.AddAsync(_owner, _collectionId, await NewItemAsync(_owner, "https://example.test/own-add"));
        await NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        _db.ChangeTracker.Clear();

        Assert.Equal(0, (await CardAsync(_owner)).UnreadNewLinkCount);
        Assert.Equal(1, (await CardAsync(_member)).UnreadNewLinkCount);
    }

    [Fact]
    public async Task AHundredCollections_AreListedWithTheirBadges_InTheSameNumberOfQueriesAsTen()
    {
        var nowUtc = DateTimeOffset.UtcNow;
        for (var index = 0; index < 100; index++)
        {
            var collectionId = await NewCollectionAsync(_outsider, $"Badge{index}");
            _db.Notifications.Add(Notification.Social(
                _outsider, NotificationType.CollectionItemsAdded, _owner, collectionId, null, $"badge:{Guid.NewGuid():N}", nowUtc));
        }

        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var counter = new CommandCounter();
        await using var db = NewContext(counter);
        var store = new CollectionStore(db);
        var ten = await store.ListAsync(_outsider, null, null, null, null, 10);
        var tenCommands = counter.Count;
        counter.Reset();
        var hundred = await store.ListAsync(_outsider, null, null, null, null, 100);

        output.WriteLine($"Collection list: 10 cards {tenCommands} commands, 100 cards {counter.Count} commands");
        Assert.Equal(100, hundred.Items.Count);
        Assert.All(hundred.Items, card => Assert.Equal(1, card.AttentionCount));
        Assert.Equal(10, ten.Items.Count);
        Assert.Equal(tenCommands, counter.Count);
    }

    /// <summary>
    /// The Round 34 migration on a database that already has notifications: every pre-existing Inbox
    /// row starts read (no launch-day badge of old history), data-only rows are left alone, and rows
    /// created afterwards are unread. A throwaway database, migrated just to the previous migration.
    /// </summary>
    [Fact]
    public async Task TheMigration_StartsExistingInboxRowsRead_AndLeavesNewOnesUnread()
    {
        var builder = new SqlConnectionStringBuilder(_connectionString);
        builder.InitialCatalog = $"{builder.InitialCatalog}_InboxMigration_{Guid.NewGuid():N}";
        await using var db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(builder.ConnectionString).Options);
        try
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync("20261002042744_AddNotificationOutbox");
            var nowUtc = DateTimeOffset.UtcNow;
            var user = new User("ko-KR", "UTC", null, nowUtc, nowUtc);
            db.Users.Add(user);
            await db.SaveChangesAsync();
            var old = Notification.Social(user.Id, NotificationType.CollectionItemsAdded, null, 1, null, "old", nowUtc);
            var refresh = Notification.Social(user.Id, NotificationType.CollectionContentChanged, null, 1, null, "refresh", nowUtc);
            db.Notifications.AddRange(old, refresh);
            await db.SaveChangesAsync();

            await migrator.MigrateAsync();
            db.ChangeTracker.Clear();
            var fresh = Notification.Social(user.Id, NotificationType.CollectionItemsAdded, null, 1, null, "fresh", nowUtc);
            db.Notifications.Add(fresh);
            await db.SaveChangesAsync();

            var readAt = await db.Notifications.AsNoTracking().ToDictionaryAsync(entry => entry.DedupKey!, entry => entry.ReadAtUtc);
            Assert.NotNull(readAt["old"]);
            Assert.Null(readAt["refresh"]);
            Assert.Null(readAt["fresh"]);
            Assert.Equal(1, await new NotificationInboxStore(db).CountUnreadAsync(user.Id));
        }
        finally
        {
            await db.Database.EnsureDeletedAsync();
        }
    }

    private NotificationInboxService Service(JupleDbContext? db = null) =>
        new(new NotificationInboxStore(db ?? _db), TimeProvider.System);

    private async Task<Juple.Application.Collections.CollectionDto> CardAsync(long userId) =>
        (await new CollectionStore(_db).ListByScopeAsync(userId, Juple.Application.Collections.ListCollections.CollectionListScope.All, null, null, null, 100))
            .Items.Single(card => card.Id == _collectionId);

    private async Task<long> NotifyAsync(
        long recipient, NotificationType type, long? actor, long? collectionId = null, long? subjectId = null)
    {
        var notification = Notification.Social(
            recipient, type, actor, type == NotificationType.FriendRequestReceived ? null : collectionId ?? _collectionId, subjectId,
            $"inbox-test:{Guid.NewGuid():N}:{++_keys}", DateTimeOffset.UtcNow);
        _db.Notifications.Add(notification);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        return notification.Id;
    }

    private Task<DateTimeOffset?> ReadAtAsync(long id) =>
        _db.Notifications.AsNoTracking().Where(entry => entry.Id == id).Select(entry => entry.ReadAtUtc).SingleAsync();

    private async Task<long> NewUserAsync(string? displayName)
    {
        var user = new User("ko-KR", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        user.SetDisplayName(displayName, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewCollectionAsync(long owner, string name) =>
        (await new CollectionStore(_db).CreateAsync(owner, name, name.ToUpperInvariant(), CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

    private async Task JoinAsync(long collectionId, long userId)
    {
        _db.CollectionCollaborators.Add(new CollectionCollaborator(collectionId, userId, CollectionCollaboratorRole.Contributor, _owner, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private JupleDbContext NewContext(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).AddInterceptors(interceptors).Options);

    /// <summary>Counts (and keeps the text of) every SQL command the context sends.</summary>
    private sealed class CommandCounter : DbCommandInterceptor
    {
        private readonly List<string> _texts = [];

        public int Count => _texts.Count;

        public IReadOnlyList<string> Texts => _texts;

        public void Reset() => _texts.Clear();

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            _texts.Add(command.CommandText);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            _texts.Add(command.CommandText);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        {
            _texts.Add(command.CommandText);
            return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
