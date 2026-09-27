using System.Security.Claims;
using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Application.Collections;
using Juple.Application.Collections.Locking;

namespace Juple.UnitTests.Collections;

/// <summary>Settings > 컬렉션 잠금: the one lock password - reset after a recent sign-in, and change.</summary>
public sealed class CollectionLockPasswordServiceTests
{
    private const long Owner = 1;
    private const long OtherUser = 2;
    private const long LockedA = 10;
    private const long LockedB = 11;
    private const long Unlocked = 12;
    private const long OthersLocked = 20;
    private static readonly DateTimeOffset Now = new(2026, 9, 27, 9, 0, 0, TimeSpan.Zero);

    private readonly MutableTimeProvider _time = new(Now);
    private readonly InMemoryCollectionLockStore _locks = new InMemoryCollectionLockStore()
        .Locked(LockedA, "hash:legacy-a", lockVersion: 3).OwnedBy(LockedA, Owner)
        .Locked(LockedB, null, lockVersion: 1).OwnedBy(LockedB, Owner)
        .Unlocked(Unlocked).OwnedBy(Unlocked, Owner)
        .Locked(OthersLocked, null, lockVersion: 7).OwnedBy(OthersLocked, OtherUser);
    private readonly InMemoryCollectionLockSettingsStore _settings;

    public CollectionLockPasswordServiceTests()
    {
        _settings = new InMemoryCollectionLockSettingsStore(_locks);
    }

    private CollectionLockPasswordService Service() => new(_settings, new CollectionLockPasswordHasher(), _time);

    // ---------- recent sign-in (reset / first setup) ----------

    [Fact]
    public async Task Reset_WithoutASignInTime_IsRefused()
    {
        await Assert.ThrowsAsync<RecentAuthenticationRequiredException>(() => Service().ResetAsync(Owner, "new-pass-1", "new-pass-1", null));
        Assert.Empty(_settings.Rows);
    }

    [Theory]
    [InlineData(-301)] // more than 5 minutes ago
    [InlineData(-3600)]
    [InlineData(61)] // further in the future than clock skew allows
    [InlineData(600)]
    public async Task Reset_WithAStaleOrImplausibleSignIn_IsRefused(int offsetSeconds)
    {
        await Assert.ThrowsAsync<RecentAuthenticationRequiredException>(() =>
            Service().ResetAsync(Owner, "new-pass-1", "new-pass-1", Now.AddSeconds(offsetSeconds)));
        Assert.Empty(_settings.Rows);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(-300)] // exactly 5 minutes
    [InlineData(60)] // within the allowed clock skew
    public async Task Reset_RightAfterASignIn_Succeeds(int offsetSeconds)
    {
        await Service().ResetAsync(Owner, "new-pass-1", "new-pass-1", Now.AddSeconds(offsetSeconds));
        Assert.True(_settings.Rows.ContainsKey(Owner));
    }

    [Fact]
    public async Task Reset_ChecksTheSignInBeforeTheInput()
    {
        // No recent sign-in: refused as such even with an invalid password - nothing about the input leaks first.
        await Assert.ThrowsAsync<RecentAuthenticationRequiredException>(() => Service().ResetAsync(Owner, "x", "y", null));
    }

    [Fact]
    public async Task Reset_CreatesTheRow_ThenReplacesIt_KeepingOneRowPerUser()
    {
        await Service().ResetAsync(Owner, "first-pass", "first-pass", Now);
        var created = _settings.Rows[Owner];
        Assert.Equal(Now, created.CreatedAtUtc);

        _time.Now = Now.AddDays(1);
        await Service().ResetAsync(Owner, "second-pass", "second-pass", _time.Now);

        var replaced = Assert.Single(_settings.Rows).Value;
        Assert.Same(created, replaced);
        Assert.Equal(Now, replaced.CreatedAtUtc);
        Assert.Equal(_time.Now, replaced.PasswordChangedAtUtc);
        Assert.True(new CollectionLockPasswordHasher().Verify(replaced.PasswordHash, "second-pass"));
        Assert.False(new CollectionLockPasswordHasher().Verify(replaced.PasswordHash, "first-pass"));
    }

    [Fact]
    public async Task Reset_BumpsLockVersionOnEveryLockedCollectionOfThatUserOnly_AndClearsTheirUnlockCounters()
    {
        var ownerKey = CollectionUnlockSubject.ForUser(Owner).ThrottleKey;
        await _locks.RecordFailureAsync(LockedA, ownerKey, Now);

        await Service().ResetAsync(Owner, "new-pass-1", "new-pass-1", Now);

        Assert.Equal(4, _locks.States[LockedA].LockVersion);
        Assert.Equal(2, _locks.States[LockedB].LockVersion);
        Assert.Equal(0, _locks.States[Unlocked].LockVersion);
        Assert.Equal(7, _locks.States[OthersLocked].LockVersion);
        Assert.False(_settings.Rows.ContainsKey(OtherUser));
        Assert.Empty(_locks.Throttles);
    }

    [Fact]
    public async Task Reset_NeverStoresThePassword()
    {
        await Service().ResetAsync(Owner, "plain-secret-1", "plain-secret-1", Now);

        var hash = _settings.Rows[Owner].PasswordHash;
        Assert.DoesNotContain("plain-secret-1", hash);
        Assert.True(new CollectionLockPasswordHasher().Verify(hash, "plain-secret-1"));
    }

    [Theory]
    [InlineData("short", "short", "newPassword")]
    [InlineData(null, null, "newPassword")]
    [InlineData("long-enough-1", "long-enough-2", "confirmPassword")]
    public async Task NewPassword_FollowsThePolicy_AndMustBeConfirmed(string? newPassword, string? confirmPassword, string field)
    {
        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().ResetAsync(Owner, newPassword, confirmPassword, Now));
        Assert.Equal(field, exception.Field);
        Assert.Empty(_settings.Rows);
    }

    // ---------- change (current password) ----------

    [Fact]
    public async Task Change_WithoutALockPassword_IsNotConfigured()
    {
        await Assert.ThrowsAsync<CollectionLockPasswordNotConfiguredException>(() =>
            Service().ChangeAsync(Owner, "anything-1", "new-pass-1", "new-pass-1"));
    }

    [Fact]
    public async Task Change_NeedsTheCurrentPassword_AndRevokesGrants()
    {
        await Service().ResetAsync(Owner, "current-1", "current-1", Now);

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().ChangeAsync(Owner, "wrong-one", "next-pass-1", "next-pass-1"));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().ChangeAsync(Owner, null, "next-pass-1", "next-pass-1"));
        await Service().ChangeAsync(Owner, "current-1", "next-pass-1", "next-pass-1");

        Assert.True(new CollectionLockPasswordHasher().Verify(_settings.Rows[Owner].PasswordHash, "next-pass-1"));
        Assert.Equal(5, _locks.States[LockedA].LockVersion); // reset +1, change +1
        Assert.Equal(0, _settings.Rows[Owner].FailedChangeAttemptCount);
    }

    [Fact]
    public async Task Change_IsThrottledAfterFiveWrongCurrentPasswords_EvenForTheRightOne()
    {
        await Service().ResetAsync(Owner, "current-1", "current-1", Now);
        for (var i = 0; i < 5; i++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().ChangeAsync(Owner, "guess-" + i, "next-pass-1", "next-pass-1"));
        }

        await Assert.ThrowsAsync<CollectionUnlockThrottledException>(() => Service().ChangeAsync(Owner, "current-1", "next-pass-1", "next-pass-1"));

        _time.Now = Now.AddMinutes(16);
        await Service().ChangeAsync(Owner, "current-1", "next-pass-1", "next-pass-1");
    }

    [Fact]
    public async Task Reset_ClearsTheChangeThrottle()
    {
        await Service().ResetAsync(Owner, "current-1", "current-1", Now);
        for (var i = 0; i < 5; i++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().ChangeAsync(Owner, "guess-" + i, "next-pass-1", "next-pass-1"));
        }

        await Service().ResetAsync(Owner, "fresh-pass-1", "fresh-pass-1", Now);
        await Service().ChangeAsync(Owner, "fresh-pass-1", "next-pass-1", "next-pass-1");
    }

    // ---------- the auth_time claim (API) ----------

    private static ClaimsPrincipal Principal(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(claim => new Claim(claim.Type, claim.Value)), "Bearer"));

    [Fact]
    public void AuthenticationTimeClaim_ReadsAuthTimeAsUnixSeconds_UnderEitherClaimName()
    {
        var instant = Now.AddSeconds(-42);
        Assert.Equal(instant, AuthenticationTimeClaim.Read(Principal(("auth_time", instant.ToUnixTimeSeconds().ToString()))));
        Assert.Equal(instant, AuthenticationTimeClaim.Read(Principal((ClaimTypes.AuthenticationInstant, instant.ToUnixTimeSeconds().ToString()))));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-number")]
    [InlineData("-5")]
    [InlineData("0")]
    [InlineData("1.5")]
    [InlineData("99999999999999")]
    [InlineData("2026-09-27T09:00:00Z")]
    public void AuthenticationTimeClaim_MissingOrMalformed_IsNull(string? value)
    {
        var principal = value is null ? Principal() : Principal(("auth_time", value));
        Assert.Null(AuthenticationTimeClaim.Read(principal));
    }

    [Fact]
    public void AuthenticationTimeClaim_NeverFallsBackToIat()
    {
        Assert.Null(AuthenticationTimeClaim.Read(Principal(("iat", Now.ToUnixTimeSeconds().ToString()))));
    }
}
