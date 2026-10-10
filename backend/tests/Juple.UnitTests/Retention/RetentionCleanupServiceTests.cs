using Juple.Application.Images;
using Juple.Application.Retention;

namespace Juple.UnitTests.Retention;

public sealed class RetentionOptionsTests
{
    [Fact]
    public void TheApprovedWorkingPolicy_IsTheDefault_AndIsValid()
    {
        var options = new RetentionOptions();

        Assert.Equal(24, options.TrialLedgerMonthsAfterTrialEnd);
        Assert.Equal(180, options.SealedPurchaseTokenDaysAfterAccessEnd);
        Assert.Equal(5, options.PurchaseRecordYearsAfterAccessEnd);
        Assert.Equal(90, options.ProcessedBillingEventDays);
        Assert.Equal(30, options.SoftDeletedCollectionDays);
        Assert.Equal(90, options.NotificationDays);
        Assert.Equal(180, options.StalePushTokenDays);
        Assert.Equal(30, options.TrashDays);
        RetentionOptionsValidator.Validate(options);
    }

    [Theory]
    [InlineData(nameof(RetentionOptions.TrialLedgerMonthsAfterTrialEnd))]
    [InlineData(nameof(RetentionOptions.SealedPurchaseTokenDaysAfterAccessEnd))]
    [InlineData(nameof(RetentionOptions.PurchaseRecordYearsAfterAccessEnd))]
    [InlineData(nameof(RetentionOptions.ProcessedBillingEventDays))]
    [InlineData(nameof(RetentionOptions.SoftDeletedCollectionDays))]
    [InlineData(nameof(RetentionOptions.NotificationDays))]
    [InlineData(nameof(RetentionOptions.StalePushTokenDays))]
    [InlineData(nameof(RetentionOptions.TrashDays))]
    [InlineData(nameof(RetentionOptions.BatchSize))]
    [InlineData(nameof(RetentionOptions.MaxBatchesPerCategory))]
    public void ZeroOrNegative_StopsTheJobBeforeAnythingIsPurged(string property)
    {
        foreach (var bad in new[] { 0, -1 })
        {
            var options = new RetentionOptions();
            typeof(RetentionOptions).GetProperty(property)!.SetValue(options, bad);
            var exception = Assert.Throws<InvalidOperationException>(() => RetentionOptionsValidator.Validate(options));
            Assert.Contains(property, exception.Message);
        }
    }

    [Fact]
    public void TheSealedTokenMustGoBeforeTheRecordItBelongsTo()
    {
        var options = new RetentionOptions { SealedPurchaseTokenDaysAfterAccessEnd = 365 * 5, PurchaseRecordYearsAfterAccessEnd = 5 };
        Assert.Throws<InvalidOperationException>(() => RetentionOptionsValidator.Validate(options));
    }
}

public sealed class RetentionCleanupServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 10, 3, 17, 0, TimeSpan.Zero);

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FakeStore : IRetentionStore
    {
        public Dictionary<string, Queue<int>> Script { get; } = [];

        public Dictionary<string, List<DateTimeOffset>> Cutoffs { get; } = [];

        public List<string> CallOrder { get; } = [];

        public HashSet<string> Throwing { get; } = [];

        public Queue<IReadOnlyList<PurgedItem>> TrashBatches { get; } = new();

        public int BatchSizeSeen { get; private set; }

        private Task<int> Next(string category, DateTimeOffset cutoff, int batchSize)
        {
            BatchSizeSeen = batchSize;
            CallOrder.Add(category);
            if (!Cutoffs.TryGetValue(category, out var list))
            {
                Cutoffs[category] = list = [];
            }

            list.Add(cutoff);
            if (Throwing.Contains(category))
            {
                throw new InvalidOperationException("boom");
            }

            return Task.FromResult(Script.TryGetValue(category, out var queue) && queue.Count > 0 ? queue.Dequeue() : 0);
        }

        public Task<int> DeleteTrialLedgerEntriesEndedBeforeAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken = default) => Next("trialLedger", cutoff, batchSize);

        public Task<int> ClearSealedPurchaseTokensAsync(DateTimeOffset cutoff, DateTimeOffset nowUtc, int batchSize, CancellationToken cancellationToken = default) => Next("purchaseSealedTokens", cutoff, batchSize);

        public Task<int> DeleteEndedPurchaseRecordsAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken = default) => Next("purchaseRecords", cutoff, batchSize);

        public Task<int> DeleteProcessedStoreEventsAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken = default) => Next("processedBillingEvents", cutoff, batchSize);

        public Task<int> DeleteMergeOperationsAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken = default) => Next("mergeUndoHistory", cutoff, batchSize);

        public Task<int> DeleteSoftDeletedCollectionsAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken = default) => Next("softDeletedCollections", cutoff, batchSize);

        public Task<int> DeleteNotificationsAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken = default) => Next("notifications", cutoff, batchSize);

        public Task<int> DeleteStalePushRegistrationsAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken = default) => Next("stalePushTokens", cutoff, batchSize);

        public Task<IReadOnlyList<PurgedItem>> DeleteExpiredTrashItemsAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken = default)
        {
            CallOrder.Add("trashItems");
            if (!Cutoffs.TryGetValue("trashItems", out var list))
            {
                Cutoffs["trashItems"] = list = [];
            }

            list.Add(cutoff);
            if (Throwing.Contains("trashItems"))
            {
                throw new InvalidOperationException("boom");
            }

            return Task.FromResult(TrashBatches.Count > 0 ? TrashBatches.Dequeue() : []);
        }
    }

    private sealed class FakeImages : IItemImageStorage
    {
        public List<(long UserId, long ItemId)> Deleted { get; } = [];

        public bool Throw { get; set; }

        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default)
        {
            Deleted.Add((userId, itemId));
            return Throw ? throw new InvalidOperationException("blob") : Task.CompletedTask;
        }

        public string GetUserBlobPrefix(long userId) => throw new NotSupportedException();

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    private static RetentionCleanupService Create(FakeStore store, FakeImages? images = null, RetentionOptions? options = null) =>
        new(store, images ?? new FakeImages(), options ?? new RetentionOptions(), new FixedTime(Now));

    [Fact]
    public async Task EveryCategory_UsesItsOwnApprovedPeriod_FromTheOneOptionsObject()
    {
        var store = new FakeStore();

        var result = await Create(store).RunAsync();

        Assert.False(result.HasFailures);
        Assert.Equal(Now.AddMonths(-24), store.Cutoffs["trialLedger"].Single());
        Assert.Equal(Now.AddDays(-180), store.Cutoffs["purchaseSealedTokens"].Single());
        Assert.Equal(Now.AddYears(-5), store.Cutoffs["purchaseRecords"].Single());
        Assert.Equal(Now.AddDays(-90), store.Cutoffs["processedBillingEvents"].Single());
        Assert.Equal(Now.AddDays(-30), store.Cutoffs["mergeUndoHistory"].Single());
        Assert.Equal(Now.AddDays(-30), store.Cutoffs["softDeletedCollections"].Single());
        Assert.Equal(Now.AddDays(-90), store.Cutoffs["notifications"].Single());
        Assert.Equal(Now.AddDays(-180), store.Cutoffs["stalePushTokens"].Single());
        Assert.Equal(Now.AddDays(-30), store.Cutoffs["trashItems"].Single());
    }

    [Fact]
    public async Task ChangingAnOption_ChangesTheCutoff_NothingElseCarriesANumber()
    {
        var store = new FakeStore();

        await Create(store, options: new RetentionOptions { NotificationDays = 45, TrashDays = 7 }).RunAsync();

        Assert.Equal(Now.AddDays(-45), store.Cutoffs["notifications"].Single());
        Assert.Equal(Now.AddDays(-7), store.Cutoffs["trashItems"].Single());
    }

    [Fact]
    public async Task MergeHistory_IsRemovedBeforeTheCollectionsItPointsAt()
    {
        var store = new FakeStore();

        await Create(store).RunAsync();

        Assert.True(store.CallOrder.IndexOf("mergeUndoHistory") < store.CallOrder.IndexOf("softDeletedCollections"));
        Assert.True(store.CallOrder.IndexOf("purchaseSealedTokens") < store.CallOrder.IndexOf("purchaseRecords"));
    }

    [Fact]
    public async Task ABatchThatIsFull_ContinuesUntilOneIsNot_AndEveryBatchIsBounded()
    {
        var store = new FakeStore();
        store.Script["notifications"] = new Queue<int>([500, 500, 120]);

        var result = await Create(store).RunAsync();

        var notifications = result.Categories.Single(category => category.Category == "notifications");
        Assert.Equal(1120, notifications.Purged);
        Assert.Equal(3, notifications.Batches);
        Assert.False(notifications.HitBatchLimit);
        Assert.Equal(500, store.BatchSizeSeen);
    }

    [Fact]
    public async Task ARunIsAlwaysBounded_TheNextOneContinues()
    {
        var store = new FakeStore();
        store.Script["notifications"] = new Queue<int>(Enumerable.Repeat(500, 10));

        var result = await Create(store, options: new RetentionOptions { MaxBatchesPerCategory = 3 }).RunAsync();

        var notifications = result.Categories.Single(category => category.Category == "notifications");
        Assert.Equal(3, notifications.Batches);
        Assert.Equal(1500, notifications.Purged);
        Assert.True(notifications.HitBatchLimit);
        Assert.False(result.HasFailures);
    }

    [Fact]
    public async Task OneFailingCategory_NeverStopsTheOthers_AndIsReported()
    {
        var store = new FakeStore();
        store.Throwing.Add("softDeletedCollections");
        store.Script["notifications"] = new Queue<int>([7]);

        var result = await Create(store).RunAsync();

        Assert.True(result.HasFailures);
        var failed = result.Categories.Single(category => category.ErrorType is not null);
        Assert.Equal("softDeletedCollections", failed.Category);
        Assert.Equal(nameof(InvalidOperationException), failed.ErrorType);
        Assert.Equal(7, result.Categories.Single(category => category.Category == "notifications").Purged);
        Assert.Contains("trashItems", store.CallOrder);
    }

    [Fact]
    public async Task TheWorkDoneBeforeAFailure_IsStillCounted_ItIsNotRolledBackAcrossBatches()
    {
        var store = new FakeStore();
        store.Script["notifications"] = new Queue<int>([500]);
        // the second batch of this category throws
        var failing = new ThrowingOnSecondBatchStore(store);

        var result = await new RetentionCleanupService(failing, new FakeImages(), new RetentionOptions(), new FixedTime(Now)).RunAsync();

        var notifications = result.Categories.Single(category => category.Category == "notifications");
        Assert.Equal(500, notifications.Purged);
        Assert.Equal(nameof(InvalidOperationException), notifications.ErrorType);
    }

    private sealed class ThrowingOnSecondBatchStore(FakeStore inner) : IRetentionStore
    {
        private int _notificationCalls;

        public Task<int> DeleteNotificationsAsync(DateTimeOffset createdBeforeUtc, int batchSize, CancellationToken cancellationToken = default) =>
            ++_notificationCalls == 2 ? throw new InvalidOperationException("second batch") : inner.DeleteNotificationsAsync(createdBeforeUtc, batchSize, cancellationToken);

        public Task<int> DeleteTrialLedgerEntriesEndedBeforeAsync(DateTimeOffset a, int b, CancellationToken c = default) => inner.DeleteTrialLedgerEntriesEndedBeforeAsync(a, b, c);

        public Task<int> ClearSealedPurchaseTokensAsync(DateTimeOffset a, DateTimeOffset n, int b, CancellationToken c = default) => inner.ClearSealedPurchaseTokensAsync(a, n, b, c);

        public Task<int> DeleteEndedPurchaseRecordsAsync(DateTimeOffset a, int b, CancellationToken c = default) => inner.DeleteEndedPurchaseRecordsAsync(a, b, c);

        public Task<int> DeleteProcessedStoreEventsAsync(DateTimeOffset a, int b, CancellationToken c = default) => inner.DeleteProcessedStoreEventsAsync(a, b, c);

        public Task<int> DeleteMergeOperationsAsync(DateTimeOffset a, int b, CancellationToken c = default) => inner.DeleteMergeOperationsAsync(a, b, c);

        public Task<int> DeleteSoftDeletedCollectionsAsync(DateTimeOffset a, int b, CancellationToken c = default) => inner.DeleteSoftDeletedCollectionsAsync(a, b, c);

        public Task<int> DeleteStalePushRegistrationsAsync(DateTimeOffset a, int b, CancellationToken c = default) => inner.DeleteStalePushRegistrationsAsync(a, b, c);

        public Task<IReadOnlyList<PurgedItem>> DeleteExpiredTrashItemsAsync(DateTimeOffset a, int b, CancellationToken c = default) => inner.DeleteExpiredTrashItemsAsync(a, b, c);
    }

    [Fact]
    public async Task PurgedTrashLinks_HaveTheirBlobsRemoved_AndABlobFailureNeverFailsThePass()
    {
        var store = new FakeStore();
        store.TrashBatches.Enqueue([new PurgedItem(1, 10), new PurgedItem(2, 20)]);
        var images = new FakeImages { Throw = true };

        var result = await Create(store, images).RunAsync();

        Assert.Equal([(1L, 10L), (2L, 20L)], images.Deleted);
        Assert.False(result.HasFailures);
        Assert.Equal(2, result.Categories.Single(category => category.Category == "trashItems").Purged);
    }

    [Fact]
    public async Task NoWork_IsAHarmlessEmptyPass()
    {
        var result = await Create(new FakeStore()).RunAsync();

        Assert.Equal(0, result.TotalPurged);
        Assert.False(result.HasFailures);
        Assert.Equal(9, result.Categories.Count);
    }
}
