using System.Security.Cryptography;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Domain.Billing;
using Juple.Domain.Support;
using Juple.Domain.Users;
using Juple.Infrastructure.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Billing;

/// <summary>
/// R39-A against the real schema: the subscription program is OFF by default (nobody's trial is consumed), and once ON the
/// 30-day trial is settled atomically through billing.TrialLedger - one ledger row and one window per external identity,
/// converging under concurrency, and surviving account deletion so a re-created account cannot restart it.
/// </summary>
public sealed class TrialFoundationIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset ProgramStart = new(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);

    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<ExternalIdentityPrincipal> _identities = [];

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
        var hasher = new TrialIdentityHasher(Options(enabled: true));
        foreach (var identity in _identities)
        {
            var state = await new EntitlementStore(_db).GetUserStateAsync(identity);
            if (state is not null)
            {
                await new AccountDeletionStore(_db).DeleteAllDataAsync(state.UserId, $"test/{state.UserId}/", DateTimeOffset.UtcNow);
            }

            var hash = hasher.Hash(identity);
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.TrialLedger WHERE IdentityHash = {hash}");
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private static BillingOptions Options(bool enabled) => new()
    {
        ProgramEnabled = enabled,
        ProgramStartAtUtc = enabled ? ProgramStart : null,
        TrialIdentityHashKey = Convert.ToBase64String(Key),
    };

    private ExternalIdentityPrincipal NewIdentity()
    {
        var identity = new ExternalIdentityPrincipal(Guid.NewGuid(), Guid.NewGuid());
        _identities.Add(identity);
        return identity;
    }

    private CurrentUserBootstrapService BootstrapService(JupleDbContext db, bool enabled, DateTimeOffset now)
    {
        var time = new StubTime(now);
        var entitlements = new EntitlementService(Options(enabled), new EntitlementStore(db), new TrialIdentityHasher(Options(enabled)), time);
        return new CurrentUserBootstrapService(new CurrentUserProvisioningStore(db), entitlements, time);
    }

    /// <summary>An already-provisioned account, as existing users are: created at <paramref name="createdAt"/>, no trial yet.</summary>
    private async Task SeedExistingAsync(ExternalIdentityPrincipal identity, DateTimeOffset createdAt) =>
        await new CurrentUserProvisioningStore(_db).CreateAsync(
            new CurrentUserBootstrapData(identity, "ko-KR", "Asia/Seoul", null, createdAt));

    private Task<int> LedgerCountAsync(ExternalIdentityPrincipal identity)
    {
        var hash = new TrialIdentityHasher(Options(enabled: true)).Hash(identity);
        return _db.TrialLedger.AsNoTracking().CountAsync(entry => entry.IdentityHash == hash);
    }

    private async Task<(DateTimeOffset? Start, DateTimeOffset? End)> StoredTrialAsync(ExternalIdentityPrincipal identity)
    {
        var state = await new EntitlementStore(NewContext()).GetUserStateAsync(identity);
        return (state!.TrialStartedAtUtc, state.TrialEndsAtUtc);
    }

    [Fact]
    public async Task ProgramDisabled_BootstrapConsumesNoTrial_AndNothingIsRestricted()
    {
        var identity = NewIdentity();
        var command = new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul");
        var service = BootstrapService(_db, enabled: false, new DateTimeOffset(2026, 12, 5, 0, 0, 0, TimeSpan.Zero));

        var first = await service.BootstrapAsync(identity, command);
        var again = await service.BootstrapAsync(identity, command);

        foreach (var result in new[] { first, again })
        {
            Assert.Equal(UserPlan.Free, result.Plan);
            Assert.False(result.Entitlement.ProgramEnabled);
            Assert.True(result.Entitlement.CanWrite);
            Assert.Null(result.Entitlement.Status);
        }

        Assert.Equal(0, await LedgerCountAsync(identity));
        Assert.Equal((null, null), await StoredTrialAsync(identity));
    }

    [Fact]
    public async Task ProgramEnabled_AnExistingUser_GetsTheFreshWindowFromTheProgramStart_AndItIsPersisted()
    {
        var identity = NewIdentity();
        await SeedExistingAsync(identity, new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero));

        var result = await BootstrapService(NewContext(), enabled: true, new DateTimeOffset(2026, 12, 5, 0, 0, 0, TimeSpan.Zero))
            .BootstrapAsync(identity, new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul"));

        Assert.Equal(UserPlan.Free, result.Plan);
        Assert.Equal(EntitlementStatus.Trial, result.Entitlement.Status);
        Assert.True(result.Entitlement.CanWrite);
        Assert.Equal(ProgramStart, result.Entitlement.TrialStartedAtUtc);
        Assert.Equal(new DateTimeOffset(2026, 12, 31, 0, 0, 0, TimeSpan.Zero), result.Entitlement.TrialEndsAtUtc);
        Assert.Equal((ProgramStart, ProgramStart.AddDays(30)), await StoredTrialAsync(identity));
        Assert.Equal(1, await LedgerCountAsync(identity));
    }

    [Fact]
    public async Task ProgramEnabled_ANewUser_StartsItsTrialAtItsCreation()
    {
        var identity = NewIdentity();
        var created = new DateTimeOffset(2026, 12, 10, 0, 0, 0, TimeSpan.Zero);

        var result = await BootstrapService(_db, enabled: true, created)
            .BootstrapAsync(identity, new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul"));

        Assert.Equal(EntitlementStatus.Trial, result.Entitlement.Status);
        Assert.Equal(created, result.Entitlement.TrialStartedAtUtc);
        Assert.Equal(new DateTimeOffset(2027, 1, 9, 0, 0, 0, TimeSpan.Zero), result.Entitlement.TrialEndsAtUtc);
    }

    [Fact]
    public async Task ProgramEnabled_AnExpiredTrial_CannotWrite_WithAStableFreezeInstant_AndRepeatedBootstrapsAgree()
    {
        var identity = NewIdentity();
        await SeedExistingAsync(identity, new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero));
        var command = new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul");

        var first = await BootstrapService(NewContext(), enabled: true, new DateTimeOffset(2027, 2, 1, 0, 0, 0, TimeSpan.Zero)).BootstrapAsync(identity, command);
        var later = await BootstrapService(NewContext(), enabled: true, new DateTimeOffset(2027, 9, 1, 0, 0, 0, TimeSpan.Zero)).BootstrapAsync(identity, command);

        foreach (var result in new[] { first, later })
        {
            Assert.Equal(EntitlementStatus.Expired, result.Entitlement.Status);
            Assert.False(result.Entitlement.CanWrite);
            Assert.Equal(ProgramStart.AddDays(30), result.Entitlement.AccessFrozenAtUtc);
        }

        Assert.Equal(1, await LedgerCountAsync(identity));
    }

    [Fact]
    public async Task ProgramEnabled_BootstrappingAgain_NeverCreatesASecondLedgerRowOrWindow()
    {
        var identity = NewIdentity();
        await SeedExistingAsync(identity, new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero));
        var command = new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul");

        var first = await BootstrapService(NewContext(), enabled: true, new DateTimeOffset(2026, 12, 2, 0, 0, 0, TimeSpan.Zero)).BootstrapAsync(identity, command);
        var second = await BootstrapService(NewContext(), enabled: true, new DateTimeOffset(2026, 12, 20, 0, 0, 0, TimeSpan.Zero)).BootstrapAsync(identity, command);

        Assert.Equal(first.Entitlement.TrialStartedAtUtc, second.Entitlement.TrialStartedAtUtc);
        Assert.Equal(first.Entitlement.TrialEndsAtUtc, second.Entitlement.TrialEndsAtUtc);
        Assert.Equal(1, await LedgerCountAsync(identity));
    }

    [Fact]
    public async Task ConcurrentFirstCalls_ConvergeOnOneLedgerRowAndOneWindow()
    {
        var identity = NewIdentity();
        await SeedExistingAsync(identity, new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero));
        var state = (await new EntitlementStore(_db).GetUserStateAsync(identity))!;
        var hash = new TrialIdentityHasher(Options(enabled: true)).Hash(identity);

        // Each racer proposes a DIFFERENT window; only one may ever win.
        var racers = Enumerable.Range(0, 8).Select(index => Task.Run(async () =>
        {
            await using var db = NewContext();
            var proposed = new TrialWindow(ProgramStart.AddDays(index), ProgramStart.AddDays(index).AddDays(30));
            return await new EntitlementStore(db).EnsureTrialAsync(state.UserId, hash, proposed, DateTimeOffset.UtcNow);
        })).ToArray();
        var windows = await Task.WhenAll(racers);

        Assert.Single(windows.Distinct());
        Assert.Equal(1, await LedgerCountAsync(identity));
        Assert.Equal((windows[0].StartedAtUtc, windows[0].EndsAtUtc), await StoredTrialAsync(identity));
    }

    [Fact]
    public async Task TheLedgerStoresOnlyAHash_NeverTheRawTenantOrObjectId()
    {
        var identity = NewIdentity();
        await SeedExistingAsync(identity, new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero));
        await BootstrapService(NewContext(), enabled: true, ProgramStart.AddDays(1))
            .BootstrapAsync(identity, new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul"));

        var stored = await _db.TrialLedger.AsNoTracking()
            .Where(entry => entry.IdentityHash == new TrialIdentityHasher(Options(enabled: true)).Hash(identity))
            .SingleAsync();

        Assert.Equal(32, stored.IdentityHash.Length);
        Assert.False(stored.IdentityHash.AsSpan().IndexOf(identity.TenantId.ToByteArray()) >= 0);
        Assert.False(stored.IdentityHash.AsSpan().IndexOf(identity.ObjectId.ToByteArray()) >= 0);
        var columns = await _db.Database
            .SqlQueryRaw<string>("SELECT c.name AS [Value] FROM sys.columns c WHERE c.object_id = OBJECT_ID('billing.TrialLedger') ORDER BY c.column_id")
            .ToListAsync();
        Assert.Equal(["Id", "IdentityHash", "TrialStartedAtUtc", "TrialEndsAtUtc", "CreatedAtUtc"], columns);
    }

    [Fact]
    public async Task DeleteAndRecreate_TheLedgerSurvives_AndTheNewUserGetsTheOriginalWindow_NotANewOne()
    {
        var identity = NewIdentity();
        await SeedExistingAsync(identity, new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero));
        var command = new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul");
        var original = await BootstrapService(NewContext(), enabled: true, ProgramStart.AddDays(3)).BootstrapAsync(identity, command);
        var oldUserId = (await new EntitlementStore(NewContext()).GetUserStateAsync(identity))!.UserId;

        // The account has some of its own content (a support inquiry) that the deletion must still clear.
        _db.SupportInquiries.Add(new SupportInquiry(
            oldUserId, Guid.NewGuid(), SupportInquiryType.Other, "hello", new SupportInquiryDiagnostics(null, null, null, null, null, null), ProgramStart));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        await new AccountDeletionStore(_db).DeleteAllDataAsync(oldUserId, $"test/{oldUserId}/", DateTimeOffset.UtcNow);

        Assert.Null(await new EntitlementStore(NewContext()).GetUserStateAsync(identity));
        Assert.Equal(0, await _db.SupportInquiries.AsNoTracking().CountAsync(inquiry => inquiry.UserId == oldUserId));
        Assert.Equal(1, await LedgerCountAsync(identity));

        // Same Entra identity signs in again months later: a brand-new Juple user, but NOT a new 30 days.
        var recreated = await BootstrapService(NewContext(), enabled: true, ProgramStart.AddDays(200)).BootstrapAsync(identity, command);

        var newUserId = (await new EntitlementStore(NewContext()).GetUserStateAsync(identity))!.UserId;
        Assert.NotEqual(oldUserId, newUserId);
        Assert.Equal(original.Entitlement.TrialStartedAtUtc, recreated.Entitlement.TrialStartedAtUtc);
        Assert.Equal(original.Entitlement.TrialEndsAtUtc, recreated.Entitlement.TrialEndsAtUtc);
        Assert.Equal(EntitlementStatus.Expired, recreated.Entitlement.Status);
        Assert.False(recreated.Entitlement.CanWrite);
        Assert.Equal(1, await LedgerCountAsync(identity));
        Assert.Equal((ProgramStart, ProgramStart.AddDays(30)), await StoredTrialAsync(identity));
    }

    [Fact]
    public async Task TheLegacyPlanColumn_IsUntouched_AndNeverTheEntitlementSource()
    {
        var identity = NewIdentity();
        await SeedExistingAsync(identity, new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero));
        await BootstrapService(NewContext(), enabled: true, ProgramStart.AddDays(40))
            .BootstrapAsync(identity, new BootstrapCurrentUserCommand("ko-KR", "Asia/Seoul"));

        var plans = await _db.Database
            .SqlQueryRaw<string>(
                "SELECT u.[Plan] AS [Value] FROM users.Users u JOIN [identity].ExternalIdentities e ON e.UserId = u.Id WHERE e.TenantId = {0} AND e.ObjectId = {1}",
                identity.TenantId, identity.ObjectId)
            .ToListAsync();

        // Expired by entitlement, yet still "Free" in the legacy column: the two are independent.
        Assert.Equal(["Free"], plans);
    }
}
