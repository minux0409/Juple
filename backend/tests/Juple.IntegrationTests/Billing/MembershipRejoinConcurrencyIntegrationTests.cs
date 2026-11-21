using System.Data.Common;
using System.Security.Cryptography;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Application.Users.DeleteAccount;
using Juple.Domain.Billing;
using Juple.Infrastructure.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.IntegrationTests.TestSupport;
using Juple.IntegrationTests.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Juple.IntegrationTests.Billing;

/// <summary>Real SQL transactions; gates control ordering, never delays or production services.</summary>
public sealed class MembershipRejoinConcurrencyIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Start = new(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Now = Start.AddDays(60);
    private readonly BillingOptions _options = new() { ProgramEnabled = true, ProgramStartAtUtc = Start,
        TrialIdentityHashKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) };
    private readonly List<ExternalIdentityPrincipal> _identities = [];
    private readonly List<byte[]> _hashes = [];
    private string _connection = null!;
    private ITrialIdentityHasher Hasher => new TrialIdentityHasher(_options);
    private string Email { get; } = $"synthetic-{Guid.NewGuid():N}@example.test";
    private JupleDbContext Context(params IInterceptor[] interceptors) => new(new DbContextOptionsBuilder<JupleDbContext>()
        .UseSqlServer(_connection).AddInterceptors(interceptors).Options);
    private sealed class Clock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private ExternalIdentityPrincipal Identity()
    {
        var value = new ExternalIdentityPrincipal(Guid.NewGuid(), Guid.NewGuid());
        _identities.Add(value); _hashes.Add(Hasher.Hash(value)); return value;
    }
    public Task InitializeAsync()
    {
        _connection = LocalRetentionEnvironment.RequireConnectionString();
        return Task.CompletedTask;
    }
    private CurrentUserBootstrapService Service(JupleDbContext db, IEntraIdentityDirectory? directory = null, DateTimeOffset? now = null)
    {
        var clock = new Clock(now ?? Now);
        return new(new CurrentUserProvisioningStore(db), new EntitlementService(_options, new EntitlementStore(db), Hasher,
            clock, new MembershipGrantStore(db)), clock, new EntraAccountDeletionOptions { Enabled = true },
            new NeverPending(), directory ?? new SilentEntraDirectory { Email = Email }, Hasher, _options);
    }
    private Task<CurrentUserBootstrapResult> Bootstrap(JupleDbContext db, ExternalIdentityPrincipal identity,
        IEntraIdentityDirectory? directory = null, DateTimeOffset? now = null) => Service(db, directory, now)
        .BootstrapAsync(identity, new("en-US", "UTC", (now ?? Now).AddMinutes(-1)));
    private async Task SeedExpiredAsync(string? email = null)
    {
        var hash = Hasher.HashEmail(email ?? Email)!; _hashes.Add(hash);
        await using var db = Context();
        db.Set<MembershipTrialLedgerEntry>().Add(new(hash, Start, Start.AddHours(720), Start));
        await db.SaveChangesAsync();
    }
    private static void OriginalExpired(CurrentUserBootstrapResult result)
    {
        Assert.Equal(Start, result.Entitlement.TrialStartedAtUtc);
        Assert.Equal(Start.AddHours(720), result.Entitlement.TrialEndsAtUtc);
        Assert.False(result.Entitlement.CanWrite);
        Assert.False(result.NewAccountTrialGranted);
    }
    public async Task DisposeAsync()
    {
        foreach (var identity in _identities)
        {
            await using var db = Context();
            var state = await new EntitlementStore(db).GetUserStateAsync(identity);
            if (state is not null)
            {
                var prefix = $"rejoin-concurrency/{state.UserId}/";
                await new AccountDeletionStore(db).DeleteAllDataAsync(state.UserId, prefix, Now);
                await db.AccountDeletionBlobCleanups.Where(row => row.BlobPrefix == prefix).ExecuteDeleteAsync();
            }
        }
        await using var cleanup = Context();
        _hashes.Add(Hasher.HashEmail(Email)!);
        foreach (var hash in _hashes)
            await cleanup.Set<MembershipTrialLedgerEntry>().Where(row => row.IdentityHash == hash).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task DelayedSuccessfulDirectoryLookup_CannotExposeAnUninheritedAccount()
    {
        await SeedExpiredAsync(); var identity = Identity(); var gate = new DirectoryGate(Email);
        await using var firstDb = Context(); await using var secondDb = Context();
        var first = Bootstrap(firstDb, identity, gate);
        try
        {
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(20));
            await using var observer = Context();
            Assert.Null(await new EntitlementStore(observer).GetUserStateAsync(identity));
            // The second request overtakes the delayed first one. Both must get the old window.
            OriginalExpired(await Bootstrap(secondDb, identity).WaitAsync(TimeSpan.FromSeconds(20)));
        }
        finally { gate.Release.TrySetResult(); }
        OriginalExpired(await first.WaitAsync(TimeSpan.FromSeconds(20)));
    }

    [Fact]
    public async Task AccountCommit_IsAfterInheritance_AndConcurrentEntitlementCannotGrantFreshTrial()
    {
        await SeedExpiredAsync(); var identity = Identity(); var gate = new InheritanceGate();
        var observer = new AccountReadObserver();
        await using var firstDb = Context(gate); await using var secondDb = Context(observer);
        var first = Bootstrap(firstDb, identity);
        Task<CurrentUserBootstrapResult>? second = null;
        try
        {
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(20));
            // Stop AFTER User/ExternalIdentity INSERTs, BEFORE the email ledger lookup. This
            // forces the formerly broken order, rather than relying on scheduler timing.
            second = Bootstrap(secondDb, identity);
            await observer.Entered.Task.WaitAsync(TimeSpan.FromSeconds(20));
            Assert.False(second.IsCompleted);
        }
        finally { gate.Release.TrySetResult(); }
        OriginalExpired(await first.WaitAsync(TimeSpan.FromSeconds(30)));
        OriginalExpired(await second!.WaitAsync(TimeSpan.FromSeconds(30)));
    }

    [Fact]
    public async Task StaleEntitlementCandidate_WaitsForCreationCommit_AndReusesInheritedWindow()
    {
        await SeedExpiredAsync(); var identity = Identity(); var gate = new CommitGate();
        await using var firstDb = Context(gate); await using var secondDb = Context();
        var first = Bootstrap(firstDb, identity); Task<TrialWindow>? settlement = null;
        try
        {
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(20));
            var id = Assert.Single(firstDb.Users.Local).Id;
            settlement = new EntitlementStore(secondDb).EnsureTrialAsync(id, Hasher.Hash(identity),
                new TrialWindow(Now, Now.AddHours(720)), Now);
        }
        finally { gate.Release.TrySetResult(); }
        OriginalExpired(await first.WaitAsync(TimeSpan.FromSeconds(30)));
        var window = await settlement!.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.Equal(Start, window.StartedAtUtc); Assert.Equal(Start.AddHours(720), window.EndsAtUtc);
    }

    [Fact]
    public async Task CoordinationTimeout_RollsBackAndExplicitlyFails_ThenRetryPreservesExpiredWindow()
    {
        await SeedExpiredAsync(); var identity = Identity();
        await using var blocker = Context();
        await using (var transaction = await blocker.Database.BeginTransactionAsync())
        {
            var resource = "membership-trial-email:" + Convert.ToHexString(Hasher.HashEmail(Email)!);
            await blocker.Database.ExecuteSqlInterpolatedAsync($"EXEC sp_getapplock @Resource={resource}, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=1000;");
            await using var waiting = Context();
            var failure = await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(() => Bootstrap(waiting, identity));
            Assert.Equal(51001, failure.Number);
            await transaction.RollbackAsync();
        }
        await using var retry = Context();
        Assert.Null(await new EntitlementStore(retry).GetUserStateAsync(identity));
        OriginalExpired(await Bootstrap(retry, identity));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UnresolvedDirectoryEmail_NeverPublishesAnAccountOrGrantsTrial(bool outage)
    {
        await SeedExpiredAsync(); var identity = Identity(); await using var db = Context();
        IEntraIdentityDirectory directory = outage ? new FailingDirectory() : new SilentEntraDirectory();
        await Assert.ThrowsAnyAsync<InvalidOperationException>(() => Bootstrap(db, identity, directory));
        Assert.Null(await new EntitlementStore(db).GetUserStateAsync(identity));
        var hash = Hasher.Hash(identity);
        Assert.False(await db.Set<MembershipTrialLedgerEntry>().AnyAsync(row => row.IdentityHash == hash));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task EightConcurrentRejoins_ConvergeOnExpiredWindow(bool distinctObjectIds)
    {
        await SeedExpiredAsync(); var first = Identity();
        var identities = Enumerable.Range(0, 8).Select(_ => distinctObjectIds ? Identity() : first).ToArray();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var tasks = identities.Select(async identity =>
        {
            await using var db = Context(); await release.Task; return await Bootstrap(db, identity);
        }).ToArray();
        release.SetResult();
        Assert.All(await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(60)), OriginalExpired);
        await using var check = Context();
        var hash = Hasher.HashEmail(Email)!;
        Assert.Single(await check.Set<MembershipTrialLedgerEntry>().Where(row => row.IdentityHash == hash).ToListAsync());
    }

    [Fact]
    public async Task NewEmail_ConcurrentDistinctIdentities_ReceivesOneCanonicalWindow()
    {
        var identities = Enumerable.Range(0, 8).Select(_ => Identity()).ToArray();
        var tasks = identities.Select(async (identity, index) =>
        {
            await using var db = Context(); return await Bootstrap(db, identity, now: Now.AddSeconds(index));
        });
        var results = await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(60));
        var window = results[0].Entitlement;
        Assert.All(results, result =>
        {
            Assert.Equal(window.TrialStartedAtUtc, result.Entitlement.TrialStartedAtUtc);
            Assert.Equal(window.TrialEndsAtUtc, result.Entitlement.TrialEndsAtUtc);
            Assert.Equal(TimeSpan.FromHours(720), result.Entitlement.TrialEndsAtUtc - result.Entitlement.TrialStartedAtUtc);
        });
    }

    [Fact]
    public async Task FailureBeforeCommit_RollsBackAccountAndAliases_AndRetryReusesExpiredWindow()
    {
        await SeedExpiredAsync(); var identity = Identity();
        await using (var failed = Context(new FailCommit()))
            await Assert.ThrowsAsync<InjectedFailure>(() => Bootstrap(failed, identity));
        await using var retry = Context();
        Assert.Null(await new EntitlementStore(retry).GetUserStateAsync(identity));
        var hash = Hasher.Hash(identity);
        Assert.False(await retry.Set<MembershipTrialLedgerEntry>().AnyAsync(row => row.IdentityHash == hash));
        OriginalExpired(await Bootstrap(retry, identity));
    }

    [Fact]
    public async Task DeletionRacingSettlement_RemembersTheCommittedOriginalPeriodBeforeRejoin()
    {
        var identity = Identity(); var hash = Hasher.Hash(identity);
        long userId;
        await using (var seed = Context())
        {
            await new CurrentUserProvisioningStore(seed).CreateAsync(new(identity, "en-US", "UTC", null, Now));
            userId = (await new EntitlementStore(seed).GetUserStateAsync(identity))!.UserId;
            seed.Set<MembershipTrialLedgerEntry>().Add(new(hash, Start, Start.AddHours(720), Start));
            await seed.SaveChangesAsync();
        }
        var gate = new CommitGate(); var observer = new AccountReadObserver();
        await using var settleDb = Context(gate); await using var deletionDb = Context(observer);
        var settlement = new EntitlementStore(settleDb).EnsureTrialAsync(userId, hash, new(Now, Now.AddHours(720)), Now);
        Task<AccountDeletionResult>? deletion = null; var prefix = $"rejoin-delete-race/{userId}/";
        try
        {
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(20));
            deletion = new AccountDeletionStore(deletionDb).DeleteAllDataAsync(userId,
                new AccountDeletionPlan(prefix, Now, false, Hasher.HashEmail(Email)));
            await observer.Entered.Task.WaitAsync(TimeSpan.FromSeconds(20));
            Assert.False(deletion.IsCompleted);
        }
        finally { gate.Release.TrySetResult(); }
        var window = await settlement.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.Equal(Start, window.StartedAtUtc);
        await deletion!.WaitAsync(TimeSpan.FromSeconds(30));
        await deletionDb.AccountDeletionBlobCleanups.Where(row => row.BlobPrefix == prefix).ExecuteDeleteAsync();
        await using var rejoin = Context();
        OriginalExpired(await Bootstrap(rejoin, Identity()));
    }

    [Fact]
    public async Task ConflictingRememberedWindows_FailExplicitlyWithoutPublishingAccountOrChangingHistory()
    {
        await SeedExpiredAsync(); var identity = Identity(); var hash = Hasher.Hash(identity);
        await using var db = Context();
        db.Set<MembershipTrialLedgerEntry>().Add(new(hash, Now, Now.AddHours(720), Now));
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Bootstrap(db, identity));
        Assert.Null(await new EntitlementStore(db).GetUserStateAsync(identity));
        Assert.Equal(Now, (await db.Set<MembershipTrialLedgerEntry>().AsNoTracking().SingleAsync(row => row.IdentityHash == hash)).TrialStartedAtUtc);
        var emailHash = Hasher.HashEmail(Email)!;
        Assert.Equal(Start, (await db.Set<MembershipTrialLedgerEntry>().AsNoTracking().SingleAsync(row => row.IdentityHash == emailHash)).TrialStartedAtUtc);
    }

    [Fact]
    public async Task RepeatedDeletionAndRejoin_AndDuplicateRequest_NeverRestartTheTrial()
    {
        await SeedExpiredAsync();
        for (var i = 0; i < 3; i++)
        {
            var identity = Identity(); await using var db = Context();
            OriginalExpired(await Bootstrap(db, identity));
            OriginalExpired(await Bootstrap(db, identity));
            var state = (await new EntitlementStore(db).GetUserStateAsync(identity))!;
            var prefix = $"rejoin-repeat/{state.UserId}/";
            await new AccountDeletionStore(db).DeleteAllDataAsync(state.UserId,
                new AccountDeletionPlan(prefix, Now, false, Hasher.HashEmail(Email)));
            await db.AccountDeletionBlobCleanups.Where(row => row.BlobPrefix == prefix).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task DifferentVerifiedEmail_DoesNotInheritAnotherUsersExpiredWindow()
    {
        await SeedExpiredAsync("different-" + Email);
        await using var db = Context(); var result = await Bootstrap(db, Identity());
        Assert.Equal(Now, result.Entitlement.TrialStartedAtUtc);
        Assert.True(result.Entitlement.CanWrite);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ExpiredInheritedTrial_DoesNotOverridePaidOrAdministratorAccess(bool administrator)
    {
        await SeedExpiredAsync(); var identity = Identity(); await using var db = Context();
        OriginalExpired(await Bootstrap(db, identity));
        var state = (await new EntitlementStore(db).GetUserStateAsync(identity))!;
        StorePurchase? purchase = null;
        if (administrator)
            db.Set<MembershipGrant>().Add(new(Guid.NewGuid(), state.UserId, MembershipGrantKind.Complimentary,
                999, Now, Now, Now.AddDays(45), "Synthetic rejoin concurrency test"));
        else
        {
            purchase = new(state.UserId, StoreSource.GooglePlay, "juple_monthly", RandomNumberGenerator.GetBytes(32), RandomNumberGenerator.GetBytes(32), Now);
            purchase.ApplyVerified(new(StorePurchaseState.Active, EntitlementReason.None, Now.AddDays(45), false, false, Now), "monthly", Now, Now);
            db.StorePurchases.Add(purchase);
        }
        await db.SaveChangesAsync();
        try
        {
            var result = await Bootstrap(db, identity);
            Assert.True(result.Entitlement.CanWrite);
            Assert.Equal(Start, result.Entitlement.TrialStartedAtUtc);
            Assert.Equal(Start.AddHours(720), result.Entitlement.TrialEndsAtUtc);
        }
        finally
        {
            if (purchase is not null) await db.StorePurchases.Where(row => row.Id == purchase.Id).ExecuteDeleteAsync();
        }
    }

    private sealed class DirectoryGate(string email) : IEntraIdentityDirectory
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<string?> GetSignInEmailAsync(ExternalIdentityPrincipal identity, CancellationToken ct = default)
        { Entered.TrySetResult(); await Release.Task.WaitAsync(ct); return email; }
        public Task<EntraIdentityDeletionOutcome> DeleteUserAsync(ExternalIdentityPrincipal identity, CancellationToken ct = default) => throw new NotSupportedException();
    }
    private sealed class CommitGate : DbTransactionInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction, TransactionEventData eventData,
            InterceptionResult result, CancellationToken cancellationToken = default)
        { Entered.TrySetResult(); await Release.Task.WaitAsync(cancellationToken); return result; }
    }
    private sealed class InheritanceGate : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken ct = default)
        {
            if (command.CommandText.Contains("FROM [billing].[MembershipTrialLedger]", StringComparison.Ordinal))
            { Entered.TrySetResult(); await Release.Task.WaitAsync(ct); }
            return result;
        }
    }
    private sealed class AccountReadObserver : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken ct = default)
        { Entered.TrySetResult(); return ValueTask.FromResult(result); }
    }
    private sealed class FailingDirectory : IEntraIdentityDirectory
    {
        public Task<string?> GetSignInEmailAsync(ExternalIdentityPrincipal identity, CancellationToken ct = default) =>
            throw new InvalidOperationException("Synthetic directory outage.");
        public Task<EntraIdentityDeletionOutcome> DeleteUserAsync(ExternalIdentityPrincipal identity, CancellationToken ct = default) => throw new NotSupportedException();
    }
    private sealed class InjectedFailure : Exception;
    private sealed class FailCommit : DbTransactionInterceptor
    {
        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction, TransactionEventData eventData,
            InterceptionResult result, CancellationToken cancellationToken = default) => throw new InjectedFailure();
    }
}
