using Juple.Application.Images;
using Juple.Application.Images.BlobCleanup;
using Juple.Application.Users.DeleteAccount;

namespace Juple.UnitTests.Users;

public sealed class DeleteAccountServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 8, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task DeleteAsync_CallsAccountDeletionStoreWithCurrentUserAndItsOwnBlobPrefix()
    {
        var deletionStore = new FakeAccountDeletionStore();
        var imageStorage = new FakeItemImageStorage();
        var blobCleanupService = new FakeBlobCleanupService();
        var service = new DeleteAccountService(deletionStore, imageStorage, blobCleanupService, NewTimeProvider());

        await service.DeleteAsync(userId: 17);

        Assert.Equal(17L, deletionStore.LastUserId);
        Assert.Equal("items/17/", deletionStore.LastBlobCleanupPrefix);
        Assert.Equal(Now, deletionStore.LastCreatedAtUtc);
    }

    [Fact]
    public async Task DeleteAsync_DeletesSqlDataAndRegistersCleanupTask_ThenImmediatelyTriesToCleanUpThatSameTask()
    {
        var callOrder = new List<string>();
        var deletionStore = new FakeAccountDeletionStore { CallOrder = callOrder, CleanupTaskIdToReturn = 41 };
        var imageStorage = new FakeItemImageStorage();
        var blobCleanupService = new FakeBlobCleanupService { CallOrder = callOrder };
        var service = new DeleteAccountService(deletionStore, imageStorage, blobCleanupService, NewTimeProvider());

        await service.DeleteAsync(17);

        Assert.Equal(["DeleteAllData", "TryCleanup"], callOrder);
        Assert.Equal(41L, blobCleanupService.LastTryCleanupCall);
    }

    [Fact]
    public async Task DeleteAsync_WhenSqlDeletionFails_NeverAttemptsBlobCleanup()
    {
        var deletionStore = new FakeAccountDeletionStore { ThrowOnDelete = true };
        var imageStorage = new FakeItemImageStorage();
        var blobCleanupService = new FakeBlobCleanupService();
        var service = new DeleteAccountService(deletionStore, imageStorage, blobCleanupService, NewTimeProvider());

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.DeleteAsync(17));

        Assert.Null(blobCleanupService.LastTryCleanupCall);
    }

    [Fact]
    public async Task DeleteAsync_WhenImmediateBlobCleanupAttemptFails_StillCompletesSuccessfully()
    {
        // TryCleanupAsync itself never throws (see IBlobCleanupService's own contract) and simply
        // returns false when cleanup could not be completed - the durable task it left behind is
        // enough; DeleteAsync must not surface that as its own failure.
        var deletionStore = new FakeAccountDeletionStore();
        var imageStorage = new FakeItemImageStorage();
        var blobCleanupService = new FakeBlobCleanupService { TryCleanupResult = false };
        var service = new DeleteAccountService(deletionStore, imageStorage, blobCleanupService, NewTimeProvider());

        await service.DeleteAsync(17);
    }

    private static FakeTimeProvider NewTimeProvider() => new(Now);

    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FakeAccountDeletionStore : IAccountDeletionStore
    {
        public bool ThrowOnDelete { get; init; }

        public long CleanupTaskIdToReturn { get; init; } = 1;

        public List<string>? CallOrder { get; init; }

        public long? LastUserId { get; private set; }

        public string? LastBlobCleanupPrefix { get; private set; }

        public DateTimeOffset? LastCreatedAtUtc { get; private set; }

        public Task<long> DeleteAllDataAsync(
            long userId, string blobCleanupPrefix, DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default)
        {
            CallOrder?.Add("DeleteAllData");
            LastUserId = userId;
            LastBlobCleanupPrefix = blobCleanupPrefix;
            LastCreatedAtUtc = createdAtUtc;

            if (ThrowOnDelete)
            {
                throw new InvalidOperationException("Simulated SQL deletion failure.");
            }

            return Task.FromResult(CleanupTaskIdToReturn);
        }
    }

    private sealed class FakeItemImageStorage : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(null);
    }

    private sealed class FakeBlobCleanupService : IBlobCleanupService
    {
        public bool TryCleanupResult { get; init; } = true;

        public List<string>? CallOrder { get; init; }

        public long? LastTryCleanupCall { get; private set; }

        public Task<bool> TryCleanupAsync(long cleanupTaskId, CancellationToken cancellationToken = default)
        {
            CallOrder?.Add("TryCleanup");
            LastTryCleanupCall = cleanupTaskId;
            return Task.FromResult(TryCleanupResult);
        }

        public Task<BlobCleanupRunResult> RunPendingCleanupsAsync(CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteAccountService tests.");
    }
}
