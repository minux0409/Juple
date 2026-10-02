using System.Collections.Concurrent;
using System.Data.Common;
using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Notifications;

/// <summary>
/// The architecture of the notification pipeline against the real schema - not only its results:
///  - the user's request records ONE outbox event in its own transaction, whatever the audience's
///    size, and never fans out or sends (A, F);
///  - the audience is materialized in bounded pages with a fixed number of database round trips per
///    page and per delivery batch - not per recipient (B, query counts);
///  - a duplicate queue message, a racing recovery Job or a crashed processor never notifies or sends
///    twice (C, D, E, G); a lost Service Bus signal loses nothing (F).
/// A 1,000-member Collection is enough to prove the paging (page size 100) without making the suite slow.
/// </summary>
public sealed class NotificationPipelineIntegrationTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const int MemberCount = 1000;
    private const int PageSize = 100;

    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private readonly List<long> _memberIds = [];
    private long _owner;
    private long _collectionId;
    private CollectionUnlockTokenProtector _tokens = null!;
    private readonly ConcurrentSender _sender = new();

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = NewContext();
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));

        _owner = await NewUserAsync();
        _collectionId = (await new CollectionStore(_db).CreateAsync(_owner, "Big", "BIG", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

        // A large audience, seeded in bulk: members (each with one device).
        var nowUtc = DateTimeOffset.UtcNow;
        var members = Enumerable.Range(0, MemberCount).Select(_ => new User("ko-KR", "UTC", null, nowUtc, nowUtc)).ToList();
        _db.Users.AddRange(members);
        await _db.SaveChangesAsync();
        _memberIds.AddRange(members.Select(user => user.Id));
        _db.CollectionCollaborators.AddRange(_memberIds.Select(userId =>
            new CollectionCollaborator(_collectionId, userId, CollectionCollaboratorRole.Viewer, _owner, nowUtc)));
        _db.PushDeviceRegistrations.AddRange(_memberIds.Select(userId =>
            new PushDeviceRegistration(userId, PushPlatform.Android, Guid.NewGuid().ToString("N"), "test-token-" + Guid.NewGuid().ToString("N"), "ko", nowUtc, nowUtc)));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        var everyone = _memberIds.Concat(_userIds).ToList();
        // Bulk removal of the seeded audience (AccountDeletionStore per user would be thousands of statements).
        await _db.NotificationEvents.Where(entry => entry.CollectionId == _collectionId || everyone.Contains(entry.ActorUserId!.Value)).ExecuteDeleteAsync();
        await _db.Notifications.Where(entry => everyone.Contains(entry.UserId)).ExecuteDeleteAsync();
        await _db.PushDeviceRegistrations.Where(entry => _memberIds.Contains(entry.UserId)).ExecuteDeleteAsync();
        await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _collectionId).ExecuteDeleteAsync();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Users.Where(entry => _memberIds.Contains(entry.Id)).ExecuteDeleteAsync();
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    [Fact]
    public async Task A_TheRequest_RecordsOneEventInItsOwnTransaction_WithAConstantNumberOfCommands_AndNeverFansOut()
    {
        var counter = new CommandCounter();
        await using var requestDb = NewContext(counter);
        var signal = new RecordingSignal();
        var item = await NewItemAsync(_owner, "https://example.test/big");

        counter.Reset();
        await AddService(requestDb, signal).AddAsync(_owner, _collectionId, item);

        // One small constant: the access check, the add, two outbox inserts (new link + refresh) -
        // nowhere near one per member, and no send of any kind (the API has no Push sender at all).
        output.WriteLine($"Request commands with {MemberCount} members: {counter.Count}");
        Assert.InRange(counter.Count, 1, 30);
        var events = await EventsAsync();
        Assert.Equal([NotificationType.CollectionContentChanged, NotificationType.CollectionItemsAdded], events.Select(entry => entry.Type).Order());
        Assert.All(events, entry => Assert.Equal(NotificationEventStatus.Pending, entry.Status));
        Assert.Equal(0, await _db.Notifications.CountAsync(entry => entry.CollectionId == _collectionId));
        Assert.Empty(_sender.Sent);
        // Signaled once, after the commit, with exactly those events (ids only).
        Assert.Equal(events.Select(entry => entry.Id).Order(), Assert.Single(signal.Calls).Order());
    }

    [Fact]
    public async Task B_TheAudience_IsMaterializedInBoundedPages_WithCommandsPerPage_NotPerRecipient()
    {
        var item = await NewItemAsync(_owner, "https://example.test/paged");
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);
        var itemsAdded = (await EventsAsync()).Single(entry => entry.Type == NotificationType.CollectionItemsAdded);

        var counter = new CommandCounter();
        await using var workerDb = NewContext(counter);
        var queue = new RecordingQueue();
        var outcome = await NotificationPipelineTestKit.Processor(workerDb, _sender, queue, options: NotificationPipelineTestKit.Options(PageSize, 100))
            .ProcessAsync(itemsAdded.Id, deliverInline: false);

        // 1,000 members (+ the Owner, who is the actor and not told): 11 pages of at most 100.
        Assert.True(outcome.Processed);
        Assert.Equal(MemberCount, outcome.Materialized);
        Assert.Equal(11, outcome.Pages);
        Assert.All(queue.Batches, batch => Assert.InRange(batch.Count, 1, 100));
        Assert.Equal(MemberCount, queue.Batches.Sum(batch => batch.Count));
        // Per page a fixed handful (keyset, opt-outs, existing keys, batched insert, cursor/commit) -
        // EF batches the inserts, so ~1,000 rows are far fewer than 1,000 commands.
        output.WriteLine($"Materialization: {outcome.Materialized} notifications, {outcome.Pages} pages, {counter.Count} commands");
        Assert.InRange(counter.Count, outcome.Pages, outcome.Pages * 12);
        Assert.True(counter.Count < MemberCount / 4, $"{counter.Count} commands for {MemberCount} recipients");

        // Delivery of one queued batch: a fixed number of queries for the batch, not per recipient.
        counter.Reset();
        var delivered = await NotificationPipelineTestKit.Delivery(workerDb, _sender).DeliverAsync(queue.Batches[0]);
        Assert.Equal(queue.Batches[0].Count, delivered.Sent); // the first page also held the Owner - the actor, never told
        Assert.InRange(delivered.Sent, 99, 100);
        output.WriteLine($"Delivery of one batch of {delivered.Pending}: {counter.Count} commands");
        Assert.InRange(counter.Count, 1, 25);
    }

    [Fact]
    public async Task C_ADuplicateEventMessage_OrARepeatedPage_NeverCreatesASecondNotification()
    {
        var item = await NewItemAsync(_owner, "https://example.test/duplicate");
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);
        var itemsAdded = (await EventsAsync()).Single(entry => entry.Type == NotificationType.CollectionItemsAdded);
        var processor = NotificationPipelineTestKit.Processor(_db, _sender, new RecordingQueue(), options: NotificationPipelineTestKit.Options(PageSize));

        Assert.True((await processor.ProcessAsync(itemsAdded.Id, deliverInline: false)).Processed);
        Assert.False((await processor.ProcessAsync(itemsAdded.Id, deliverInline: false)).Processed); // the redelivered message

        // A processor that died after committing pages but before finishing: the event is reopened at
        // its start - every page is materialized again, and no notification exists twice.
        await _db.NotificationEvents.Where(entry => entry.Id == itemsAdded.Id)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(entry => entry.Status, NotificationEventStatus.Pending)
                .SetProperty(entry => entry.CompletedAtUtc, (DateTimeOffset?)null)
                .SetProperty(entry => entry.RecipientCursor, (long?)null));
        var again = await processor.ProcessAsync(itemsAdded.Id, deliverInline: false);
        Assert.True(again.Processed);
        Assert.Equal(0, again.Materialized);
        Assert.Equal(MemberCount, await _db.Notifications.CountAsync(entry => entry.CollectionId == _collectionId && entry.Type == NotificationType.CollectionItemsAdded));
    }

    [Fact]
    public async Task D_ADuplicateDeliveryMessage_DoesNotSendAgain()
    {
        var ids = await MaterializedItemsAddedAsync("https://example.test/delivery-twice");
        var batch = ids.Take(50).ToList();

        await NotificationPipelineTestKit.Delivery(_db, _sender).DeliverAsync(batch);
        var second = await NotificationPipelineTestKit.Delivery(_db, _sender).DeliverAsync(batch); // the redelivered message

        Assert.Equal(50, _sender.Sent.Count);
        Assert.Equal(0, second.Pending); // all dispatched already - nothing even loaded
        Assert.Equal(50, _sender.Sent.Select(sent => sent.NotificationId).Distinct().Count());
    }

    [Fact]
    public async Task E_TheWorkerAndTheRecoveryJob_Racing_NeverClaimOrSendTwice()
    {
        var item = await NewItemAsync(_owner, "https://example.test/race");
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);

        await using var workerDb = NewContext();
        await using var jobDb = NewContext();
        var itemsAdded = (await EventsAsync()).Single(entry => entry.Type == NotificationType.CollectionItemsAdded);
        await Task.WhenAll(
            NotificationPipelineTestKit.Processor(workerDb, _sender, options: NotificationPipelineTestKit.Options(PageSize)).ProcessAsync(itemsAdded.Id, deliverInline: true),
            NotificationPipelineTestKit.Dispatcher(jobDb, _sender, options: NotificationPipelineTestKit.Options(PageSize)).RunOnceAsync());
        // Whatever one of them left (the other held the event's lease), the next run finishes.
        await NotificationPipelineTestKit.Dispatcher(_db, _sender, options: NotificationPipelineTestKit.Options(PageSize)).RunOnceAsync();

        var newLinkSends = _sender.Sent.Where(sent => sent.Type == "collectionItemsAdded").ToList();
        Assert.Equal(MemberCount, newLinkSends.Count);
        Assert.Equal(MemberCount, newLinkSends.Select(sent => sent.DeviceId).Distinct().Count());
        Assert.Equal(MemberCount, await _db.NotificationDeliveries.CountAsync(entry =>
            _db.Notifications.Any(notification => notification.Id == entry.NotificationId && notification.CollectionId == _collectionId && notification.Type == NotificationType.CollectionItemsAdded)));
    }

    [Fact]
    public async Task F_ALostSignal_LosesNothing_AndARolledBackChange_LeavesNoEvent()
    {
        // The change commits; the signal goes nowhere (Service Bus down) - the event waits in SQL.
        var item = await NewItemAsync(_owner, "https://example.test/lost-signal");
        await AddService(_db, new RecordingSignal { Lost = true }).AddAsync(_owner, _collectionId, item);
        Assert.True(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _collectionId && entry.ItemId == item));
        Assert.Equal(2, (await EventsAsync()).Count);

        // The recovery Job alone delivers it.
        await NotificationPipelineTestKit.Dispatcher(_db, _sender, options: NotificationPipelineTestKit.Options(PageSize)).RunOnceAsync();
        Assert.Equal(MemberCount, _sender.Sent.Count(sent => sent.Type == "collectionItemsAdded"));
        Assert.All(await EventsAsync(), entry => Assert.Equal(NotificationEventStatus.Processed, entry.Status));

        // A scope that is not committed: its event never existed, and nothing is signaled.
        var signal = new RecordingSignal();
        var publisher = new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance, signal);
        await using (await publisher.BeginAtomicScopeAsync())
        {
            await publisher.CollectionItemsAddedAsync(_owner, _collectionId, 1, hideActor: false);
        }

        Assert.Equal(2, (await EventsAsync()).Count);
        Assert.Empty(signal.Calls);
    }

    [Fact]
    public async Task G_AnEventWhoseProcessorDied_IsTakenOverAfterItsLease()
    {
        var item = await NewItemAsync(_owner, "https://example.test/crashed");
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);
        var itemsAdded = (await EventsAsync()).Single(entry => entry.Type == NotificationType.CollectionItemsAdded);
        var store = new NotificationEventStore(_db);

        // A worker claimed it, materialized one page, and died.
        Assert.Equal(1, await store.TryClaimAsync(itemsAdded.Id, DateTimeOffset.UtcNow, TimeSpan.FromMinutes(2)));
        await store.MaterializeNextPageAsync(itemsAdded.Id, PageSize, DateTimeOffset.UtcNow, TimeSpan.FromMinutes(2));

        // While its lease is live, nobody else takes it (the run finishes only the other, unclaimed event).
        await NotificationPipelineTestKit.Dispatcher(_db, _sender, options: NotificationPipelineTestKit.Options(PageSize)).RunOnceAsync();
        var held = await _db.NotificationEvents.AsNoTracking().SingleAsync(entry => entry.Id == itemsAdded.Id);
        Assert.Equal(NotificationEventStatus.Pending, held.Status);
        Assert.Equal(PageSize, await _db.Notifications.CountAsync(entry => entry.CollectionId == _collectionId && entry.Type == NotificationType.CollectionItemsAdded) + 1);

        // Lease expired: the recovery Job continues from the cursor and finishes it.
        await _db.NotificationEvents.Where(entry => entry.Id == itemsAdded.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.LeaseUntilUtc, DateTimeOffset.UtcNow.AddSeconds(-1)));
        var run = await NotificationPipelineTestKit.Dispatcher(_db, _sender, options: NotificationPipelineTestKit.Options(PageSize)).RunOnceAsync();
        Assert.True(run.EventsRecovered >= 1);
        Assert.Equal(MemberCount, await _db.Notifications.CountAsync(entry => entry.CollectionId == _collectionId && entry.Type == NotificationType.CollectionItemsAdded));
        Assert.Equal(MemberCount, _sender.Sent.Count(sent => sent.Type == "collectionItemsAdded"));
        var finished = await _db.NotificationEvents.AsNoTracking().SingleAsync(entry => entry.Id == itemsAdded.Id);
        Assert.Equal(NotificationEventStatus.Processed, finished.Status);
        Assert.NotNull(finished.CompletedAtUtc);
        Assert.Equal(2, finished.AttemptCount);
    }

    [Fact]
    public async Task ManyFailedAttempts_NeverGiveUpADurableEvent_OnlyFlagItForAttention()
    {
        var item = await NewItemAsync(_owner, "https://example.test/long-outage");
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);
        var itemsAdded = (await EventsAsync()).Single(entry => entry.Type == NotificationType.CollectionItemsAdded);
        // As if it had failed 30 times during a long outage, flagged, and its retry is now due.
        await _db.NotificationEvents.Where(entry => entry.Id == itemsAdded.Id)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(entry => entry.AttemptCount, 30)
                .SetProperty(entry => entry.RequiresAttention, true)
                .SetProperty(entry => entry.LastErrorCode, "SqlException")
                .SetProperty(entry => entry.NextAttemptAtUtc, DateTimeOffset.UtcNow.AddSeconds(-1)));

        var processed = await NotificationPipelineTestKit.Processor(_db, _sender, options: NotificationPipelineTestKit.Options(PageSize)).ProcessAsync(itemsAdded.Id, deliverInline: true);

        Assert.True(processed.Processed);
        Assert.Equal(MemberCount, _sender.Sent.Count(sent => sent.Type == "collectionItemsAdded"));
        var done = await _db.NotificationEvents.AsNoTracking().SingleAsync(entry => entry.Id == itemsAdded.Id);
        Assert.Equal((NotificationEventStatus.Processed, 31), (done.Status, done.AttemptCount));
    }

    [Fact]
    public async Task C_AMalformedEvent_FailsPermanently_VisiblyAndOnce()
    {
        _db.NotificationEvents.Add(new NotificationEvent(
            NotificationType.CollectionItemsAdded, _owner, null, null, null, 1, false, null, null, DateTimeOffset.UtcNow.AddMinutes(-5)));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        var malformed = await _db.NotificationEvents.AsNoTracking().Where(entry => entry.ActorUserId == _owner && entry.CollectionId == null).SingleAsync();

        var outcome = await NotificationPipelineTestKit.Processor(_db, _sender).ProcessAsync(malformed.Id, deliverInline: true);

        Assert.Equal(NotificationEventStore.MalformedEventCode, outcome.PermanentFailureCode);
        var failed = await _db.NotificationEvents.AsNoTracking().SingleAsync(entry => entry.Id == malformed.Id);
        Assert.Equal((NotificationEventStatus.FailedPermanent, "MalformedEvent"), (failed.Status, failed.LastErrorCode));
        Assert.NotNull(failed.CompletedAtUtc);
        Assert.Null(await new NotificationEventStore(_db).TryClaimAsync(malformed.Id, DateTimeOffset.UtcNow, TimeSpan.FromMinutes(1))); // terminal
        Assert.Equal(1, (await new NotificationEventStore(_db).GetStatsAsync(DateTimeOffset.UtcNow)).EventsFailedPermanently);
        await _db.NotificationEvents.Where(entry => entry.Id == malformed.Id).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task DEF_TheRecoveryScan_SkipsARetryNotYetDue_TakesItWhenDue_AndTakesOverAnExpiredLease()
    {
        var item = await NewItemAsync(_owner, "https://example.test/due");
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);
        var ids = (await EventsAsync()).Select(entry => entry.Id).ToList();
        var store = new NotificationEventStore(_db);
        var nowUtc = DateTimeOffset.UtcNow;
        var later = nowUtc.AddMinutes(1);

        // D: a scheduled retry in the future - not picked up, and no processor may claim it either.
        await _db.NotificationEvents.Where(entry => ids.Contains(entry.Id))
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.NextAttemptAtUtc, nowUtc.AddMinutes(5)));
        Assert.DoesNotContain(await store.ListRecoverableAsync(100, later, nowUtc), ids.Contains);
        Assert.Null(await store.TryClaimAsync(ids[0], nowUtc, TimeSpan.FromMinutes(2)));

        // E: once due, it is recovered.
        Assert.Equal(ids, (await store.ListRecoverableAsync(100, later, nowUtc.AddMinutes(6))).Where(ids.Contains).Order());

        // F: due but leased (a live processor): skipped; the lease expired: taken over.
        await _db.NotificationEvents.Where(entry => ids.Contains(entry.Id))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(entry => entry.NextAttemptAtUtc, (DateTimeOffset?)null)
                .SetProperty(entry => entry.LeaseUntilUtc, nowUtc.AddMinutes(1)));
        Assert.DoesNotContain(await store.ListRecoverableAsync(100, later, nowUtc), ids.Contains);
        Assert.Equal(ids, (await store.ListRecoverableAsync(100, later, nowUtc.AddMinutes(2))).Where(ids.Contains).Order());
    }

    [Fact]
    public async Task ATransientFailure_SchedulesARetryInSql_AndTheEventIsRecoveredLater()
    {
        var item = await NewItemAsync(_owner, "https://example.test/transient");
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);
        var itemsAdded = (await EventsAsync()).Single(entry => entry.Type == NotificationType.CollectionItemsAdded);

        // The materialization's database goes away mid-processing (a context whose connection is closed for good).
        await using var broken = NewContext(new FailingAfterClaimInterceptor());
        await Assert.ThrowsAsync<NotificationEventRetryScheduledException>(() =>
            NotificationPipelineTestKit.Processor(broken, _sender).ProcessAsync(itemsAdded.Id, deliverInline: true));

        var scheduled = await _db.NotificationEvents.AsNoTracking().SingleAsync(entry => entry.Id == itemsAdded.Id);
        Assert.Equal(NotificationEventStatus.Pending, scheduled.Status);
        Assert.NotNull(scheduled.NextAttemptAtUtc);
        Assert.Null(scheduled.LeaseUntilUtc);
        Assert.False(scheduled.RequiresAttention);
        Assert.False(string.IsNullOrEmpty(scheduled.LastErrorCode)); // an exception type name only - never content

        // Due: the recovery Job delivers it.
        await _db.NotificationEvents.Where(entry => entry.Id == itemsAdded.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.NextAttemptAtUtc, DateTimeOffset.UtcNow.AddSeconds(-1)));
        await NotificationPipelineTestKit.Dispatcher(_db, _sender, options: NotificationPipelineTestKit.Options(PageSize)).RunOnceAsync();
        Assert.Equal(MemberCount, _sender.Sent.Count(sent => sent.Type == "collectionItemsAdded"));
    }

    [Fact]
    public async Task ASlowDeliveryWhoseMessageIsRedeliveredMeanwhile_StillSendsEachDeviceOnce()
    {
        var ids = (await MaterializedItemsAddedAsync("https://example.test/slow")).Take(50).ToList();
        var slow = new SlowSender(TimeSpan.FromMilliseconds(20));

        // The same batch handled twice at the same time - what a lost lock and a redelivery look like.
        await using var first = NewContext();
        await using var second = NewContext();
        await Task.WhenAll(
            NotificationPipelineTestKit.Delivery(first, slow).DeliverAsync(ids),
            NotificationPipelineTestKit.Delivery(second, slow).DeliverAsync(ids));

        Assert.Equal(50, slow.Sent.Count);
        Assert.Equal(50, slow.Sent.Distinct().Count());
    }

    [Fact]
    public async Task TheOutboxRow_CarriesIdsOnly_NeverTheLinkOrAnyText()
    {
        var item = await NewItemAsync(_owner, "https://example.test/private-url-should-not-appear");
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);

        foreach (var entry in await EventsAsync())
        {
            Assert.DoesNotContain("example.test", entry.DedupKey ?? string.Empty);
            Assert.Null(entry.LastErrorCode);
        }
    }

    private async Task<List<long>> MaterializedItemsAddedAsync(string url)
    {
        var item = await NewItemAsync(_owner, url);
        await AddService(_db, new RecordingSignal()).AddAsync(_owner, _collectionId, item);
        await NotificationPipelineTestKit.MaterializeOutboxAsync(_db, PageSize);
        return await _db.Notifications.AsNoTracking()
            .Where(entry => entry.CollectionId == _collectionId && entry.Type == NotificationType.CollectionItemsAdded && entry.DispatchedAtUtc == null)
            .OrderBy(entry => entry.Id)
            .Select(entry => entry.Id)
            .ToListAsync();
    }

    private AddItemToCollectionService AddService(JupleDbContext db, INotificationSignal signal) =>
        new(
            new CollectionAccessService(new CollectionAccessStore(db), _tokens, TimeProvider.System),
            new CollectionStore(db),
            TimeProvider.System,
            new SocialNotificationPublisher(db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance, signal));

    private Task<List<NotificationEvent>> EventsAsync() =>
        _db.NotificationEvents.AsNoTracking().Where(entry => entry.CollectionId == _collectionId).OrderBy(entry => entry.Id).ToListAsync();

    private JupleDbContext NewContext(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).AddInterceptors(interceptors).Options);

    private async Task<long> NewUserAsync()
    {
        var user = new User("ko-KR", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    /// <summary>Counts every SQL command the context sends (queries, inserts, updates).</summary>
    private sealed class CommandCounter : DbCommandInterceptor
    {
        private int _count;

        public int Count => _count;

        public void Reset() => Interlocked.Exchange(ref _count, 0);

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    /// <summary>
    /// Lets the claim through (its UPDATE and the attempt read), then times out every query - reads die
    /// mid-processing while the retry bookkeeping (a plain UPDATE) still reaches the database.
    /// </summary>
    private sealed class FailingAfterClaimInterceptor : DbCommandInterceptor
    {
        private int _reads;

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default) =>
            Interlocked.Increment(ref _reads) > 1 ? throw new TimeoutException() : base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    private sealed class SlowSender(TimeSpan delay) : IPushSender
    {
        private readonly ConcurrentQueue<long> _sent = new();

        public IReadOnlyList<long> Sent => _sent.ToList();

        public async Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            await Task.Delay(delay, cancellationToken);
            _sent.Enqueue(device.Id);
            return PushSendResult.Sent("test-message");
        }
    }

    private sealed class RecordingSignal : INotificationSignal
    {
        public bool Lost { get; init; }

        public List<IReadOnlyCollection<long>> Calls { get; } = [];

        public Task SignalEventsAsync(IReadOnlyCollection<long> eventIds, CancellationToken cancellationToken = default)
        {
            if (!Lost)
            {
                Calls.Add(eventIds.ToList());
            }

            return Task.CompletedTask;
        }
    }

    private sealed class RecordingQueue : IPushDeliveryQueue
    {
        public List<IReadOnlyList<long>> Batches { get; } = [];

        public Task<bool> TryEnqueueAsync(IReadOnlyList<long> notificationIds, CancellationToken cancellationToken = default)
        {
            Batches.Add(notificationIds.ToList());
            return Task.FromResult(true);
        }
    }

    private sealed class ConcurrentSender : IPushSender
    {
        private readonly ConcurrentQueue<(long DeviceId, long NotificationId, string Type)> _sent = new();

        public IReadOnlyList<(long DeviceId, long NotificationId, string Type)> Sent => _sent.ToList();

        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            _sent.Enqueue((device.Id, payload.NotificationId, payload.Type));
            return Task.FromResult(PushSendResult.Sent("test-message"));
        }
    }
}
