using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Notifications;

public sealed class NotificationDeliveryStoreIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _notificationId;
    private long _deviceId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run NotificationDelivery store " +
                "integration tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;

        // RepeatPurchaseId/DueDate are deliberately null - TryClaimAsync/RecordAttemptAsync only
        // ever address a Notification by Id, so a minimal generic row is enough here and avoids
        // needing a real RepeatPurchase for tests that are entirely about NotificationDelivery's own
        // claim/reclaim behavior.
        var notification = new Notification(
            _userId, NotificationType.RepeatPurchaseDue, null, null, "Claim Test Product", null, DateTimeOffset.UtcNow);
        _dbContext.Notifications.Add(notification);

        var device = new PushDeviceRegistration(
            _userId, PushPlatform.Android, "install-1", "token-1", "en", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.PushDeviceRegistrations.Add(device);

        await _dbContext.SaveChangesAsync();
        _notificationId = notification.Id;
        _deviceId = device.Id;
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM notifications.NotificationDeliveries WHERE NotificationId = {_notificationId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM push.PushDeviceRegistrations WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM notifications.Notifications WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId}");
        await _dbContext.DisposeAsync();
    }

    private NotificationDeliveryStore NewStore() => new(_dbContext);

    private async Task<NotificationDelivery> ReloadDeliveryAsync()
    {
        _dbContext.ChangeTracker.Clear();
        return await _dbContext.NotificationDeliveries.AsNoTracking().SingleAsync(
            d => d.NotificationId == _notificationId && d.PushDeviceRegistrationId == _deviceId);
    }

    [Fact]
    public async Task TryClaimAsync_NoExistingRow_ClaimsImmediatelyAsSendingWithAttemptCountOne()
    {
        var store = NewStore();

        var claimed = await store.TryClaimAsync(_notificationId, _deviceId, DateTimeOffset.UtcNow);

        Assert.True(claimed);
        var delivery = await ReloadDeliveryAsync();
        Assert.Equal(NotificationDeliveryStatus.Sending, delivery.Status);
        Assert.Equal(1, delivery.AttemptCount);
    }

    [Fact]
    public async Task TryClaimAsync_OnAFreshSendingClaim_LosesTheClaim()
    {
        var store = NewStore();
        var nowUtc = DateTimeOffset.UtcNow;
        await store.TryClaimAsync(_notificationId, _deviceId, nowUtc);

        // A second caller trying immediately after (lease nowhere near expired) must not also claim
        // it - this is what makes send-once safe while a claim is genuinely still in flight.
        var claimedAgain = await store.TryClaimAsync(_notificationId, _deviceId, nowUtc.AddSeconds(1));

        Assert.False(claimedAgain);
        var delivery = await ReloadDeliveryAsync();
        Assert.Equal(1, delivery.AttemptCount);
    }

    [Fact]
    public async Task TryClaimAsync_OnAStaleSendingClaim_ReclaimSucceedsAndIncrementsAttemptCount()
    {
        var store = NewStore();
        var crashedAtUtc = DateTimeOffset.UtcNow;
        await store.TryClaimAsync(_notificationId, _deviceId, crashedAtUtc);
        // Simulates the original claimer crashing here, before ever calling RecordAttemptAsync -
        // the row is left Sending with no further updates.

        // Past the stale-lease timeout (15 minutes) - see NotificationDeliveryStore.
        // StaleSendingLeaseTimeout.
        var reclaimedAtUtc = crashedAtUtc.AddMinutes(16);
        var reclaimed = await store.TryClaimAsync(_notificationId, _deviceId, reclaimedAtUtc);

        Assert.True(reclaimed);
        var delivery = await ReloadDeliveryAsync();
        Assert.Equal(NotificationDeliveryStatus.Sending, delivery.Status);
        Assert.Equal(2, delivery.AttemptCount);
        Assert.Equal(reclaimedAtUtc, delivery.AttemptedAtUtc);
    }

    [Fact]
    public async Task TryClaimAsync_BeforeTheLeaseExpires_CannotBeReclaimed()
    {
        var store = NewStore();
        var claimedAtUtc = DateTimeOffset.UtcNow;
        await store.TryClaimAsync(_notificationId, _deviceId, claimedAtUtc);

        // Well within the 15-minute stale-lease timeout - still presumed to be a live, in-progress
        // claim, not a crashed one.
        var stillTooEarly = claimedAtUtc.AddMinutes(10);
        var reclaimed = await store.TryClaimAsync(_notificationId, _deviceId, stillTooEarly);

        Assert.False(reclaimed);
        var delivery = await ReloadDeliveryAsync();
        Assert.Equal(1, delivery.AttemptCount);
    }

    [Fact]
    public async Task TryClaimAsync_ConcurrentReclaimOfTheSameStaleSendingRow_OnlyOneWorkerSucceeds()
    {
        var store = NewStore();
        var crashedAtUtc = DateTimeOffset.UtcNow;
        await store.TryClaimAsync(_notificationId, _deviceId, crashedAtUtc);
        var reclaimedAtUtc = crashedAtUtc.AddMinutes(20);

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        await using var contextA = new JupleDbContext(options);
        await using var contextB = new JupleDbContext(options);
        var storeA = new NotificationDeliveryStore(contextA);
        var storeB = new NotificationDeliveryStore(contextB);

        var results = await Task.WhenAll(
            storeA.TryClaimAsync(_notificationId, _deviceId, reclaimedAtUtc),
            storeB.TryClaimAsync(_notificationId, _deviceId, reclaimedAtUtc));

        Assert.Equal(1, results.Count(claimed => claimed));
        var delivery = await ReloadDeliveryAsync();
        // The original crashed claim (AttemptCount 1) plus exactly one successful reclaim.
        Assert.Equal(2, delivery.AttemptCount);
    }

    [Fact]
    public async Task TryClaimAsync_OnAFailedDelivery_CanAlwaysBeClaimedAsARetry()
    {
        var store = NewStore();
        var firstAttemptUtc = DateTimeOffset.UtcNow;
        await store.TryClaimAsync(_notificationId, _deviceId, firstAttemptUtc);
        await store.RecordAttemptAsync(
            _notificationId, _deviceId, NotificationDeliveryStatus.Failed, firstAttemptUtc, null, "transient_error");

        // No lease wait needed - a Failed row is always immediately retryable, unlike a Sending one.
        var retryClaimed = await store.TryClaimAsync(_notificationId, _deviceId, firstAttemptUtc.AddSeconds(1));

        Assert.True(retryClaimed);
        var delivery = await ReloadDeliveryAsync();
        Assert.Equal(NotificationDeliveryStatus.Sending, delivery.Status);
        Assert.Equal(2, delivery.AttemptCount);
    }

    [Fact]
    public async Task TryClaimAsync_OnASentDelivery_CanNeverBeClaimedAgain()
    {
        var store = NewStore();
        var sentAtUtc = DateTimeOffset.UtcNow;
        await store.TryClaimAsync(_notificationId, _deviceId, sentAtUtc);
        await store.RecordAttemptAsync(
            _notificationId, _deviceId, NotificationDeliveryStatus.Sent, sentAtUtc, "provider-1", null);

        // Even long after any lease timeout would have passed - Sent is a terminal state that is
        // never reclaimable, unlike Failed/stale-Sending.
        var claimedAfterSent = await store.TryClaimAsync(_notificationId, _deviceId, sentAtUtc.AddDays(1));

        Assert.False(claimedAfterSent);
        var delivery = await ReloadDeliveryAsync();
        Assert.Equal(NotificationDeliveryStatus.Sent, delivery.Status);
        Assert.Equal(1, delivery.AttemptCount);
    }
}
