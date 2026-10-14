using System.Security.Cryptography;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Application.Users.DeleteAccount;
using Juple.Domain.Users;
using Juple.Infrastructure.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.IntegrationTests.Users;

/// <summary>A directory that never answers - the stand-in wherever Entra is not part of what a test exercises.</summary>
internal sealed class SilentEntraDirectory : IEntraIdentityDirectory
{
    public string? Email { get; set; }

    public Exception? DeleteFailure { get; set; }

    public List<ExternalIdentityPrincipal> Deleted { get; } = [];

    public Task<string?> GetSignInEmailAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) => Task.FromResult(Email);

    public Task<EntraIdentityDeletionOutcome> DeleteUserAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default)
    {
        if (DeleteFailure is not null)
        {
            throw DeleteFailure;
        }

        Deleted.Add(identity);
        return Task.FromResult(EntraIdentityDeletionOutcome.Deleted);
    }
}

internal sealed class NeverPending : IEntraIdentityDeletionService
{
    public Task<bool> TryCompleteAsync(long taskId, CancellationToken cancellationToken = default) => Task.FromResult(true);

    public Task<EntraDeletionRunResult> RunPendingAsync(CancellationToken cancellationToken = default) => Task.FromResult(new EntraDeletionRunResult(0, 0, 0));

    public Task<bool> IsStillPendingAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) => Task.FromResult(false);
}

internal sealed class NoInheritance : ITrialEmailLedger
{
    public Task InheritAsync(ExternalIdentityPrincipal identity, byte[] emailHash, CancellationToken cancellationToken = default) => Task.CompletedTask;
}

/// <summary>
/// The Entra sign-in account deletion against the real schema: the deletion task and the trial memory are written in the SAME
/// transaction as the account's data deletion, the retry bookkeeping works on real rows, and a returning email gets its
/// original trial window back through the keyed email hash.
/// </summary>
public sealed class EntraAccountDeletionIntegrationTests : IAsyncLifetime
{
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);
    private static readonly DateTimeOffset Now = new(2026, 12, 20, 0, 0, 0, TimeSpan.Zero);
    private static readonly Guid CustomerTenant = Guid.NewGuid();

    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<ExternalIdentityPrincipal> _identities = [];
    private readonly List<byte[]> _emailHashes = [];

    private sealed class StubTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    public Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = NewContext();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        var hasher = Hasher();
        foreach (var identity in _identities)
        {
            var state = await new EntitlementStore(_db).GetUserStateAsync(identity);
            if (state is not null)
            {
                await new AccountDeletionStore(_db).DeleteAllDataAsync(state.UserId, $"test/{state.UserId}/", DateTimeOffset.UtcNow);
            }

            var hash = hasher.Hash(identity);
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.TrialLedger WHERE IdentityHash = {hash}");
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM users.PendingEntraIdentityDeletions WHERE TenantId = {identity.TenantId} AND ObjectId = {identity.ObjectId}");
        }

        foreach (var hash in _emailHashes)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.TrialLedger WHERE IdentityHash = {hash}");
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private static BillingOptions Billing() => new() { TrialIdentityHashKey = Convert.ToBase64String(Key) };

    private static TrialIdentityHasher Hasher() => new(Billing());

    private ExternalIdentityPrincipal NewIdentity()
    {
        var identity = new ExternalIdentityPrincipal(CustomerTenant, Guid.NewGuid());
        _identities.Add(identity);
        return identity;
    }

    private byte[] EmailHash(string email)
    {
        var hash = Hasher().HashEmail(email)!;
        _emailHashes.Add(hash);
        return hash;
    }

    private async Task<long> SeedUserAsync(ExternalIdentityPrincipal identity, DateTimeOffset? trialStart = null, DateTimeOffset? trialEnd = null)
    {
        await new CurrentUserProvisioningStore(_db).CreateAsync(new CurrentUserBootstrapData(identity, "ko-KR", "Asia/Seoul", null, Now.AddDays(-100)));
        var userId = (await new EntitlementStore(NewContext()).GetUserStateAsync(identity))!.UserId;
        if (trialStart is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users.Users SET TrialStartedAtUtc = {trialStart}, TrialEndsAtUtc = {trialEnd} WHERE Id = {userId}");
        }

        return userId;
    }

    private Task<int> PendingCountAsync(ExternalIdentityPrincipal identity) =>
        NewContext().Set<PendingEntraIdentityDeletion>().AsNoTracking().CountAsync(task => task.TenantId == identity.TenantId && task.ObjectId == identity.ObjectId);

    private async Task<(DateTimeOffset Start, DateTimeOffset End)?> LedgerAsync(byte[] hash)
    {
        var row = await NewContext().TrialLedger.AsNoTracking().Where(entry => entry.IdentityHash == hash).FirstOrDefaultAsync();
        return row is null ? null : (row.TrialStartedAtUtc, row.TrialEndsAtUtc);
    }

    [Fact]
    public async Task Delete_WithTheEntraPlan_WritesTheTaskAndTheTrialMemory_InTheSameCommit()
    {
        var identity = NewIdentity();
        var start = Now.AddDays(-40);
        var end = start.AddDays(30);
        var userId = await SeedUserAsync(identity, start, end);
        var emailHash = EmailHash("returning-" + Guid.NewGuid().ToString("N") + "@example.com");

        var result = await new AccountDeletionStore(_db).DeleteAllDataAsync(
            userId, new AccountDeletionPlan($"test/{userId}/", Now, RegisterEntraIdentityDeletion: true, emailHash));

        Assert.NotNull(result.EntraDeletionTaskId);
        Assert.Null(await new EntitlementStore(NewContext()).GetUserStateAsync(identity));
        var task = await new EntraIdentityDeletionStore(NewContext()).FindAsync(result.EntraDeletionTaskId!.Value);
        Assert.Equal(identity.TenantId, task!.TenantId);
        Assert.Equal(identity.ObjectId, task.ObjectId);
        Assert.Equal((start, end), await LedgerAsync(emailHash));
    }

    [Fact]
    public async Task Delete_WithoutTheEntraPlan_LeavesNoTask_AsBefore()
    {
        var identity = NewIdentity();
        var userId = await SeedUserAsync(identity);

        var result = await new AccountDeletionStore(_db).DeleteAllDataAsync(
            userId, new AccountDeletionPlan($"test/{userId}/", Now, RegisterEntraIdentityDeletion: false, null));

        Assert.Null(result.EntraDeletionTaskId);
        Assert.Equal(0, await PendingCountAsync(identity));
    }

    [Fact]
    public async Task Delete_NeverOverwritesAnExistingLedgerEntryForTheEmail_AndSkipsAnAccountWithoutAWindow()
    {
        var emailHash = EmailHash("kept-" + Guid.NewGuid().ToString("N") + "@example.com");
        var original = Now.AddDays(-300);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO billing.TrialLedger (IdentityHash, TrialStartedAtUtc, TrialEndsAtUtc, CreatedAtUtc) VALUES ({emailHash}, {original}, {original.AddDays(30)}, {original})");

        var withWindow = NewIdentity();
        var userId = await SeedUserAsync(withWindow, Now.AddDays(-10), Now.AddDays(20));
        await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, new AccountDeletionPlan($"test/{userId}/", Now, true, emailHash));
        Assert.Equal((original, original.AddDays(30)), await LedgerAsync(emailHash));

        var withoutWindow = NewIdentity();
        var otherHash = EmailHash("nowindow-" + Guid.NewGuid().ToString("N") + "@example.com");
        var otherUserId = await SeedUserAsync(withoutWindow);
        await new AccountDeletionStore(_db).DeleteAllDataAsync(otherUserId, new AccountDeletionPlan($"test/{otherUserId}/", Now, true, otherHash));
        Assert.Null(await LedgerAsync(otherHash));
    }

    [Fact]
    public async Task TaskBookkeeping_RecordsOnlyACode_ThenCompletesAndRemovesTheRow()
    {
        var identity = NewIdentity();
        var userId = await SeedUserAsync(identity);
        var result = await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, new AccountDeletionPlan($"test/{userId}/", Now, true, null));
        var taskId = result.EntraDeletionTaskId!.Value;
        var directory = new SilentEntraDirectory { DeleteFailure = new EntraDirectoryException("http_503") };
        var service = new EntraIdentityDeletionService(new EntraIdentityDeletionStore(NewContext()), directory, new StubTime(Now), NullLogger<EntraIdentityDeletionService>.Instance);

        Assert.False(await service.TryCompleteAsync(taskId));
        var failed = await new EntraIdentityDeletionStore(NewContext()).FindAsync(taskId);
        Assert.Equal(1, failed!.AttemptCount);
        Assert.Equal("http_503", failed.LastErrorCode);

        directory.DeleteFailure = null;
        Assert.True(await service.TryCompleteAsync(taskId));
        Assert.Null(await new EntraIdentityDeletionStore(NewContext()).FindAsync(taskId));
        Assert.Equal(new ExternalIdentityPrincipal(identity.TenantId, identity.ObjectId), Assert.Single(directory.Deleted));
    }

    [Fact]
    public async Task ReturningEmail_GetsItsOriginalTrialWindow_OnANewIdentity_AndNeverAFreshOne()
    {
        var email = "again-" + Guid.NewGuid().ToString("N") + "@example.com";
        var emailHash = EmailHash(email);
        var start = Now.AddDays(-60);
        var end = start.AddDays(30);
        var first = NewIdentity();
        var userId = await SeedUserAsync(first, start, end);
        await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, new AccountDeletionPlan($"test/{userId}/", Now, true, emailHash));

        // The same person signs up anew: a brand-new Entra object id, the same email.
        var second = NewIdentity();
        var directory = new SilentEntraDirectory { Email = email };
        var service = Bootstrap(NewContext(), directory, new NeverPending(), Now);
        await service.BootstrapAsync(second, new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul", Now.AddMinutes(-1)));

        var state = await new EntitlementStore(NewContext()).GetUserStateAsync(second);
        Assert.Equal(start, state!.TrialStartedAtUtc);
        Assert.Equal(end, state.TrialEndsAtUtc);
    }

    [Fact]
    public async Task NewEmail_GetsNoInheritedWindow()
    {
        var identity = NewIdentity();
        var directory = new SilentEntraDirectory { Email = "brand-new-" + Guid.NewGuid().ToString("N") + "@example.com" };
        EmailHash(directory.Email);

        await Bootstrap(NewContext(), directory, new NeverPending(), Now).BootstrapAsync(identity, new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul", Now.AddMinutes(-1)));

        var state = await new EntitlementStore(NewContext()).GetUserStateAsync(identity);
        Assert.Null(state!.TrialStartedAtUtc);
    }

    [Fact]
    public async Task SigningUpAgain_IsRefusedWhileTheOldEntraAccountSurvives_AndAllowedOnceItIsGone()
    {
        var identity = NewIdentity();
        var userId = await SeedUserAsync(identity);
        await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, new AccountDeletionPlan($"test/{userId}/", Now, true, null));
        Assert.Equal(1, await PendingCountAsync(identity));

        var directory = new SilentEntraDirectory { DeleteFailure = new EntraDirectoryException("http_500") };
        var deletion = new EntraIdentityDeletionService(new EntraIdentityDeletionStore(NewContext()), directory, new StubTime(Now), NullLogger<EntraIdentityDeletionService>.Instance);
        var command = new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul", Now.AddMinutes(-1));

        // The very same identity (the deleted person with the old password) cannot get a new Juple account.
        await Assert.ThrowsAsync<AccountDeletionPendingException>(() => Bootstrap(NewContext(), directory, deletion, Now).BootstrapAsync(identity, command));
        Assert.Null(await new EntitlementStore(NewContext()).GetUserStateAsync(identity));

        // Once Entra confirms the deletion the pending task is finished first and nothing blocks a real new sign-up.
        directory.DeleteFailure = null;
        await Bootstrap(NewContext(), directory, deletion, Now).BootstrapAsync(identity, command);
        Assert.Equal(0, await PendingCountAsync(identity));
        Assert.NotNull(await new EntitlementStore(NewContext()).GetUserStateAsync(identity));
    }

    private static CurrentUserBootstrapService Bootstrap(JupleDbContext db, SilentEntraDirectory directory, IEntraIdentityDeletionService deletion, DateTimeOffset now)
    {
        var time = new StubTime(now);
        var entitlements = new EntitlementService(Billing(), new EntitlementStore(db), Hasher(), time);
        return new CurrentUserBootstrapService(
            new CurrentUserProvisioningStore(db),
            entitlements,
            time,
            new EntraAccountDeletionOptions { Enabled = true, TenantId = CustomerTenant, ClientId = "c", ManagedIdentityClientId = "m" },
            deletion,
            directory,
            Hasher(),
            new TrialEmailLedger(db));
    }
}
