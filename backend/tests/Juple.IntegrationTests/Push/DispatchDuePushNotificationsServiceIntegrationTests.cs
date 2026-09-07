using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Application.Push.DispatchDuePushNotifications;
using Juple.Application.Purchases;
using Juple.Application.RepeatPurchases;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.RepeatPurchases;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Push;

public sealed class DispatchDuePushNotificationsServiceIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private readonly List<long> _extraUserIds = [];

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run DispatchDuePushNotifications " +
                "integration tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        foreach (var userId in _extraUserIds.Append(_userId))
        {
            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM notifications.NotificationDeliveries WHERE PushDeviceRegistrationId IN (SELECT Id FROM push.PushDeviceRegistrations WHERE UserId = {userId})");
            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM push.PushDeviceRegistrations WHERE UserId = {userId}");
            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM notifications.Notifications WHERE UserId = {userId}");
            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM purchases.RepeatPurchases WHERE UserId = {userId}");
            await _dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"DELETE FROM users.Users WHERE Id = {userId}");
        }

        await _dbContext.DisposeAsync();
    }

    private async Task<long> CreateUserAsync(string timeZoneId)
    {
        var user = new User("en-US", timeZoneId, null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();
        _extraUserIds.Add(user.Id);
        return user.Id;
    }

    private async Task<RepeatPurchaseDto> CreateRepeatPurchaseAsync(
        long userId, DateOnly nextPurchaseDate, string productName = "Dispatch Test Product", bool isEnabled = true)
    {
        var store = new RepeatPurchaseStore(_dbContext);
        var created = await store.CreateAsync(
            userId,
            new RepeatPurchaseFields(null, productName, 30, IntervalUnit.Day, nextPurchaseDate, false, 0),
            DateTimeOffset.UtcNow);
        if (!isEnabled)
        {
            created = await store.DisableAsync(userId, created.Id, DateTimeOffset.UtcNow);
        }

        _dbContext.ChangeTracker.Clear();
        return created;
    }

    private Task<RepeatPurchaseDto> CreateDueRepeatPurchaseAsync(DateOnly nextPurchaseDate, string productName = "Dispatch Test Product") =>
        CreateRepeatPurchaseAsync(_userId, nextPurchaseDate, productName);

    private async Task<PushDeviceRegistrationDto> RegisterDeviceAsync(
        long userId, string locale = "en", string installationId = "install-1")
    {
        var store = new PushDeviceRegistrationStore(_dbContext);
        var registered = await store.RegisterAsync(
            userId, PushPlatform.Android, installationId, "token", locale, DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        return registered;
    }

    private Task<PushDeviceRegistrationDto> RegisterDeviceAsync(string locale = "en", string installationId = "install-1") =>
        RegisterDeviceAsync(_userId, locale, installationId);

    private DispatchDuePushNotificationsService NewService(IPushSender pushSender, DateTimeOffset nowUtc) =>
        new(
            new NotificationStore(_dbContext),
            new NotificationDeliveryStore(_dbContext),
            new PushDeviceRegistrationStore(_dbContext),
            pushSender,
            new FakeTimeProvider(nowUtc));

    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class RecordingPushSender(PushSendResult result) : IPushSender
    {
        public List<(PushDeviceRegistration Device, PushNotificationPayload Payload)> Calls { get; } = [];

        public Task<PushSendResult> SendAsync(
            PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            Calls.Add((device, payload));
            return Task.FromResult(result);
        }
    }

    /// <summary>Thread-safe call counter shared across two independent DispatchDuePushNotificationsService instances - see the concurrent-dispatch test below, which needs an accurate total across both, not per-instance.</summary>
    private sealed class CountingPushSender(PushSendResult result) : IPushSender
    {
        private int _sendCount;

        public int SendCount => _sendCount;

        public Task<PushSendResult> SendAsync(
            PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _sendCount);
            return Task.FromResult(result);
        }
    }

    [Fact]
    public async Task DispatchAsync_WithNoConfiguredTransport_MaterializesAndRecordsFailedDelivery()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);

        var result = await NewService(new NotConfiguredPushSender(), nowUtc).DispatchAsync();

        Assert.Equal(1, result.CandidateUsers);
        Assert.Equal(1, result.Attempted);
        Assert.Equal(0, result.Sent);
        Assert.Equal(1, result.Failed);

        _dbContext.ChangeTracker.Clear();
        var delivery = Assert.Single(await _dbContext.NotificationDeliveries.AsNoTracking().ToListAsync());
        Assert.Equal(NotificationDeliveryStatus.Failed, delivery.Status);
        Assert.Equal("push_transport_not_configured", delivery.FailureCode);
    }

    [Fact]
    public async Task DispatchAsync_CalledTwice_DoesNotDuplicateDeliveryRow()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Sent("provider-message-1"));

        await NewService(sender, nowUtc).DispatchAsync();
        _dbContext.ChangeTracker.Clear();
        await NewService(sender, nowUtc).DispatchAsync();

        _dbContext.ChangeTracker.Clear();
        Assert.Single(await _dbContext.NotificationDeliveries.AsNoTracking().ToListAsync());
        Assert.Single(sender.Calls);
    }

    [Fact]
    public async Task DispatchAsync_WhenNotificationAlreadyRead_SkipsDispatch()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var notificationStore = new NotificationStore(_dbContext);
        await notificationStore.MaterializeDueAsync(_userId, "UTC", nowUtc);
        _dbContext.ChangeTracker.Clear();
        var notification = Assert.Single((await notificationStore.ListAsync(_userId, cursor: null, limit: 50)).Notifications);
        await notificationStore.MarkReadAsync(_userId, notification.Id, nowUtc);
        _dbContext.ChangeTracker.Clear();
        var sender = new RecordingPushSender(PushSendResult.Sent(null));

        var result = await NewService(sender, nowUtc).DispatchAsync();

        Assert.Equal(0, result.Attempted);
        Assert.Empty(sender.Calls);
    }

    [Fact]
    public async Task DispatchAsync_WhenDeviceDisabled_SkipsDispatch()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        var registrationStore = new PushDeviceRegistrationStore(_dbContext);
        await registrationStore.RegisterAsync(
            _userId, PushPlatform.Android, "install-1", "token", "en", DateTimeOffset.UtcNow);
        await registrationStore.DisableAsync(_userId, "install-1", DateTimeOffset.UtcNow);
        _dbContext.ChangeTracker.Clear();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Sent(null));

        var result = await NewService(sender, nowUtc).DispatchAsync();

        Assert.Equal(0, result.Attempted);
        Assert.Empty(sender.Calls);
    }

    [Fact]
    public async Task DispatchAsync_WhenNoRepeatPurchaseIsDue_FindsNoCandidateUsers()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 12, 1));
        await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Sent(null));

        var result = await NewService(sender, nowUtc).DispatchAsync();

        Assert.Equal(0, result.CandidateUsers);
        Assert.Empty(sender.Calls);
    }

    [Fact]
    public async Task DispatchAsync_UsesDeviceLocaleNotUsersPreferredLocale_ForPushText()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6), "우유");
        await RegisterDeviceAsync(locale: "ko");
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Sent(null));

        await NewService(sender, nowUtc).DispatchAsync();

        var call = Assert.Single(sender.Calls);
        Assert.Contains("우유", call.Payload.Body);
        Assert.Equal("repeatPurchaseDue", call.Payload.Type);
    }

    [Fact]
    public async Task DispatchAsync_SentThenLaterFailingRetry_UpdatesSameDeliveryRowRatherThanInsertingAnother()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        await NewService(new RecordingPushSender(PushSendResult.Failed("transient_error")), nowUtc).DispatchAsync();
        _dbContext.ChangeTracker.Clear();

        // A Failed delivery is not "read," so the same (Notification, Device) pair is still a
        // pending candidate on the next run - unlike a Sent one, which the unread-based candidate
        // query keeps re-attempting until the user reads it in-app; this is the retry path.
        await NewService(new RecordingPushSender(PushSendResult.Sent("provider-2")), nowUtc.AddHours(1)).DispatchAsync();

        _dbContext.ChangeTracker.Clear();
        var delivery = Assert.Single(await _dbContext.NotificationDeliveries.AsNoTracking().ToListAsync());
        Assert.Equal(NotificationDeliveryStatus.Sent, delivery.Status);
        Assert.Equal("provider-2", delivery.ProviderMessageId);
    }

    [Fact]
    public async Task DispatchAsync_WhenSendFailsWithUnregisteredCode_DisablesTheRegistration()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        var registration = await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Failed(PushSendFailureCodes.Unregistered));

        var result = await NewService(sender, nowUtc).DispatchAsync();

        Assert.Equal(1, result.Failed);
        _dbContext.ChangeTracker.Clear();
        var device = await _dbContext.PushDeviceRegistrations.AsNoTracking()
            .SingleAsync(d => d.Id == registration.Id);
        Assert.False(device.IsEnabled);
    }

    [Fact]
    public async Task DispatchAsync_WhenSendFailsWithSenderIdMismatchCode_DisablesTheRegistration()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        var registration = await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Failed(PushSendFailureCodes.SenderIdMismatch));

        await NewService(sender, nowUtc).DispatchAsync();

        _dbContext.ChangeTracker.Clear();
        var device = await _dbContext.PushDeviceRegistrations.AsNoTracking()
            .SingleAsync(d => d.Id == registration.Id);
        Assert.False(device.IsEnabled);
    }

    [Theory]
    [InlineData(PushSendFailureCodes.Unavailable)]
    [InlineData(PushSendFailureCodes.QuotaExceeded)]
    [InlineData(PushSendFailureCodes.Internal)]
    [InlineData(PushSendFailureCodes.InvalidArgument)]
    [InlineData(PushSendFailureCodes.SendTimeout)]
    [InlineData(PushSendFailureCodes.ThirdPartyAuthError)]
    public async Task DispatchAsync_WhenSendFailsWithTransientCode_LeavesTheRegistrationEnabledForRetry(
        string transientFailureCode)
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        var registration = await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Failed(transientFailureCode));

        await NewService(sender, nowUtc).DispatchAsync();

        _dbContext.ChangeTracker.Clear();
        var device = await _dbContext.PushDeviceRegistrations.AsNoTracking()
            .SingleAsync(d => d.Id == registration.Id);
        Assert.True(device.IsEnabled);

        // Still enabled AND the delivery is Failed (not Sent) - the next hourly Job pass reclaims
        // and retries this exact (Notification, Device) pair (see
        // DispatchAsync_SentThenLaterFailingRetry_UpdatesSameDeliveryRowRatherThanInsertingAnother
        // for the same claim-reuse mechanics from the opposite direction).
        var delivery = Assert.Single(await _dbContext.NotificationDeliveries.AsNoTracking().ToListAsync());
        Assert.Equal(NotificationDeliveryStatus.Failed, delivery.Status);
        var retrySender = new RecordingPushSender(PushSendResult.Sent("provider-retry"));
        await NewService(retrySender, nowUtc.AddHours(1)).DispatchAsync();
        Assert.Single(retrySender.Calls);
    }

    [Fact]
    public async Task DispatchAsync_TwoConcurrentDispatchersFromIndependentDbContexts_SendExactlyOnce()
    {
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sharedSender = new CountingPushSender(PushSendResult.Sent("provider-1"));

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        await using var contextA = new JupleDbContext(options);
        await using var contextB = new JupleDbContext(options);
        var dispatcherA = new DispatchDuePushNotificationsService(
            new NotificationStore(contextA), new NotificationDeliveryStore(contextA),
            new PushDeviceRegistrationStore(contextA), sharedSender, new FakeTimeProvider(nowUtc));
        var dispatcherB = new DispatchDuePushNotificationsService(
            new NotificationStore(contextB), new NotificationDeliveryStore(contextB),
            new PushDeviceRegistrationStore(contextB), sharedSender, new FakeTimeProvider(nowUtc));

        // Two independent Job executions racing to dispatch the exact same (Notification, Device)
        // pair - TryClaimAsync's atomic conditional update/insert (not GetPendingAsync's candidate
        // list) must ensure only one of them ever actually calls the transport for it.
        await Task.WhenAll(dispatcherA.DispatchAsync(), dispatcherB.DispatchAsync());

        Assert.Equal(1, sharedSender.SendCount);
        _dbContext.ChangeTracker.Clear();
        var delivery = Assert.Single(await _dbContext.NotificationDeliveries.AsNoTracking().ToListAsync());
        Assert.Equal(NotificationDeliveryStatus.Sent, delivery.Status);
    }

    [Fact]
    public async Task DispatchAsync_UserNeverCalledNotificationApi_StillMaterializesAndDeliversEndToEnd()
    {
        // No NotificationStore call of any kind happens before DispatchAsync here - this is exactly
        // the "app never opened today" user the Scheduled Job must still handle correctly, since
        // there is no authenticated request to lazily materialize on (see
        // ListUsersWithDueRepeatPurchasesAsync/MaterializeDueAsync's own remarks).
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Sent("provider-1"));

        var result = await NewService(sender, nowUtc).DispatchAsync();

        Assert.Equal(1, result.CandidateUsers);
        Assert.Single(sender.Calls);

        _dbContext.ChangeTracker.Clear();
        Assert.Single(await _dbContext.Notifications.AsNoTracking().Where(n => n.UserId == _userId).ToListAsync());
        Assert.Single(await _dbContext.NotificationDeliveries.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task DispatchAsync_DisabledRepeatPurchaseDueToday_SendsNothing()
    {
        await CreateRepeatPurchaseAsync(_userId, new DateOnly(2026, 9, 6), isEnabled: false);
        await RegisterDeviceAsync();
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Sent(null));

        var result = await NewService(sender, nowUtc).DispatchAsync();

        Assert.Equal(0, result.CandidateUsers);
        Assert.Empty(sender.Calls);
        _dbContext.ChangeTracker.Clear();
        Assert.Empty(await _dbContext.Notifications.AsNoTracking().Where(n => n.UserId == _userId).ToListAsync());
    }

    [Fact]
    public async Task DispatchAsync_TwoUsersInDifferentTimeZones_OnlyDispatchesForTheOneWhoseLocalDateHasReachedDue()
    {
        // 2026-09-06T16:00:00Z is already 2026-09-07 01:00 in Asia/Seoul (UTC+9) but still
        // 2026-09-06 09:00 in America/Los_Angeles (UTC-7 DST) - mirrors NotificationStore's own
        // MaterializeDueAsync_UsesUsersLocalDateNotUtcDate test, but exercised through the Job-level
        // multi-user dispatch path instead of a single per-request MaterializeDueAsync call.
        var seoulUserId = await CreateUserAsync("Asia/Seoul");
        var losAngelesUserId = await CreateUserAsync("America/Los_Angeles");
        await CreateRepeatPurchaseAsync(seoulUserId, new DateOnly(2026, 9, 7), "Seoul Product");
        await CreateRepeatPurchaseAsync(losAngelesUserId, new DateOnly(2026, 9, 7), "LA Product");
        await RegisterDeviceAsync(seoulUserId, installationId: "seoul-device");
        await RegisterDeviceAsync(losAngelesUserId, installationId: "la-device");
        var nowUtc = new DateTimeOffset(2026, 9, 6, 16, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Sent(null));

        await NewService(sender, nowUtc).DispatchAsync();

        var call = Assert.Single(sender.Calls);
        Assert.Contains("Seoul Product", call.Payload.Body);
    }

    [Fact]
    public async Task DispatchAsync_DueUserWithNoPushRegistration_StillMaterializesNotificationButSendsNothing()
    {
        // The in-app Notification Center is the source of truth independent of Push (see this
        // feature's own design notes) - a due RepeatPurchase must still become a Notification row
        // even for a user with zero registered devices, exactly as the lazy in-app path already
        // behaves; there is simply nothing to send it to.
        await CreateDueRepeatPurchaseAsync(new DateOnly(2026, 9, 6));
        var nowUtc = new DateTimeOffset(2026, 9, 6, 3, 0, 0, TimeSpan.Zero);
        var sender = new RecordingPushSender(PushSendResult.Sent(null));

        var result = await NewService(sender, nowUtc).DispatchAsync();

        Assert.Equal(1, result.CandidateUsers);
        Assert.Empty(sender.Calls);
        _dbContext.ChangeTracker.Clear();
        Assert.Single(await _dbContext.Notifications.AsNoTracking().Where(n => n.UserId == _userId).ToListAsync());
        Assert.Empty(await _dbContext.NotificationDeliveries.AsNoTracking().ToListAsync());
    }
}
