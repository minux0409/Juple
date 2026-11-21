using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;

namespace Juple.Application.Billing;

/// <summary>What the entitlement needs to know about one account - and nothing else (no profile, no Plan).</summary>
public sealed record EntitlementUserState(
    long UserId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? TrialStartedAtUtc,
    DateTimeOffset? TrialEndsAtUtc,
    ExternalIdentityPrincipal? ExternalIdentity,
    DateTimeOffset? MembershipTrialStartedAtUtc = null,
    DateTimeOffset? MembershipTrialEndsAtUtc = null,
    bool HasMultipleExternalIdentities = false);

/// <summary>Unsettled trial identity requires verified account-link review; never infer an identity or issue another trial.</summary>
public sealed class MembershipTrialIdentityException(bool multiple) : InvalidOperationException(
    multiple ? "Official membership trial identity is ambiguous; verified account-link review is required."
        : "Official membership trial identity is missing; verified account-link review is required.")
{
    public bool Multiple { get; } = multiple;
}

public interface IEntitlementStore
{
    Task<EntitlementUserState?> GetUserStateAsync(long userId, CancellationToken cancellationToken = default);

    Task<EntitlementUserState?> GetUserStateAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default);

    /// <summary>What each of the account's store purchases currently grants (empty when it never bought). Detached purchases are not the account's.</summary>
    Task<IReadOnlyList<PurchaseAccess>> GetPurchaseAccessAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>The account's own store purchases as ownership needs them (detached ones are not the account's). Read-only.</summary>
    Task<IReadOnlyList<OwnedStorePurchase>> GetOwnedPurchasesAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Atomically and idempotently settles the account's official membership trial in MembershipTrialLedger. Historical TrialLedger is untouched. <paramref name="identityHash"/> is the ledger key. If the
    /// ledger already holds that identity, ITS window is used and projected onto the user (never a fresh 30 days);
    /// otherwise <paramref name="newWindow"/> is recorded in the ledger. Two concurrent first calls converge on one ledger
    /// row and one window. Returns the window now in force.
    /// </summary>
    Task<TrialWindow> EnsureTrialAsync(
        long userId,
        byte[] identityHash,
        TrialWindow newWindow,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Identity is "who is this user" (ICurrentJupleUserAccessor); this is "what access does this user have". Account-centric:
/// it knows the account, never a device or a store.
/// </summary>
public interface IEntitlementService
{
    Task<Entitlement> GetForUserAsync(long userId, CancellationToken cancellationToken = default);

    Task<Entitlement> GetForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default);

    /// <summary>
    /// Whether the account owns a verified store subscription RIGHT NOW - independent of ProgramEnabled (a program that does not yet require a
    /// subscription must still not hide one the person already pays for). Persisted server state and the server clock only: no store call,
    /// no trial started or consumed, nothing about access changes.
    /// </summary>
    Task<StoreSubscriptionOwnership> GetStoreSubscriptionForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default);
}

public sealed class EntitlementService(
    BillingOptions options,
    IEntitlementStore store,
    ITrialIdentityHasher hasher,
    TimeProvider timeProvider,
    IMembershipGrantReader? membershipGrants = null) : IEntitlementService
{
    public async Task<Entitlement> GetForUserAsync(long userId, CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        if (!options.ProgramEnabled)
        {
            return await BeforeLaunchAsync(userId, nowUtc, cancellationToken);
        }

        var state = await store.GetUserStateAsync(userId, cancellationToken) ?? throw new CurrentJupleUserNotFoundException();
        return await EvaluateAsync(state, nowUtc, cancellationToken);
    }

    public async Task<Entitlement> GetForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        if (!options.ProgramEnabled)
        {
            // Program not launched: no trial is started or consumed just because someone signed in.
            var stateBeforeLaunch = membershipGrants is null ? null : await store.GetUserStateAsync(externalIdentity, cancellationToken);
            return stateBeforeLaunch is null ? Entitlement.NotLaunched(nowUtc)
                : await BeforeLaunchAsync(stateBeforeLaunch.UserId, nowUtc, cancellationToken);
        }

        var state = await store.GetUserStateAsync(externalIdentity, cancellationToken) ?? throw new CurrentJupleUserNotFoundException();
        return await EvaluateAsync(state, nowUtc, cancellationToken);
    }

    public async Task<StoreSubscriptionOwnership> GetStoreSubscriptionForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default)
    {
        var state = await store.GetUserStateAsync(externalIdentity, cancellationToken);
        if (state is null)
        {
            return StoreSubscriptionOwnership.None;
        }

        return StoreSubscriptionOwnership.From(await store.GetOwnedPurchasesAsync(state.UserId, cancellationToken), timeProvider.GetUtcNow());
    }

    private async Task<Entitlement> EvaluateAsync(EntitlementUserState state, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var purchases = await store.GetPurchaseAccessAsync(state.UserId, cancellationToken);
        var complimentary = membershipGrants is null ? default : await membershipGrants.GetComplimentaryAsync(state.UserId, nowUtc, cancellationToken);
        var settled = state.MembershipTrialStartedAtUtc is not null && state.MembershipTrialEndsAtUtc is not null;
        if (!settled && (state.ExternalIdentity is null || state.HasMultipleExternalIdentities))
        {
            // Existing verified, account-owned access is independent of trial eligibility. Do not interrupt it,
            // invent a trial identity, reuse historical test windows or change any persisted record.
            if (purchases.Any(purchase => purchase.IsLiveAt(nowUtc))
                || (complimentary.ActiveUntilUtc is { } grantEnd && nowUtc < grantEnd))
            {
                return EntitlementCalculator.Effective(null, purchases, nowUtc, complimentary);
            }
            throw new MembershipTrialIdentityException(state.HasMultipleExternalIdentities);
        }
        var window = await SettleTrialAsync(state, nowUtc, cancellationToken);
        return EntitlementCalculator.Effective(window, purchases, nowUtc, complimentary);
    }

    private async Task<Entitlement> BeforeLaunchAsync(long userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var result = Entitlement.NotLaunched(now);
        var complimentary = membershipGrants is null ? default : await membershipGrants.GetComplimentaryAsync(userId, now, cancellationToken);
        return complimentary.ActiveUntilUtc is { } end ? result.WithComplimentaryAccess(end) : result;
    }

    private async Task<TrialWindow> SettleTrialAsync(EntitlementUserState state, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        if (state.MembershipTrialStartedAtUtc is { } started && state.MembershipTrialEndsAtUtc is { } ends)
        {
            return new TrialWindow(started, ends);
        }

        // Historical test fields/ledger never consume the official launch trial.
        // Re-created accounts inherit the OFFICIAL ledger window, never another 720 hours.
        var identity = state.ExternalIdentity
            ?? throw new InvalidOperationException("An account always has an external identity; none was found for the trial ledger.");
        var programStart = options.ProgramStartAtUtc
            ?? throw new InvalidOperationException("Billing:ProgramStartAtUtc is required while the program is enabled.");
        return await store.EnsureTrialAsync(
            state.UserId,
            hasher.Hash(identity),
            TrialPolicy.WindowFor(state.CreatedAtUtc, programStart),
            nowUtc,
            cancellationToken);
    }
}
