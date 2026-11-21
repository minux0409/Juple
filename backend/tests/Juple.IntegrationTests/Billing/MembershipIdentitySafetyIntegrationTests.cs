using System.Security.Cryptography;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Application.Users.DeleteAccount;
using Juple.Domain.Billing;
using Juple.Domain.Identity;
using Juple.Domain.Users;
using Juple.Infrastructure.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Billing;

public sealed class MembershipIdentitySafetyIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Start = new(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);
    private readonly BillingOptions _options = new() { ProgramEnabled = true, ProgramStartAtUtc = Start,
        TrialIdentityHashKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) };
    private readonly List<long> _users = [];
    private readonly List<long> _purchases = [];
    private readonly List<byte[]> _hashes = [];
    private readonly List<ExternalIdentityPrincipal> _signupIdentities = [];
    private string _connection = null!;
    private long _user;
    private JupleDbContext Context() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connection).Options);
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Start; }
    public async Task InitializeAsync()
    {
        _connection = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("A dedicated SQL test connection is required.");
        _user = await NewUserAsync();
    }
    private async Task<long> NewUserAsync()
    {
        await using var db = Context();
        var user = new User("en-US", "UTC", null, Start.AddDays(-100), Start.AddDays(-100));
        db.Users.Add(user); await db.SaveChangesAsync(); _users.Add(user.Id); return user.Id;
    }
    private async Task<ExternalIdentityPrincipal> AddIdentityAsync()
    {
        var identity = new ExternalIdentityPrincipal(Guid.NewGuid(), Guid.NewGuid());
        await using var db = Context();
        db.ExternalIdentities.Add(new(_user, identity.TenantId, identity.ObjectId, Start.AddDays(-100)));
        await db.SaveChangesAsync(); _hashes.Add(new TrialIdentityHasher(_options).Hash(identity)); return identity;
    }
    private EntitlementService Service(JupleDbContext db) => new(_options, new EntitlementStore(db),
        new TrialIdentityHasher(_options), new Clock(), new MembershipGrantStore(db));
    public async Task DisposeAsync()
    {
        foreach (var identity in _signupIdentities)
        {
            await using var lookup = Context();
            var id = await lookup.ExternalIdentities.Where(row => row.TenantId == identity.TenantId && row.ObjectId == identity.ObjectId)
                .Select(row => (long?)row.UserId).SingleOrDefaultAsync();
            if (id is { } userId && !_users.Contains(userId)) _users.Add(userId);
        }
        foreach (var id in _users)
        {
            await using var db = Context();
            var prefix = $"identity-safety/{id}/";
            await new AccountDeletionStore(db).DeleteAllDataAsync(id, prefix, Start);
            await db.AccountDeletionBlobCleanups.Where(row => row.BlobPrefix == prefix).ExecuteDeleteAsync();
        }
        await using var cleanup = Context();
        await cleanup.StorePurchases.Where(row => _purchases.Contains(row.Id)).ExecuteDeleteAsync();
        foreach (var hash in _hashes)
            await cleanup.Set<MembershipTrialLedgerEntry>().Where(row => row.IdentityHash == hash).ExecuteDeleteAsync();
    }
    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public async Task UnsettledIdentity_IsNotGuessedOrGrantedAnotherTrial(int count)
    {
        ExternalIdentityPrincipal? identity = null;
        for (var i = 0; i < count; i++) identity = await AddIdentityAsync();
        await using var db = Context();
        var state = (await new EntitlementStore(db).GetUserStateAsync(_user))!;
        Assert.Null(state.ExternalIdentity);
        Assert.Equal(count > 1, state.HasMultipleExternalIdentities);
        var error = await Assert.ThrowsAsync<MembershipTrialIdentityException>(() => Service(db).GetForUserAsync(_user));
        Assert.Equal(count > 1, error.Multiple);
        if (identity is not null)
            await Assert.ThrowsAsync<MembershipTrialIdentityException>(() => Service(db).GetForIdentityAsync(identity));
        var after = (await new EntitlementStore(db).GetUserStateAsync(_user))!;
        Assert.Null(after.MembershipTrialStartedAtUtc);
        foreach (var hash in _hashes)
            Assert.False(await db.Set<MembershipTrialLedgerEntry>().AnyAsync(row => row.IdentityHash == hash));
    }
    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public async Task ASettledOfficialWindow_IsReusedWithoutIdentitySelection(int count)
    {
        for (var i = 0; i < count; i++) await AddIdentityAsync();
        await using var db = Context();
        await db.Users.Where(row => row.Id == _user).ExecuteUpdateAsync(setters => setters
            .SetProperty(row => row.MembershipTrialStartedAtUtc, Start)
            .SetProperty(row => row.MembershipTrialEndsAtUtc, Start.AddHours(720)));
        var result = await Service(db).GetForUserAsync(_user);
        Assert.Equal(EntitlementStatus.Trial, result.Status);
        Assert.Equal(Start.AddHours(720), result.TrialEndsAtUtc);
        foreach (var hash in _hashes)
            Assert.False(await db.Set<MembershipTrialLedgerEntry>().AnyAsync(row => row.IdentityHash == hash));
    }
    [Theory]
    [InlineData(0, StorePurchaseState.Active)]
    [InlineData(2, StorePurchaseState.Active)]
    [InlineData(0, StorePurchaseState.Canceled)]
    [InlineData(2, StorePurchaseState.GracePeriod)]
    public async Task VerifiedAccountOwnedAccess_IsPreservedWithoutCreatingATrial(int count, StorePurchaseState state)
    {
        for (var i = 0; i < count; i++) await AddIdentityAsync();
        await using var db = Context();
        var purchase = new StorePurchase(_user, StoreSource.GooglePlay, "juple_monthly",
            RandomNumberGenerator.GetBytes(32), RandomNumberGenerator.GetBytes(32), Start);
        purchase.ApplyVerified(new(state, EntitlementReason.None, Start.AddDays(60), false, false, Start.AddDays(1)), "monthly", Start, Start);
        db.StorePurchases.Add(purchase); await db.SaveChangesAsync(); _purchases.Add(purchase.Id);
        var result = await Service(db).GetForUserAsync(_user);
        Assert.True(result.CanWrite);
        Assert.Equal(Start.AddDays(60), result.CurrentPeriodEndsAtUtc);
        Assert.Null(result.TrialStartedAtUtc);
        Assert.Null((await new EntitlementStore(db).GetUserStateAsync(_user))!.MembershipTrialStartedAtUtc);
    }
    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public async Task AdministratorAccess_IsPreservedWithoutCreatingATrial(int count)
    {
        for (var i = 0; i < count; i++) await AddIdentityAsync();
        await using var db = Context();
        db.Set<MembershipGrant>().Add(new(Guid.NewGuid(), _user, MembershipGrantKind.Complimentary, 999, Start,
            Start, Start.AddDays(45), "Synthetic identity safety test"));
        await db.SaveChangesAsync();
        var result = await Service(db).GetForUserAsync(_user);
        Assert.True(result.CanWrite);
        Assert.Equal(Start.AddDays(45), result.ComplimentaryAccessEndsAtUtc);
        Assert.Null(result.TrialStartedAtUtc);
    }
    [Fact]
    public async Task DuplicateExternalIdentity_IsRejectedAndNeverTransferred()
    {
        var identity = await AddIdentityAsync(); var other = await NewUserAsync();
        await using var db = Context();
        db.ExternalIdentities.Add(new(other, identity.TenantId, identity.ObjectId, Start));
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.IsType<SqlException>(error.InnerException);
        Assert.Contains(((SqlException)error.InnerException!).Number, new[] { 2601, 2627 });
        db.ChangeTracker.Clear();
        var rows = await db.ExternalIdentities.Where(row => row.TenantId == identity.TenantId && row.ObjectId == identity.ObjectId).ToListAsync();
        Assert.Single(rows); Assert.Equal(_user, rows[0].UserId);
    }

    [Theory]
    [InlineData(StorePurchaseState.Pending)]
    [InlineData(StorePurchaseState.OnHold)]
    [InlineData(StorePurchaseState.Expired)]
    public async Task UnresolvedIdentity_WithNoLivePayment_DoesNotReceiveFreeOrPaidAccess(StorePurchaseState state)
    {
        await using var db = Context();
        var purchase = new StorePurchase(_user, StoreSource.GooglePlay, "juple_monthly",
            RandomNumberGenerator.GetBytes(32), RandomNumberGenerator.GetBytes(32), Start);
        purchase.ApplyVerified(new(state, EntitlementReason.None,
            state == StorePurchaseState.Expired ? Start.AddDays(-1) : Start.AddDays(10), false, false, Start), "monthly", Start, Start);
        db.StorePurchases.Add(purchase); await db.SaveChangesAsync(); _purchases.Add(purchase.Id);
        await Assert.ThrowsAsync<MembershipTrialIdentityException>(() => Service(db).GetForUserAsync(_user));
        Assert.Null((await new EntitlementStore(db).GetUserStateAsync(_user))!.MembershipTrialStartedAtUtc);
    }

    [Fact]
    public async Task ConcurrentRealSignups_CreateOneAccountAndOneOfficialTrial()
    {
        var identity = new ExternalIdentityPrincipal(Guid.NewGuid(), Guid.NewGuid());
        _signupIdentities.Add(identity);
        _hashes.Add(new TrialIdentityHasher(_options).Hash(identity));
        var racers = Enumerable.Range(0, 8).Select(async _ =>
        {
            await using var db = Context();
            var provisioning = new CurrentUserProvisioningStore(db);
            var service = new CurrentUserBootstrapService(provisioning, Service(db), new Clock(),
                new EntraAccountDeletionOptions(), new Juple.IntegrationTests.Users.NeverPending(),
                new Juple.IntegrationTests.Users.SilentEntraDirectory(), new TrialIdentityHasher(_options), _options);
            var answer = await service.BootstrapAsync(identity, new BootstrapCurrentUserCommand("en-US", "UTC", Start.AddMinutes(-1)));
            return (answer, provisioning.CreatedAccount);
        });
        var answers = await Task.WhenAll(racers);
        await using var check = Context();
        var mapping = await check.ExternalIdentities.Where(row => row.TenantId == identity.TenantId && row.ObjectId == identity.ObjectId).SingleAsync();
        _users.Add(mapping.UserId);
        Assert.Single(answers, item => item.CreatedAccount);
        Assert.All(answers, item =>
        {
            Assert.Equal(Start, item.answer.Entitlement.TrialStartedAtUtc);
            Assert.Equal(Start.AddHours(720), item.answer.Entitlement.TrialEndsAtUtc);
        });
        var hash = new TrialIdentityHasher(_options).Hash(identity);
        Assert.Equal(1, await check.Set<MembershipTrialLedgerEntry>().CountAsync(row => row.IdentityHash == hash));
    }
}
