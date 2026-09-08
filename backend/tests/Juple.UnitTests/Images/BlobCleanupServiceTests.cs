using Juple.Application.Images;
using Juple.Application.Images.BlobCleanup;
using Juple.Infrastructure.Images.BlobCleanup;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.UnitTests.Images;

public sealed class BlobCleanupServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 8, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task TryCleanupAsync_WhenPrefixIsCleanForTheFirstTime_SchedulesAFinalSweepInsteadOfDeletingTheTask()
    {
        // A single clean result is not proof the prefix will stay clean - see BlobCleanupService's
        // own remarks on why an in-flight, already-authenticated upload racing account deletion
        // means a later Blob can still land. The task must survive until a SECOND clean result,
        // strictly after the scheduled grace period.
        var cleanupStore = new FakeAccountDeletionBlobCleanupStore();
        cleanupStore.Seed(new PendingBlobCleanupDto(1, "items/17/", 0, FinalSweepAfterUtc: null));
        var imageStorage = new FakeItemImageStorage { DeleteBlobsByPrefixResult = true };
        var service = new BlobCleanupService(cleanupStore, imageStorage, NewTimeProvider(), NullLogger<BlobCleanupService>.Instance);

        var result = await service.TryCleanupAsync(1);

        Assert.False(result);
        Assert.DoesNotContain(1L, cleanupStore.DeletedIds);
        var (id, finalSweepAfterUtc) = Assert.Single(cleanupStore.ScheduledFinalSweeps);
        Assert.Equal(1L, id);
        Assert.True(finalSweepAfterUtc > Now);
        Assert.Empty(cleanupStore.RecordedFailedAttempts);
    }

    [Fact]
    public async Task TryCleanupAsync_WhenAlreadyScheduledAndGracePeriodHasNotElapsed_LeavesTheTaskUntouched()
    {
        var cleanupStore = new FakeAccountDeletionBlobCleanupStore();
        var finalSweepAfterUtc = Now.AddMinutes(5);
        cleanupStore.Seed(new PendingBlobCleanupDto(1, "items/17/", 0, finalSweepAfterUtc));
        var imageStorage = new FakeItemImageStorage { DeleteBlobsByPrefixResult = true };
        var service = new BlobCleanupService(cleanupStore, imageStorage, NewTimeProvider(), NullLogger<BlobCleanupService>.Instance);

        var result = await service.TryCleanupAsync(1);

        Assert.False(result);
        Assert.DoesNotContain(1L, cleanupStore.DeletedIds);
        Assert.Empty(cleanupStore.ScheduledFinalSweeps);
        Assert.Empty(cleanupStore.RecordedFailedAttempts);
    }

    [Fact]
    public async Task TryCleanupAsync_WhenGracePeriodHasElapsedAndPrefixIsStillClean_DeletesTheTaskAndReturnsTrue()
    {
        var cleanupStore = new FakeAccountDeletionBlobCleanupStore();
        var finalSweepAfterUtc = Now.AddMinutes(-1);
        cleanupStore.Seed(new PendingBlobCleanupDto(1, "items/17/", 0, finalSweepAfterUtc));
        var imageStorage = new FakeItemImageStorage { DeleteBlobsByPrefixResult = true };
        var service = new BlobCleanupService(cleanupStore, imageStorage, NewTimeProvider(), NullLogger<BlobCleanupService>.Instance);

        var result = await service.TryCleanupAsync(1);

        Assert.True(result);
        Assert.Contains(1L, cleanupStore.DeletedIds);
    }

    [Fact]
    public async Task TryCleanupAsync_WhenPrefixCleanupIsIncomplete_RecordsAFailedAttemptAndReturnsFalse()
    {
        var cleanupStore = new FakeAccountDeletionBlobCleanupStore();
        cleanupStore.Seed(new PendingBlobCleanupDto(1, "items/17/", 2, FinalSweepAfterUtc: null));
        var imageStorage = new FakeItemImageStorage { DeleteBlobsByPrefixResult = false };
        var service = new BlobCleanupService(cleanupStore, imageStorage, NewTimeProvider(), NullLogger<BlobCleanupService>.Instance);

        var result = await service.TryCleanupAsync(1);

        Assert.False(result);
        Assert.DoesNotContain(1L, cleanupStore.DeletedIds);
        var (id, errorCode, attemptedAtUtc) = Assert.Single(cleanupStore.RecordedFailedAttempts);
        Assert.Equal(1L, id);
        Assert.Equal("BlobDeleteIncomplete", errorCode);
        Assert.Equal(Now, attemptedAtUtc);
    }

    [Fact]
    public async Task TryCleanupAsync_WhenStorageThrowsUnexpectedly_RecordsTheExceptionTypeNameAndReturnsFalse()
    {
        var cleanupStore = new FakeAccountDeletionBlobCleanupStore();
        cleanupStore.Seed(new PendingBlobCleanupDto(1, "items/17/", 0, FinalSweepAfterUtc: null));
        var imageStorage = new FakeItemImageStorage { ThrowOnDeleteBlobsByPrefix = new InvalidOperationException("boom") };
        var service = new BlobCleanupService(cleanupStore, imageStorage, NewTimeProvider(), NullLogger<BlobCleanupService>.Instance);

        var result = await service.TryCleanupAsync(1);

        Assert.False(result);
        var (_, errorCode, _) = Assert.Single(cleanupStore.RecordedFailedAttempts);
        // Only the exception's type name, never its message - see AccountDeletionBlobCleanup's own
        // remarks on never storing anything beyond a sanitized code here.
        Assert.Equal(nameof(InvalidOperationException), errorCode);
    }

    [Fact]
    public async Task TryCleanupAsync_WhenTheTaskNoLongerExists_ReturnsTrueWithoutAttemptingAnyCleanup()
    {
        var cleanupStore = new FakeAccountDeletionBlobCleanupStore();
        var imageStorage = new FakeItemImageStorage();
        var service = new BlobCleanupService(cleanupStore, imageStorage, NewTimeProvider(), NullLogger<BlobCleanupService>.Instance);

        var result = await service.TryCleanupAsync(999);

        Assert.True(result);
        Assert.False(imageStorage.WasDeleteBlobsByPrefixCalled);
    }

    [Fact]
    public async Task RunPendingCleanupsAsync_ProcessesEveryPendingTask_SeparatesDeferredProgressFromGenuineFailures()
    {
        var cleanupStore = new FakeAccountDeletionBlobCleanupStore();
        cleanupStore.Seed(
            // Already past its grace period and clean again - this one finishes.
            new PendingBlobCleanupDto(1, "items/1/", 0, Now.AddMinutes(-1)),
            // A genuine Storage failure.
            new PendingBlobCleanupDto(2, "items/2/", 0, FinalSweepAfterUtc: null),
            // Clean for the first time - only schedules a final sweep. Not a failure.
            new PendingBlobCleanupDto(3, "items/3/", 0, FinalSweepAfterUtc: null),
            // Already scheduled, grace period not yet elapsed. Also not a failure.
            new PendingBlobCleanupDto(4, "items/4/", 0, Now.AddMinutes(5)));
        var imageStorage = new FakeItemImageStorage
        {
            DeleteBlobsByPrefixResultByPrefix = new Dictionary<string, bool>
            {
                ["items/1/"] = true,
                ["items/2/"] = false,
                ["items/3/"] = true,
                ["items/4/"] = true,
            },
        };
        var service = new BlobCleanupService(cleanupStore, imageStorage, NewTimeProvider(), NullLogger<BlobCleanupService>.Instance);

        var result = await service.RunPendingCleanupsAsync();

        Assert.Equal(new BlobCleanupRunResult(Pending: 4, Succeeded: 1, Failed: 1, Deferred: 2), result);
        Assert.Equal([1L], cleanupStore.DeletedIds);
        Assert.Single(cleanupStore.RecordedFailedAttempts, attempt => attempt.Id == 2L);
        Assert.Single(cleanupStore.ScheduledFinalSweeps, scheduled => scheduled.Id == 3L);
    }

    private static FakeTimeProvider NewTimeProvider() => new(Now);

    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FakeAccountDeletionBlobCleanupStore : IAccountDeletionBlobCleanupStore
    {
        private readonly Dictionary<long, PendingBlobCleanupDto> _pending = [];

        public List<long> DeletedIds { get; } = [];

        public List<(long Id, string? ErrorCode, DateTimeOffset AttemptedAtUtc)> RecordedFailedAttempts { get; } = [];

        public List<(long Id, DateTimeOffset FinalSweepAfterUtc)> ScheduledFinalSweeps { get; } = [];

        public void Seed(params PendingBlobCleanupDto[] tasks)
        {
            foreach (var task in tasks)
            {
                _pending[task.Id] = task;
            }
        }

        public Task<PendingBlobCleanupDto?> GetAsync(long id, CancellationToken cancellationToken = default) =>
            Task.FromResult(_pending.GetValueOrDefault(id));

        public Task<IReadOnlyList<PendingBlobCleanupDto>> ListPendingAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PendingBlobCleanupDto>>([.. _pending.Values]);

        public Task RecordFailedAttemptAsync(
            long id, string? errorCode, DateTimeOffset attemptedAtUtc, CancellationToken cancellationToken = default)
        {
            RecordedFailedAttempts.Add((id, errorCode, attemptedAtUtc));
            return Task.CompletedTask;
        }

        public Task ScheduleFinalSweepAsync(
            long id, DateTimeOffset finalSweepAfterUtc, CancellationToken cancellationToken = default)
        {
            ScheduledFinalSweeps.Add((id, finalSweepAfterUtc));
            return Task.CompletedTask;
        }

        public Task DeleteAsync(long id, CancellationToken cancellationToken = default)
        {
            DeletedIds.Add(id);
            _pending.Remove(id);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeItemImageStorage : IItemImageStorage
    {
        public bool DeleteBlobsByPrefixResult { get; init; } = true;

        public Dictionary<string, bool>? DeleteBlobsByPrefixResultByPrefix { get; init; }

        public Exception? ThrowOnDeleteBlobsByPrefix { get; init; }

        public bool WasDeleteBlobsByPrefixCalled { get; private set; }

        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default)
        {
            WasDeleteBlobsByPrefixCalled = true;
            if (ThrowOnDeleteBlobsByPrefix is not null)
            {
                throw ThrowOnDeleteBlobsByPrefix;
            }

            var result = DeleteBlobsByPrefixResultByPrefix?.GetValueOrDefault(prefix, false) ?? DeleteBlobsByPrefixResult;
            return Task.FromResult(result);
        }

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(null);
    }
}
