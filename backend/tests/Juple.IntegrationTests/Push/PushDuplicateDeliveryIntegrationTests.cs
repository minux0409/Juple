using System.Collections.Concurrent;
using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Push;

/// <summary>Runs unchanged against master and the pre-APNs production backport.</summary>
public sealed class PushDuplicateDeliveryIntegrationTests : IAsyncLifetime
{
    private string _connection = null!;
    private readonly List<long> _users = [];
    private static DateTimeOffset Now => DateTimeOffset.UtcNow;
    private JupleDbContext Db() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connection).Options);

    public Task InitializeAsync()
    {
        _connection = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("An isolated test database must be configured.");
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await using var db = Db();
        foreach (var user in _users)
            await new AccountDeletionStore(db).DeleteAllDataAsync(user, $"push-duplicate-test/{user}/", Now);
    }

    private async Task<(long User, long Actor, long Notification)> Seed(NotificationType type = NotificationType.CollectionItemsAdded)
    {
        await using var db = Db();
        var user = new User("ko", "UTC", null, Now, Now);
        var actor = new User("ko", "UTC", null, Now, Now);
        db.Users.AddRange(user, actor);
        await db.SaveChangesAsync();
        _users.AddRange([user.Id, actor.Id]);
        var collection = new Collection(user.Id, "Duplicate audit", "DUPLICATE AUDIT", CollectionIcon.Folder, Now);
        db.Collections.Add(collection);
        await db.SaveChangesAsync();
        long? subject = null;
        if (type == NotificationType.CollectionItemCommentReceived)
        {
            var item = (await new ItemStore(db).SaveAsync(user.Id, "https://example.test/" + Guid.NewGuid().ToString("N"), null, Now)).Entry;
            db.CollectionItems.Add(new CollectionItem(collection.Id, item.Id, user.Id, Now, Now, 0));
            db.CollectionItemComments.Add(new CollectionItemComment(collection.Id, item.Id, actor.Id, "Synthetic test comment", Now));
            await db.SaveChangesAsync();
            subject = item.Id;
        }
        var notification = Notification.Social(user.Id, type, actor.Id, collection.Id, subject,
            "duplicate-test-" + Guid.NewGuid().ToString("N"), Now, itemCount: 1);
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();
        return (user.Id, actor.Id, notification.Id);
    }

    private async Task<List<PushDeviceRegistration>> Legacy(long user, params string[] tokens)
    {
        await using var db = Db();
        var devices = tokens.Select(token => new PushDeviceRegistration(user, PushPlatform.Android,
            Guid.NewGuid().ToString("N"), token, "ko", Now, Now)).ToList();
        db.PushDeviceRegistrations.AddRange(devices);
        await db.SaveChangesAsync();
        return devices;
    }

    private async Task Register(long user, string installation, string token)
    {
        await using var db = Db();
        await new PushDeviceRegistrationStore(db).RegisterAsync(user, PushPlatform.Android, installation, token, "ko", Now);
    }

    private static PushDeliveryProcessor Processor(JupleDbContext db, IPushSender sender, TimeProvider? time = null, INotificationDeliveryStore? delivery = null) =>
        new(new PushDispatchStore(db), delivery ?? new NotificationDeliveryStore(db), new PushDeviceRegistrationStore(db), sender,
            time ?? TimeProvider.System, new NotificationPipelineOptions { MaxConcurrentSends = 2, DeliveryBatchSize = 100 });

    [Fact]
    public async Task ConcurrentSameTokenRegistrationLeavesOneOwnerAndPreservesOtherTokens()
    {
        var s = await Seed();
        var token = "same-" + Guid.NewGuid().ToString("N");
        await Register(s.User, Guid.NewGuid().ToString("N"), "tablet-" + token);
        await Task.WhenAll(Enumerable.Range(0, 12).Select(index => Register(index % 2 == 0 ? s.User : s.Actor,
            Guid.NewGuid().ToString("N"), token)));
        await using var db = Db();
        var devices = await db.PushDeviceRegistrations.Where(row => _users.Contains(row.UserId)).AsNoTracking().ToListAsync();
        Assert.Single(devices, row => row.PushToken == token && row.IsEnabled);
        Assert.True(devices.Single(row => row.PushToken == "tablet-" + token).IsEnabled);
    }

    [Fact]
    public async Task TokenEqualityIsCaseSensitiveAndLogoutDoesNotDisableTheOtherDevice()
    {
        var s = await Seed();
        var suffix = Guid.NewGuid().ToString("N");
        var first = "first-" + suffix;
        var second = "second-" + suffix;
        await Register(s.User, first, "Case-" + suffix);
        await Register(s.User, second, "case-" + suffix);
        await using var db = Db();
        Assert.Equal(2, await db.PushDeviceRegistrations.CountAsync(row => row.UserId == s.User && row.IsEnabled));
        await new PushDeviceRegistrationStore(db).DisableAsync(s.User, first, Now);
        Assert.Single(await db.PushDeviceRegistrations.Where(row => row.UserId == s.User && row.IsEnabled).ToListAsync());
        await Register(s.User, first, "rotated-" + suffix);
        Assert.Equal(2, await db.PushDeviceRegistrations.CountAsync(row => row.UserId == s.User && row.IsEnabled));
    }

    [Theory]
    [InlineData(NotificationType.CollectionItemsAdded)]
    [InlineData(NotificationType.CollectionItemCommentReceived)]
    public async Task LegacySameTokenAliasesSendOnceAndShareOneProviderOutcome(NotificationType type)
    {
        var s = await Seed(type);
        await Legacy(s.User, "one-synthetic-token", "one-synthetic-token");
        var sender = new Sender();
        await using var db = Db();
        var result = await Processor(db, sender).DeliverAsync([s.Notification, s.Notification]);
        Assert.Equal(1, result.Sent);
        Assert.Single(sender.Calls);
        var receipts = await db.NotificationDeliveries.Where(row => row.NotificationId == s.Notification).AsNoTracking().ToListAsync();
        Assert.Equal(2, receipts.Count);
        Assert.Single(receipts.Select(row => row.ProviderMessageId).Distinct());
        Assert.All(receipts, row => Assert.Equal(NotificationDeliveryStatus.Sent, row.Status));
        Assert.Equal(0, (await Processor(db, sender).DeliverAsync([s.Notification])).Sent);
        Assert.Single(sender.Calls);
    }

    [Fact]
    public async Task DifferentTokensEachSendAndOnlyTheFailedTokenIsRetried()
    {
        var s = await Seed();
        await Legacy(s.User, "failing-token", "failing-token", "healthy-token");
        var fail = true;
        var sender = new Sender { Handler = (device, ct) => device.PushToken == "failing-token" && fail
            ? throw new HttpRequestException("Synthetic transport failure")
            : Task.FromResult(PushSendResult.Sent(Guid.NewGuid().ToString("N"))) };
        await using var db = Db();
        var first = await Processor(db, sender).DeliverAsync([s.Notification]);
        Assert.Equal((1, 1, 1), (first.Sent, first.Failed, first.RetryLater));
        Assert.Null((await db.Notifications.AsNoTracking().SingleAsync(row => row.Id == s.Notification)).DispatchedAtUtc);
        fail = false;
        Assert.Equal(1, (await Processor(db, sender).DeliverAsync([s.Notification])).Sent);
        Assert.Equal(3, sender.Calls.Count);
        Assert.Single(sender.Calls, token => token == "healthy-token");
    }

    [Fact]
    public async Task CompetingWorkerKeepsAnInFlightNotificationPendingForFailedOwnerRecovery()
    {
        var s = await Seed();
        await Legacy(s.User, "shared-token", "shared-token");
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var owner = new Sender { Handler = async (device, ct) => { started.TrySetResult(); await release.Task.WaitAsync(ct); return PushSendResult.Failed(PushSendFailureCodes.Unavailable); } };
        await using var firstDb = Db();
        var first = Processor(firstDb, owner).DeliverAsync([s.Notification]);
        try
        {
            await started.Task.WaitAsync(TimeSpan.FromSeconds(30));
            await using var secondDb = Db();
            var other = new Sender();
            var second = await Processor(secondDb, other).DeliverAsync([s.Notification]);
            Assert.Empty(other.Calls);
            Assert.Equal(1, second.RetryLater);
            Assert.Null((await secondDb.Notifications.AsNoTracking().SingleAsync(row => row.Id == s.Notification)).DispatchedAtUtc);
        }
        finally { release.TrySetResult(); }
        await first;
        await using var recoveryDb = Db();
        var recovery = new Sender();
        Assert.Equal(1, (await Processor(recoveryDb, recovery).DeliverAsync([s.Notification])).Sent);
        Assert.Single(recovery.Calls);
    }

    [Fact]
    public async Task ExpiredClaimsAfterWorkerRestartAreReclaimedOnceForTheWholeTokenGroup()
    {
        var s = await Seed();
        var devices = await Legacy(s.User, "restart-token", "restart-token");
        await using var db = Db();
        var notification = await db.Notifications.AsNoTracking().SingleAsync(row => row.Id == s.Notification);
        var at = Now;
        var claims = await new NotificationDeliveryStore(db).TryClaimTokenGroupsAsync(devices.Select(device => new PushDeliveryTarget(notification, device)).ToList(), at);
        Assert.Single(claims.Claimed);
        var sender = new Sender();
        var clock = new FixedTime(at.AddMinutes(16));
        await using var restarted = Db();
        Assert.Equal(1, (await Processor(restarted, sender, clock).DeliverAsync([s.Notification])).Sent);
        Assert.Single(sender.Calls);
        Assert.All(await restarted.NotificationDeliveries.AsNoTracking().Where(row => row.NotificationId == s.Notification).ToListAsync(), row => Assert.Equal(2, row.AttemptCount));
    }

    [Fact]
    public async Task NewRegistrationAfterSuccessfulSendDoesNotResendAnUndispatchedNotification()
    {
        var s = await Seed();
        await Legacy(s.User, "reinstalled-token", "reinstalled-token");
        var sender = new Sender();
        await using var db = Db();
        await Processor(db, sender).DeliverAsync([s.Notification]);
        await Register(s.User, Guid.NewGuid().ToString("N"), "reinstalled-token");
        // Emulate a process stopping after recording Sent but before marking its inbox row dispatched.
        await db.Notifications.Where(row => row.Id == s.Notification).ExecuteUpdateAsync(set => set.SetProperty(row => row.DispatchedAtUtc, (DateTimeOffset?)null));
        await Processor(db, sender).DeliverAsync([s.Notification]);
        Assert.Single(sender.Calls);
        Assert.Equal(3, await db.NotificationDeliveries.CountAsync(row => row.NotificationId == s.Notification));
    }

    [Fact]
    public async Task InvalidOldTokenOutcomeCannotDisableItsRotatedReplacement()
    {
        var s = await Seed();
        var devices = await Legacy(s.User, "old-token", "old-token");
        var selected = devices.OrderBy(device => device.Id).First();
        var sender = new Sender { Handler = async (device, ct) =>
        {
            await Register(s.User, selected.InstallationId, "new-valid-token");
            return PushSendResult.Failed(PushSendFailureCodes.Unregistered);
        } };
        await using var db = Db();
        await Processor(db, sender).DeliverAsync([s.Notification]);
        var enabled = await db.PushDeviceRegistrations.AsNoTracking().Where(row => row.UserId == s.User && row.IsEnabled).ToListAsync();
        Assert.Equal("new-valid-token", Assert.Single(enabled).PushToken);
    }

    [Fact]
    public async Task AcceptedSendWithLostOutcomeRetainsLeaseAndReplaysOnlyOneLogicalTarget()
    {
        var s = await Seed();
        await Legacy(s.User, "uncertain-token", "uncertain-token");
        var sender = new Sender();
        var at = Now;
        await using (var db = Db())
            await Assert.ThrowsAsync<IOException>(() => Processor(db, sender, delivery: new LostOutcome(new NotificationDeliveryStore(db)))
                .DeliverAsync([s.Notification]));
        Assert.Single(sender.Calls);
        await using var restarted = Db();
        // A transport acceptance and a database commit cannot be one transaction. Preserve
        // the existing at-least-once policy, with one replay for the token, not each alias.
        var replay = await Processor(restarted, sender, new FixedTime(at.AddMinutes(16))).DeliverAsync([s.Notification]);
        Assert.Equal(1, replay.Sent);
        Assert.Equal(2, sender.Calls.Count);
        var receipts = await restarted.NotificationDeliveries.AsNoTracking().Where(row => row.NotificationId == s.Notification).ToListAsync();
        Assert.All(receipts, row => Assert.Equal(2, row.AttemptCount));
        Assert.Single(receipts.Select(row => row.ProviderMessageId).Distinct());
    }

    private sealed class LostOutcome(INotificationDeliveryStore inner) : INotificationDeliveryStore
    {
        public Task<PushDeliveryClaims> TryClaimTokenGroupsAsync(IReadOnlyCollection<PushDeliveryTarget> targets, DateTimeOffset now, CancellationToken ct = default) => inner.TryClaimTokenGroupsAsync(targets, now, ct);
        public Task<bool> TryClaimAsync(long notification, long device, DateTimeOffset now, CancellationToken ct = default) => inner.TryClaimAsync(notification, device, now, ct);
        public Task<IReadOnlySet<DeliveryKey>> TryClaimManyAsync(IReadOnlyCollection<DeliveryKey> keys, DateTimeOffset now, CancellationToken ct = default) => inner.TryClaimManyAsync(keys, now, ct);
        public Task RecordAttemptsAsync(IReadOnlyCollection<DeliveryAttempt> attempts, CancellationToken ct = default) => throw new IOException("Synthetic lost outcome");
        public Task RecordAttemptAsync(long notification, long device, NotificationDeliveryStatus status, DateTimeOffset at, string? provider, string? failure, CancellationToken ct = default) => throw new IOException("Synthetic lost outcome");
    }

    private sealed class FixedTime(DateTimeOffset at) : TimeProvider { public override DateTimeOffset GetUtcNow() => at; }

    private sealed class Sender : IPushSender
    {
        public ConcurrentQueue<string> Calls { get; } = new();
        public Func<PushDeviceRegistration, CancellationToken, Task<PushSendResult>>? Handler { get; init; }
        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            Calls.Enqueue(device.PushToken); // Synthetic values only, never emitted to the test output.
            return Handler?.Invoke(device, cancellationToken) ?? Task.FromResult(PushSendResult.Sent(Guid.NewGuid().ToString("N")));
        }
    }
}
