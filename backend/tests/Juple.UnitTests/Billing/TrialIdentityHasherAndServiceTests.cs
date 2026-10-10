using System.Security.Cryptography;
using System.Text;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing;

public sealed class TrialIdentityHasherTests
{
    private static readonly byte[] Key = Enumerable.Range(1, 32).Select(value => (byte)value).ToArray();
    private static readonly ExternalIdentityPrincipal Identity = new(
        Guid.Parse("11111111-2222-3333-4444-555555555555"), Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));

    private static TrialIdentityHasher Hasher(byte[]? key = null) =>
        new(new BillingOptions { TrialIdentityHashKey = Convert.ToBase64String(key ?? Key) });

    [Fact]
    public void TheHashIsHmacSha256OverTheDomainSeparatedCanonicalIdentity()
    {
        var expected = HMACSHA256.HashData(
            Key, Encoding.UTF8.GetBytes("juple-trial-v1|11111111-2222-3333-4444-555555555555|aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));

        var hash = Hasher().Hash(Identity);

        Assert.Equal(32, hash.Length);
        Assert.Equal(expected, hash);
    }

    [Fact]
    public void ItIsDeterministicForOneIdentity_AndDifferentForAnyOther()
    {
        var hasher = Hasher();

        Assert.Equal(hasher.Hash(Identity), hasher.Hash(Identity with { }));
        Assert.NotEqual(hasher.Hash(Identity), hasher.Hash(Identity with { ObjectId = Guid.NewGuid() }));
        Assert.NotEqual(hasher.Hash(Identity), hasher.Hash(Identity with { TenantId = Guid.NewGuid() }));
        // (tenant, object) is not symmetric: swapping the two ids is a different identity.
        Assert.NotEqual(hasher.Hash(Identity), hasher.Hash(new ExternalIdentityPrincipal(Identity.ObjectId, Identity.TenantId)));
    }

    [Fact]
    public void ADifferentKeyGivesADifferentHash()
    {
        var otherKey = Key.Select(value => (byte)(value ^ 0xFF)).ToArray();

        Assert.NotEqual(Hasher().Hash(Identity), Hasher(otherKey).Hash(Identity));
    }

    [Fact]
    public void TheHashDoesNotContainTheRawTenantOrObjectId()
    {
        var hash = Hasher().Hash(Identity);

        Assert.False(Contains(hash, Identity.TenantId.ToByteArray()));
        Assert.False(Contains(hash, Identity.ObjectId.ToByteArray()));
        Assert.DoesNotContain(Identity.TenantId.ToString("D"), Convert.ToHexString(hash), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void WithoutAKey_HashingFailsClearly()
    {
        Assert.Throws<InvalidOperationException>(() => new TrialIdentityHasher(new BillingOptions()).Hash(Identity));
    }

    [Fact]
    public void HashesAreComparedInConstantTime()
    {
        var hash = Hasher().Hash(Identity);

        Assert.True(TrialIdentityHasher.Equal(hash, hash.ToArray()));
        Assert.False(TrialIdentityHasher.Equal(hash, Hasher().Hash(Identity with { ObjectId = Guid.NewGuid() })));
    }

    private static bool Contains(byte[] haystack, byte[] needle) => haystack.AsSpan().IndexOf(needle) >= 0;
}

public sealed class EntitlementServiceTests
{
    private static readonly DateTimeOffset ProgramStart = new(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly ExternalIdentityPrincipal Identity = new(Guid.NewGuid(), Guid.NewGuid());

    private sealed class StubTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class FakeStore : IEntitlementStore
    {
        public EntitlementUserState? State { get; set; }

        public TrialWindow? LedgerWindow { get; set; }

        public int EnsureCalls { get; private set; }

        public int StateReads { get; private set; }

        public byte[]? LastHash { get; private set; }

        public IReadOnlyList<PurchaseAccess> Purchases { get; set; } = [];

        public Task<IReadOnlyList<PurchaseAccess>> GetPurchaseAccessAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Purchases);

        public IReadOnlyList<OwnedStorePurchase> Owned { get; set; } = [];

        public Task<IReadOnlyList<OwnedStorePurchase>> GetOwnedPurchasesAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Owned);

        public Task<EntitlementUserState?> GetUserStateAsync(long userId, CancellationToken cancellationToken = default)
        {
            StateReads++;
            return Task.FromResult(State);
        }

        public Task<EntitlementUserState?> GetUserStateAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default)
        {
            StateReads++;
            return Task.FromResult(State);
        }

        public Task<TrialWindow> EnsureTrialAsync(long userId, byte[] identityHash, TrialWindow newWindow, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            EnsureCalls++;
            LastHash = identityHash;
            var window = LedgerWindow ?? newWindow;
            LedgerWindow = window;
            State = State! with { TrialStartedAtUtc = window.StartedAtUtc, TrialEndsAtUtc = window.EndsAtUtc };
            return Task.FromResult(window);
        }
    }

    private static BillingOptions Enabled() => new()
    {
        ProgramEnabled = true,
        ProgramStartAtUtc = ProgramStart,
        TrialIdentityHashKey = Convert.ToBase64String(Enumerable.Repeat((byte)7, 32).ToArray()),
    };

    private static EntitlementService Service(BillingOptions options, FakeStore store, StubTime time) =>
        new(options, store, new TrialIdentityHasher(options), time);

    private static EntitlementUserState UserCreated(DateTimeOffset createdAt) => new(42, createdAt, null, null, Identity);

    [Fact]
    public async Task ADisabledProgram_NeverBlocks_AndNeverTouchesTheStore_SoNoTrialIsConsumed()
    {
        var store = new FakeStore { State = UserCreated(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)) };
        var service = Service(new BillingOptions(), store, new StubTime(new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero)));

        var byIdentity = await service.GetForIdentityAsync(Identity);
        var byUser = await service.GetForUserAsync(42);

        foreach (var entitlement in new[] { byIdentity, byUser })
        {
            Assert.False(entitlement.ProgramEnabled);
            Assert.True(entitlement.CanWrite);
            Assert.Null(entitlement.Status);
        }

        Assert.Equal(0, store.EnsureCalls);
        Assert.Equal(0, store.StateReads);
        Assert.Null(store.State!.TrialStartedAtUtc);
    }

    [Fact]
    public async Task AnExistingAccount_GetsItsTrialFromTheProgramStart()
    {
        var store = new FakeStore { State = UserCreated(new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero)) };
        var service = Service(Enabled(), store, new StubTime(new DateTimeOffset(2026, 12, 5, 0, 0, 0, TimeSpan.Zero)));

        var entitlement = await service.GetForIdentityAsync(Identity);

        Assert.Equal(EntitlementStatus.Trial, entitlement.Status);
        Assert.True(entitlement.CanWrite);
        Assert.Equal(ProgramStart, entitlement.TrialStartedAtUtc);
        Assert.Equal(ProgramStart.AddDays(30), entitlement.TrialEndsAtUtc);
        Assert.Equal(1, store.EnsureCalls);
    }

    [Fact]
    public async Task ANewAccount_GetsItsTrialFromItsCreation()
    {
        var created = new DateTimeOffset(2026, 12, 10, 0, 0, 0, TimeSpan.Zero);
        var store = new FakeStore { State = UserCreated(created) };
        var service = Service(Enabled(), store, new StubTime(created.AddHours(1)));

        var entitlement = await service.GetForUserAsync(42);

        Assert.Equal(created, entitlement.TrialStartedAtUtc);
        Assert.Equal(new DateTimeOffset(2027, 1, 9, 0, 0, 0, TimeSpan.Zero), entitlement.TrialEndsAtUtc);
    }

    [Fact]
    public async Task ARecreatedAccount_GetsTheLedgersOriginalWindow_NotAFreshOne()
    {
        var original = new TrialWindow(new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 12, 31, 0, 0, 0, TimeSpan.Zero));
        var store = new FakeStore
        {
            LedgerWindow = original,
            // The re-created account has a new Id and a much later creation time.
            State = new EntitlementUserState(99, new DateTimeOffset(2027, 6, 1, 0, 0, 0, TimeSpan.Zero), null, null, Identity),
        };
        var service = Service(Enabled(), store, new StubTime(new DateTimeOffset(2027, 6, 2, 0, 0, 0, TimeSpan.Zero)));

        var entitlement = await service.GetForIdentityAsync(Identity);

        Assert.Equal(original.StartedAtUtc, entitlement.TrialStartedAtUtc);
        Assert.Equal(original.EndsAtUtc, entitlement.TrialEndsAtUtc);
        Assert.Equal(EntitlementStatus.Expired, entitlement.Status);
        Assert.Equal(original.EndsAtUtc, entitlement.AccessFrozenAtUtc);
    }

    [Fact]
    public async Task AnAlreadySettledAccount_IsEvaluatedWithoutTouchingTheLedger()
    {
        var store = new FakeStore
        {
            State = new EntitlementUserState(42, ProgramStart, ProgramStart, ProgramStart.AddDays(30), Identity),
        };
        var service = Service(Enabled(), store, new StubTime(ProgramStart.AddDays(3)));

        var entitlement = await service.GetForUserAsync(42);

        Assert.Equal(EntitlementStatus.Trial, entitlement.Status);
        Assert.Equal(0, store.EnsureCalls);
    }

    [Fact]
    public async Task TheClockIsTheServerTimeProvider_AndTheEndBoundaryIsExact()
    {
        var store = new FakeStore { State = new EntitlementUserState(42, ProgramStart, ProgramStart, ProgramStart.AddDays(30), Identity) };
        var time = new StubTime(ProgramStart.AddDays(30).AddTicks(-1));
        var service = Service(Enabled(), store, time);

        Assert.Equal(EntitlementStatus.Trial, (await service.GetForUserAsync(42)).Status);

        time.Now = ProgramStart.AddDays(30);
        var expired = await service.GetForUserAsync(42);
        Assert.Equal(EntitlementStatus.Expired, expired.Status);
        Assert.False(expired.CanWrite);

        time.Now = ProgramStart.AddDays(400);
        Assert.Equal(expired.AccessFrozenAtUtc, (await service.GetForUserAsync(42)).AccessFrozenAtUtc);
    }

    [Fact]
    public async Task TheLedgerKeyIsTheKeyedHash_NotTheRawIdentity()
    {
        var store = new FakeStore { State = UserCreated(ProgramStart.AddDays(1)) };
        var options = Enabled();
        var service = Service(options, store, new StubTime(ProgramStart.AddDays(2)));

        await service.GetForIdentityAsync(Identity);

        Assert.Equal(new TrialIdentityHasher(options).Hash(Identity), store.LastHash);
        Assert.Equal(32, store.LastHash!.Length);
    }

    [Fact]
    public async Task AnUnknownAccount_IsReportedAsNotBootstrapped()
    {
        var service = Service(Enabled(), new FakeStore(), new StubTime(ProgramStart));

        await Assert.ThrowsAsync<CurrentJupleUserNotFoundException>(() => service.GetForUserAsync(1));
        await Assert.ThrowsAsync<CurrentJupleUserNotFoundException>(() => service.GetForIdentityAsync(Identity));
    }
}
