using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Images;
using Juple.Application.Images.BlobCleanup;
using Juple.Application.Users.DeleteAccount;
using static Juple.UnitTests.Users.EntraTestDoubles;

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
        var service = NewService(deletionStore, imageStorage, blobCleanupService);

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
        var service = NewService(deletionStore, imageStorage, blobCleanupService);

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
        var service = NewService(deletionStore, imageStorage, blobCleanupService);

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
        var service = NewService(deletionStore, imageStorage, blobCleanupService);

        await service.DeleteAsync(17);
    }

    [Fact]
    public async Task DeleteRecentlyAuthenticatedAsync_AfterAFreshSignIn_DeletesExactlyWhatDeleteAsyncDeletes()
    {
        var deletionStore = new FakeAccountDeletionStore();
        var blobCleanupService = new FakeBlobCleanupService();
        var service = NewService(deletionStore, new FakeItemImageStorage(), blobCleanupService);

        await service.DeleteRecentlyAuthenticatedAsync(17, authenticatedAtUtc: Now.AddMinutes(-1));

        Assert.Equal(17L, deletionStore.LastUserId);
        Assert.Equal("items/17/", deletionStore.LastBlobCleanupPrefix);
        Assert.NotNull(blobCleanupService.LastTryCleanupCall);
    }

    public static TheoryData<DateTimeOffset?> StaleOrMissingSignIns => new()
    {
        null, // no verifiable auth_time on the token
        Now.AddMinutes(-6), // older than RecentAuthentication.MaxAge (a refreshed session keeps its old auth_time)
        Now.AddMinutes(5), // implausibly in the future
    };

    [Theory]
    [MemberData(nameof(StaleOrMissingSignIns))]
    public async Task DeleteRecentlyAuthenticatedAsync_WithoutARecentSignIn_DeletesNothing(DateTimeOffset? authenticatedAtUtc)
    {
        var deletionStore = new FakeAccountDeletionStore();
        var blobCleanupService = new FakeBlobCleanupService();
        var service = NewService(deletionStore, new FakeItemImageStorage(), blobCleanupService);

        await Assert.ThrowsAsync<Juple.Application.Collections.Locking.RecentAuthenticationRequiredException>(
            () => service.DeleteRecentlyAuthenticatedAsync(17, authenticatedAtUtc));

        Assert.Null(deletionStore.LastUserId);
        Assert.Null(blobCleanupService.LastTryCleanupCall);
    }

    [Fact]
    public async Task DeleteAsync_WhenEntraDeletionIsDisabled_BehavesAsBefore_NoTaskNoDirectoryCall()
    {
        var store = new FakeAccountDeletionStore { Identity = CustomerIdentity, EntraTaskIdToReturn = 5 };
        var directory = new FakeDirectory { Email = "a@b.com" };
        var entraDeletion = new FakeDeletionService();
        var service = NewService(store, new FakeItemImageStorage(), new FakeBlobCleanupService(), new EntraAccountDeletionOptions(), directory, entraDeletion);

        await service.DeleteAsync(17);

        Assert.False(store.LastPlan!.RegisterEntraIdentityDeletion);
        Assert.Null(store.LastPlan.TrialEmailHash);
        Assert.Empty(entraDeletion.Completed);
        Assert.Empty(directory.Deleted);
    }

    [Fact]
    public async Task DeleteAsync_WhenEnabled_RegistersTheTaskWithTheSqlDeletion_AndOnlyThenDeletesTheEntraUser()
    {
        var store = new FakeAccountDeletionStore { Identity = CustomerIdentity, EntraTaskIdToReturn = 77 };
        var entraDeletion = new FakeDeletionService();
        var entitlements = new FakeEntitlements();
        var service = NewService(store, new FakeItemImageStorage(), new FakeBlobCleanupService(), EnabledOptions(), new FakeDirectory { Email = "Person@Example.com" }, entraDeletion, null, entitlements);

        await service.DeleteAsync(17);

        Assert.True(store.LastPlan!.RegisterEntraIdentityDeletion);
        Assert.Equal([77L], entraDeletion.Completed);
        // The trial window is settled first, then remembered under the keyed email hash (case-insensitive).
        Assert.Equal([17L], entitlements.SettledUsers);
        Assert.Equal(Hasher().HashEmail("person@example.com"), store.LastPlan.TrialEmailHash);
    }

    [Fact]
    public async Task DeleteAsync_ADifferentTenantsIdentity_IsNeverHandedToTheDirectory()
    {
        var store = new FakeAccountDeletionStore { Identity = new ExternalIdentityPrincipal(Guid.NewGuid(), Guid.NewGuid()), EntraTaskIdToReturn = 9 };
        var entraDeletion = new FakeDeletionService();
        var service = NewService(store, new FakeItemImageStorage(), new FakeBlobCleanupService(), EnabledOptions(), new FakeDirectory { Email = "a@b.com" }, entraDeletion);

        await service.DeleteAsync(17);

        Assert.False(store.LastPlan!.RegisterEntraIdentityDeletion);
        Assert.Empty(entraDeletion.Completed);
    }

    [Fact]
    public async Task DeleteAsync_WhenTheEmailOrTrialLookupFails_StillDeletes_WithoutTrialMemory()
    {
        var store = new FakeAccountDeletionStore { Identity = CustomerIdentity, EntraTaskIdToReturn = 3 };
        var service = NewService(store, new FakeItemImageStorage(), new FakeBlobCleanupService(), EnabledOptions(), new FakeDirectory { Email = "a@b.com" }, null, null, new FakeEntitlements { Throw = true });

        await service.DeleteAsync(17);

        Assert.True(store.LastPlan!.RegisterEntraIdentityDeletion);
        Assert.Null(store.LastPlan.TrialEmailHash);
    }

    [Fact]
    public async Task DeleteAsync_WithoutAHashKey_OrEmail_RemembersNoTrialHash()
    {
        var withoutKey = new FakeAccountDeletionStore { Identity = CustomerIdentity };
        await NewService(withoutKey, new FakeItemImageStorage(), new FakeBlobCleanupService(), EnabledOptions(), new FakeDirectory { Email = "a@b.com" }, null, HasherWithoutKey()).DeleteAsync(17);
        Assert.Null(withoutKey.LastPlan!.TrialEmailHash);

        var withoutEmail = new FakeAccountDeletionStore { Identity = CustomerIdentity };
        await NewService(withoutEmail, new FakeItemImageStorage(), new FakeBlobCleanupService(), EnabledOptions(), new FakeDirectory { Email = null }).DeleteAsync(17);
        Assert.Null(withoutEmail.LastPlan!.TrialEmailHash);
    }

    [Fact]
    public async Task DeleteAsync_WhenSqlDeletionFails_NeverCallsEntra()
    {
        var store = new FakeAccountDeletionStore { Identity = CustomerIdentity, ThrowOnDelete = true, EntraTaskIdToReturn = 4 };
        var entraDeletion = new FakeDeletionService();
        var service = NewService(store, new FakeItemImageStorage(), new FakeBlobCleanupService(), EnabledOptions(), null, entraDeletion);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.DeleteAsync(17));

        Assert.Empty(entraDeletion.Completed);
    }

    private static DeleteAccountService NewService(
        IAccountDeletionStore store,
        IItemImageStorage storage,
        IBlobCleanupService blobCleanup,
        EntraAccountDeletionOptions? options = null,
        FakeDirectory? directory = null,
        FakeDeletionService? entraDeletion = null,
        ITrialIdentityHasher? hasher = null,
        FakeEntitlements? entitlements = null) =>
        new(store, storage, blobCleanup, directory ?? new FakeDirectory(), entraDeletion ?? new FakeDeletionService(),
            hasher ?? Hasher(), entitlements ?? new FakeEntitlements(), options ?? new EntraAccountDeletionOptions(), NewTimeProvider());

    private static readonly ExternalIdentityPrincipal CustomerIdentity = new(CustomerTenant, Guid.Parse("11111111-2222-3333-4444-555555555555"));

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

        public ExternalIdentityPrincipal? Identity { get; init; }

        public AccountDeletionPlan? LastPlan { get; private set; }

        public long? EntraTaskIdToReturn { get; init; }

        public Task<ExternalIdentityPrincipal?> GetExternalIdentityAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Identity);

        public async Task<AccountDeletionResult> DeleteAllDataAsync(long userId, AccountDeletionPlan plan, CancellationToken cancellationToken = default)
        {
            LastPlan = plan;
            var blobTaskId = await DeleteAllDataAsync(userId, plan.BlobCleanupPrefix, plan.CreatedAtUtc, cancellationToken);
            return new AccountDeletionResult(blobTaskId, plan.RegisterEntraIdentityDeletion ? EntraTaskIdToReturn : null);
        }

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
