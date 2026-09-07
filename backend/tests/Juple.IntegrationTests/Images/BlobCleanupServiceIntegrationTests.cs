using Azure.Storage.Blobs.Models;
using Juple.Domain.Images;
using Juple.Infrastructure.Images;
using Juple.Infrastructure.Images.BlobCleanup;
using Juple.Infrastructure.Persistence;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.IntegrationTests.Images;

public sealed class BlobCleanupServiceIntegrationTests : IAsyncLifetime
{
    private static readonly byte[] JpegBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46];
    private static readonly DateTimeOffset Now = new(2026, 9, 8, 0, 0, 0, TimeSpan.Zero);

    private JupleDbContext _dbContext = null!;
    private readonly List<long> _cleanupTaskIdsToDelete = [];
    private readonly List<string> _blobPrefixesToDelete = [];

    public Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run Blob cleanup integration tests " +
                "against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        _dbContext = new JupleDbContext(options);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        var blobContainerClient = TestBlobContainerClientFactory.Create();
        foreach (var prefix in _blobPrefixesToDelete)
        {
            await foreach (var blobItem in blobContainerClient.GetBlobsAsync(BlobTraits.None, BlobStates.None, prefix: prefix, cancellationToken: default))
            {
                await blobContainerClient.GetBlobClient(blobItem.Name).DeleteIfExistsAsync();
            }
        }

        foreach (var id in _cleanupTaskIdsToDelete)
        {
            await _dbContext.AccountDeletionBlobCleanups.Where(cleanup => cleanup.Id == id).ExecuteDeleteAsync();
        }

        await _dbContext.DisposeAsync();
    }

    private async Task<long> SeedCleanupTaskAsync(string blobPrefix)
    {
        var cleanupTask = new AccountDeletionBlobCleanup(blobPrefix, Now);
        _dbContext.AccountDeletionBlobCleanups.Add(cleanupTask);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();
        _cleanupTaskIdsToDelete.Add(cleanupTask.Id);
        _blobPrefixesToDelete.Add(blobPrefix);
        return cleanupTask.Id;
    }

    private async Task<DateTimeOffset?> GetFinalSweepAfterUtcAsync(long cleanupTaskId)
    {
        var task = await _dbContext.AccountDeletionBlobCleanups.AsNoTracking()
            .SingleAsync(cleanup => cleanup.Id == cleanupTaskId);
        return task.FinalSweepAfterUtc;
    }

    private async Task<List<string>> ListBlobNamesAsync(
        Azure.Storage.Blobs.BlobContainerClient blobContainerClient, string prefix)
    {
        var names = new List<string>();
        await foreach (var blobItem in blobContainerClient.GetBlobsAsync(BlobTraits.None, BlobStates.None, prefix: prefix, cancellationToken: default))
        {
            names.Add(blobItem.Name);
        }
        return names;
    }

    private ItemImageStore NewItemImageStore(Azure.Storage.Blobs.BlobContainerClient blobContainerClient) =>
        new(_dbContext, TestBlobContainerClientFactory.Service, blobContainerClient,
            TestBlobContainerClientFactory.CreateUserDelegationKeyCache(), NullLogger<ItemImageStore>.Instance);

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    [Fact]
    public async Task TryCleanupAsync_WhenBlobsExistUnderThePrefix_DeletesThemImmediately_ButKeepsTheTaskForAFinalSweep()
    {
        var prefix = $"items/blobcleanup-{Guid.NewGuid():N}/";
        var blobContainerClient = TestBlobContainerClientFactory.Create();
        await blobContainerClient.GetBlobClient($"{prefix}photo-1.jpg").UploadAsync(new MemoryStream(JpegBytes));
        await blobContainerClient.GetBlobClient($"{prefix}photo-2.jpg").UploadAsync(new MemoryStream(JpegBytes));
        var cleanupTaskId = await SeedCleanupTaskAsync(prefix);

        var cleanupStore = new AccountDeletionBlobCleanupStore(_dbContext);
        var itemImageStore = NewItemImageStore(blobContainerClient);
        var service = new BlobCleanupService(
            cleanupStore, itemImageStore, new FixedTimeProvider(Now), NullLogger<BlobCleanupService>.Instance);

        var result = await service.TryCleanupAsync(cleanupTaskId);

        // The Blobs are gone right away - only the durable task's own removal waits for the
        // grace period (see AccountDeletionBlobCleanup.FinalSweepAfterUtc's own remarks).
        Assert.False(result);
        Assert.Empty(await ListBlobNamesAsync(blobContainerClient, prefix));
        var finalSweepAfterUtc = await GetFinalSweepAfterUtcAsync(cleanupTaskId);
        Assert.NotNull(finalSweepAfterUtc);
        Assert.True(finalSweepAfterUtc > Now);
    }

    [Fact]
    public async Task TryCleanupAsync_WhenStorageIsUnreachable_LeavesTheTaskWithAnIncrementedSanitizedAttempt()
    {
        var prefix = $"items/blobcleanup-{Guid.NewGuid():N}/";
        var cleanupTaskId = await SeedCleanupTaskAsync(prefix);

        var cleanupStore = new AccountDeletionBlobCleanupStore(_dbContext);
        var missingContainerClient = TestBlobContainerClientFactory.CreateForMissingContainer();
        var itemImageStore = NewItemImageStore(missingContainerClient);
        var service = new BlobCleanupService(
            cleanupStore, itemImageStore, new FixedTimeProvider(Now), NullLogger<BlobCleanupService>.Instance);

        var result = await service.TryCleanupAsync(cleanupTaskId);

        Assert.False(result);
        var task = await _dbContext.AccountDeletionBlobCleanups.AsNoTracking()
            .SingleAsync(cleanup => cleanup.Id == cleanupTaskId);
        Assert.Equal(1, task.AttemptCount);
        Assert.Equal(Now, task.LastAttemptAtUtc);
        // Sanitized only - never a raw exception message, Blob name, or connection detail.
        Assert.Equal("BlobDeleteIncomplete", task.LastErrorCode);
        Assert.Null(task.FinalSweepAfterUtc);
    }

    [Fact]
    public async Task TryCleanupAsync_ALateBlobDuringTheGracePeriodIsStillCaught_AndTheTaskOnlyClearsAfterAConfirmingFinalSweep()
    {
        // Reproduces the exact race BlobCleanupService's GracePeriod exists for: an
        // already-authenticated, already-ownership-checked upload request whose Blob PUT lands
        // AFTER the immediate post-deletion sweep already found the prefix clean.
        var prefix = $"items/blobcleanup-{Guid.NewGuid():N}/";
        var blobContainerClient = TestBlobContainerClientFactory.Create();
        var cleanupTaskId = await SeedCleanupTaskAsync(prefix);
        var cleanupStore = new AccountDeletionBlobCleanupStore(_dbContext);
        var itemImageStore = NewItemImageStore(blobContainerClient);

        // T0: immediate post-deletion attempt - prefix is genuinely empty right now.
        var immediateService = new BlobCleanupService(
            cleanupStore, itemImageStore, new FixedTimeProvider(Now), NullLogger<BlobCleanupService>.Instance);
        var immediateResult = await immediateService.TryCleanupAsync(cleanupTaskId);
        Assert.False(immediateResult);
        var scheduledFinalSweepAfterUtc = await GetFinalSweepAfterUtcAsync(cleanupTaskId);
        Assert.NotNull(scheduledFinalSweepAfterUtc);

        // T1 (still within the grace period): the racing upload's Blob PUT finally lands.
        var lateBlobName = $"{prefix}{Guid.NewGuid():N}.jpg";
        await blobContainerClient.GetBlobClient(lateBlobName).UploadAsync(new MemoryStream(JpegBytes));
        var midGraceTime = scheduledFinalSweepAfterUtc!.Value.AddMinutes(-1);

        // T2: a retry run before the grace period has elapsed finds and removes the late Blob,
        // but the task itself is not finished yet - the grace period governs the TASK's removal,
        // independent of how many Blobs any individual sweep happens to find and delete.
        var midGraceService = new BlobCleanupService(
            cleanupStore, itemImageStore, new FixedTimeProvider(midGraceTime), NullLogger<BlobCleanupService>.Instance);
        var midGraceResult = await midGraceService.TryCleanupAsync(cleanupTaskId);
        Assert.False(midGraceResult);
        Assert.Empty(await ListBlobNamesAsync(blobContainerClient, prefix));
        Assert.True(await _dbContext.AccountDeletionBlobCleanups.AsNoTracking()
            .AnyAsync(cleanup => cleanup.Id == cleanupTaskId));

        // T3: the final sweep, at or after the originally scheduled time, confirms the prefix is
        // (still) clean and only now removes the task.
        var finalSweepService = new BlobCleanupService(
            cleanupStore, itemImageStore, new FixedTimeProvider(scheduledFinalSweepAfterUtc.Value),
            NullLogger<BlobCleanupService>.Instance);
        var finalResult = await finalSweepService.TryCleanupAsync(cleanupTaskId);
        Assert.True(finalResult);
        Assert.False(await _dbContext.AccountDeletionBlobCleanups.AsNoTracking()
            .AnyAsync(cleanup => cleanup.Id == cleanupTaskId));
    }

    [Fact]
    public async Task TryCleanupAsync_WhenTheFinalSweepItselfFails_LeavesTheTaskPendingForAnotherRetry()
    {
        var prefix = $"items/blobcleanup-{Guid.NewGuid():N}/";
        var blobContainerClient = TestBlobContainerClientFactory.Create();
        var cleanupTaskId = await SeedCleanupTaskAsync(prefix);
        var cleanupStore = new AccountDeletionBlobCleanupStore(_dbContext);

        var immediateService = new BlobCleanupService(
            cleanupStore, NewItemImageStore(blobContainerClient), new FixedTimeProvider(Now),
            NullLogger<BlobCleanupService>.Instance);
        await immediateService.TryCleanupAsync(cleanupTaskId);
        var scheduledFinalSweepAfterUtc = (await GetFinalSweepAfterUtcAsync(cleanupTaskId))!.Value;

        // Storage becomes unreachable right at the moment the final sweep would otherwise run.
        var failingFinalSweepService = new BlobCleanupService(
            cleanupStore, NewItemImageStore(TestBlobContainerClientFactory.CreateForMissingContainer()),
            new FixedTimeProvider(scheduledFinalSweepAfterUtc), NullLogger<BlobCleanupService>.Instance);
        var result = await failingFinalSweepService.TryCleanupAsync(cleanupTaskId);

        Assert.False(result);
        var task = await _dbContext.AccountDeletionBlobCleanups.AsNoTracking()
            .SingleAsync(cleanup => cleanup.Id == cleanupTaskId);
        Assert.Equal(1, task.AttemptCount);
        // The earlier successful confirmation is not lost - the next successful attempt at or
        // after this same scheduled time can still finish the task.
        Assert.Equal(scheduledFinalSweepAfterUtc, task.FinalSweepAfterUtc);
    }

    [Fact]
    public async Task RunPendingCleanupsAsync_ProcessesMultiplePendingTasks_EachOnlyAffectingItsOwnPrefix()
    {
        var blobContainerClient = TestBlobContainerClientFactory.Create();
        var firstPrefix = $"items/blobcleanup-{Guid.NewGuid():N}/";
        var secondPrefix = $"items/blobcleanup-{Guid.NewGuid():N}/";
        await blobContainerClient.GetBlobClient($"{firstPrefix}photo.jpg").UploadAsync(new MemoryStream(JpegBytes));
        await blobContainerClient.GetBlobClient($"{secondPrefix}photo.jpg").UploadAsync(new MemoryStream(JpegBytes));
        var firstTaskId = await SeedCleanupTaskAsync(firstPrefix);
        var secondTaskId = await SeedCleanupTaskAsync(secondPrefix);

        var cleanupStore = new AccountDeletionBlobCleanupStore(_dbContext);
        var service = new BlobCleanupService(
            cleanupStore, NewItemImageStore(blobContainerClient), new FixedTimeProvider(Now),
            NullLogger<BlobCleanupService>.Instance);

        // Aggregate counts aren't asserted here - RunPendingCleanupsAsync processes every pending
        // task system-wide (by design), and another integration test class's own
        // AccountDeletionBlobCleanup rows may exist concurrently in this shared local SQL Server
        // database. This test's own two tasks/prefixes are what's verified below.
        await service.RunPendingCleanupsAsync();

        foreach (var (taskId, prefix) in new[] { (firstTaskId, firstPrefix), (secondTaskId, secondPrefix) })
        {
            // Both Blobs are gone immediately, and each task independently has its own final
            // sweep scheduled - neither call affected the other prefix's Blob or task.
            Assert.Empty(await ListBlobNamesAsync(blobContainerClient, prefix));
            Assert.NotNull(await GetFinalSweepAfterUtcAsync(taskId));
        }
    }
}
