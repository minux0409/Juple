using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Microsoft.EntityFrameworkCore;

namespace Juple.UnitTests.Users.BootstrapCurrentUser;

public sealed class ExternalIdentityRaceRecoveryTests
{
    [Theory]
    [InlineData(2601)]
    [InlineData(2627)]
    public void IsSqlServerUniqueConstraintViolation_WhenUniqueConstraintError_ReturnsTrue(
        int errorNumber)
    {
        Assert.True(ExternalIdentityRaceRecovery.IsSqlServerUniqueConstraintViolation(errorNumber));
    }

    [Fact]
    public void IsSqlServerUniqueConstraintViolation_WhenOtherSqlServerError_ReturnsFalse()
    {
        Assert.False(ExternalIdentityRaceRecovery.IsSqlServerUniqueConstraintViolation(50000));
    }

    [Fact]
    public async Task RecoverOrRethrowAsync_WhenDuplicateIdentityExists_CompletesRecovery()
    {
        var recovery = new RecoveryProbe(identityExists: true);

        await ExternalIdentityRaceRecovery.RecoverOrRethrowAsync(
            new DbUpdateException("Unique external identity conflict."),
            isUniqueConstraintViolation: true,
            recovery.RollbackAsync,
            recovery.ClearChangeTracker,
            recovery.ExternalIdentityExistsAsync,
            CancellationToken.None);

        Assert.True(recovery.RollbackCalled);
        Assert.True(recovery.ChangeTrackerCleared);
        Assert.Equal(1, recovery.IdentityLookupCount);
    }

    [Fact]
    public async Task RecoverOrRethrowAsync_WhenDuplicateIdentityDoesNotExist_RethrowsOriginalException()
    {
        var recovery = new RecoveryProbe(identityExists: false);
        var expected = new DbUpdateException("Unique external identity conflict.");

        var actual = await Assert.ThrowsAsync<DbUpdateException>(() =>
            ExternalIdentityRaceRecovery.RecoverOrRethrowAsync(
                expected,
                isUniqueConstraintViolation: true,
                recovery.RollbackAsync,
                recovery.ClearChangeTracker,
                recovery.ExternalIdentityExistsAsync,
                CancellationToken.None));

        Assert.Same(expected, actual);
        Assert.True(recovery.RollbackCalled);
        Assert.True(recovery.ChangeTrackerCleared);
        Assert.Equal(1, recovery.IdentityLookupCount);
    }

    [Fact]
    public async Task RecoverOrRethrowAsync_WhenErrorIsNotDuplicate_RethrowsWithoutRecovery()
    {
        var recovery = new RecoveryProbe(identityExists: true);
        var expected = new DbUpdateException("Unexpected SQL Server error.");

        var actual = await Assert.ThrowsAsync<DbUpdateException>(() =>
            ExternalIdentityRaceRecovery.RecoverOrRethrowAsync(
                expected,
                isUniqueConstraintViolation: false,
                recovery.RollbackAsync,
                recovery.ClearChangeTracker,
                recovery.ExternalIdentityExistsAsync,
                CancellationToken.None));

        Assert.Same(expected, actual);
        Assert.False(recovery.RollbackCalled);
        Assert.False(recovery.ChangeTrackerCleared);
        Assert.Equal(0, recovery.IdentityLookupCount);
    }

    private sealed class RecoveryProbe(bool identityExists)
    {
        public bool RollbackCalled { get; private set; }

        public bool ChangeTrackerCleared { get; private set; }

        public int IdentityLookupCount { get; private set; }

        public Task RollbackAsync(CancellationToken cancellationToken)
        {
            RollbackCalled = true;
            return Task.CompletedTask;
        }

        public void ClearChangeTracker() => ChangeTrackerCleared = true;

        public Task<bool> ExternalIdentityExistsAsync(CancellationToken cancellationToken)
        {
            IdentityLookupCount++;
            return Task.FromResult(identityExists);
        }
    }
}