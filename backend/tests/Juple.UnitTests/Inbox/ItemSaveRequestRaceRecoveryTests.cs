using Juple.Application.Inbox;
using Juple.Infrastructure.Items;
using Microsoft.EntityFrameworkCore;

namespace Juple.UnitTests.Inbox;

public sealed class ItemSaveRequestRaceRecoveryTests
{
    [Fact]
    public async Task RecoverOrRethrowAsync_WhenUniqueViolationAndExistingUrlMatches_ReplaysExistingEntry()
    {
        var existing = new InboxEntryDto(41, "https://shop.example/item", DateTimeOffset.UtcNow);
        var probe = new RecoveryProbe(existing);

        var result = await ItemSaveRequestRaceRecovery.RecoverOrRethrowAsync(
            new DbUpdateException("Unique item save request conflict."),
            isUniqueConstraintViolation: true,
            requestedUrl: existing.Url,
            probe.RollbackTransactionAsync,
            probe.ClearChangeTracker,
            probe.FindExistingAsync,
            CancellationToken.None);

        Assert.False(result.Created);
        Assert.Equal(existing, result.Entry);
        Assert.True(probe.TransactionRolledBack);
        Assert.True(probe.ChangeTrackerCleared);
        Assert.Equal(1, probe.LookupCount);
    }

    [Fact]
    public async Task RecoverOrRethrowAsync_WhenUniqueViolationAndExistingUrlDiffers_ThrowsConflict()
    {
        var existing = new InboxEntryDto(41, "https://shop.example/item-a", DateTimeOffset.UtcNow);
        var probe = new RecoveryProbe(existing);

        await Assert.ThrowsAsync<InboxEntryClientRequestConflictException>(() =>
            ItemSaveRequestRaceRecovery.RecoverOrRethrowAsync(
                new DbUpdateException("Unique item save request conflict."),
                isUniqueConstraintViolation: true,
                requestedUrl: "https://shop.example/item-b",
                probe.RollbackTransactionAsync,
                probe.ClearChangeTracker,
                probe.FindExistingAsync,
                CancellationToken.None));

        Assert.True(probe.TransactionRolledBack);
        Assert.True(probe.ChangeTrackerCleared);
    }

    [Fact]
    public async Task RecoverOrRethrowAsync_WhenUniqueViolationButNoExistingEntryFound_RethrowsOriginalException()
    {
        var probe = new RecoveryProbe(existing: null);
        var expected = new DbUpdateException("Unique item save request conflict.");

        var actual = await Assert.ThrowsAsync<DbUpdateException>(() =>
            ItemSaveRequestRaceRecovery.RecoverOrRethrowAsync(
                expected,
                isUniqueConstraintViolation: true,
                requestedUrl: "https://shop.example/item",
                probe.RollbackTransactionAsync,
                probe.ClearChangeTracker,
                probe.FindExistingAsync,
                CancellationToken.None));

        Assert.Same(expected, actual);
        Assert.True(probe.TransactionRolledBack);
        Assert.True(probe.ChangeTrackerCleared);
        Assert.Equal(1, probe.LookupCount);
    }

    [Fact]
    public async Task RecoverOrRethrowAsync_WhenNotAUniqueViolation_RethrowsWithoutRecovery()
    {
        var existing = new InboxEntryDto(41, "https://shop.example/item", DateTimeOffset.UtcNow);
        var probe = new RecoveryProbe(existing);
        var expected = new DbUpdateException("Unexpected SQL Server error.");

        var actual = await Assert.ThrowsAsync<DbUpdateException>(() =>
            ItemSaveRequestRaceRecovery.RecoverOrRethrowAsync(
                expected,
                isUniqueConstraintViolation: false,
                requestedUrl: existing.Url,
                probe.RollbackTransactionAsync,
                probe.ClearChangeTracker,
                probe.FindExistingAsync,
                CancellationToken.None));

        Assert.Same(expected, actual);
        Assert.False(probe.TransactionRolledBack);
        Assert.False(probe.ChangeTrackerCleared);
        Assert.Equal(0, probe.LookupCount);
    }

    private sealed class RecoveryProbe(InboxEntryDto? existing)
    {
        public bool TransactionRolledBack { get; private set; }

        public bool ChangeTrackerCleared { get; private set; }

        public int LookupCount { get; private set; }

        public Task RollbackTransactionAsync(CancellationToken cancellationToken)
        {
            TransactionRolledBack = true;
            return Task.CompletedTask;
        }

        public void ClearChangeTracker() => ChangeTrackerCleared = true;

        public Task<InboxEntryDto?> FindExistingAsync(CancellationToken cancellationToken)
        {
            LookupCount++;
            return Task.FromResult(existing);
        }
    }
}
