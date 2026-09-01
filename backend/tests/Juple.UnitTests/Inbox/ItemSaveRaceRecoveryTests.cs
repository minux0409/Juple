using Juple.Application.Inbox;
using Juple.Infrastructure.Items;
using Microsoft.EntityFrameworkCore;

namespace Juple.UnitTests.Inbox;

public sealed class ItemSaveRaceRecoveryTests
{
    [Fact]
    public async Task RecoverOrRethrowAsync_WhenUniqueViolationAndExistingUrlMatches_ReplaysExistingEntry()
    {
        var existing = new InboxEntryDto(41, "https://shop.example/item", DateTimeOffset.UtcNow);
        var probe = new RecoveryProbe(existing);

        var result = await ItemSaveRaceRecovery.RecoverOrRethrowAsync(
            new DbUpdateException("Unique inbox entry conflict."),
            isUniqueConstraintViolation: true,
            requestedUrl: existing.Url,
            probe.ClearChangeTracker,
            probe.FindExistingAsync,
            CancellationToken.None);

        Assert.False(result.Created);
        Assert.Equal(existing, result.Entry);
        Assert.True(probe.ChangeTrackerCleared);
        Assert.Equal(1, probe.LookupCount);
    }

    [Fact]
    public async Task RecoverOrRethrowAsync_WhenUniqueViolationAndExistingUrlDiffers_ThrowsConflict()
    {
        var existing = new InboxEntryDto(41, "https://shop.example/item-a", DateTimeOffset.UtcNow);
        var probe = new RecoveryProbe(existing);

        await Assert.ThrowsAsync<InboxEntryClientRequestConflictException>(() =>
            ItemSaveRaceRecovery.RecoverOrRethrowAsync(
                new DbUpdateException("Unique inbox entry conflict."),
                isUniqueConstraintViolation: true,
                requestedUrl: "https://shop.example/item-b",
                probe.ClearChangeTracker,
                probe.FindExistingAsync,
                CancellationToken.None));

        Assert.True(probe.ChangeTrackerCleared);
    }

    [Fact]
    public async Task RecoverOrRethrowAsync_WhenUniqueViolationButNoExistingEntryFound_RethrowsOriginalException()
    {
        var probe = new RecoveryProbe(existing: null);
        var expected = new DbUpdateException("Unique inbox entry conflict.");

        var actual = await Assert.ThrowsAsync<DbUpdateException>(() =>
            ItemSaveRaceRecovery.RecoverOrRethrowAsync(
                expected,
                isUniqueConstraintViolation: true,
                requestedUrl: "https://shop.example/item",
                probe.ClearChangeTracker,
                probe.FindExistingAsync,
                CancellationToken.None));

        Assert.Same(expected, actual);
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
            ItemSaveRaceRecovery.RecoverOrRethrowAsync(
                expected,
                isUniqueConstraintViolation: false,
                requestedUrl: existing.Url,
                probe.ClearChangeTracker,
                probe.FindExistingAsync,
                CancellationToken.None));

        Assert.Same(expected, actual);
        Assert.False(probe.ChangeTrackerCleared);
        Assert.Equal(0, probe.LookupCount);
    }

    private sealed class RecoveryProbe(InboxEntryDto? existing)
    {
        public bool ChangeTrackerCleared { get; private set; }

        public int LookupCount { get; private set; }

        public void ClearChangeTracker() => ChangeTrackerCleared = true;

        public Task<InboxEntryDto?> FindExistingAsync(CancellationToken cancellationToken)
        {
            LookupCount++;
            return Task.FromResult(existing);
        }
    }
}
