using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;

namespace Juple.Application.Billing;

/// <summary>
/// Where ONE account stands in the post-subscription data retention policy, from the same account facts the entitlement uses (trial
/// window, verified store purchases) - not a second subscription model. Read-only: it never starts or settles a trial (evaluate the
/// entitlement first - bootstrap does), sends nothing and deletes nothing.
/// </summary>
public interface IDataRetentionService
{
    Task<DataRetentionState> GetForUserAsync(long userId, CancellationToken cancellationToken = default);
}

public sealed class DataRetentionService(BillingOptions options, IEntitlementStore store, TimeProvider timeProvider) : IDataRetentionService
{
    public async Task<DataRetentionState> GetForUserAsync(long userId, CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var effectiveAt = options.DataRetention.PolicyEffectiveAtUtc;
        if (!options.ProgramEnabled || effectiveAt is null)
        {
            // Production today: the answer is NotApplicable and nothing is even read.
            return DataRetentionPolicy.Evaluate(new DataRetentionInput(options.ProgramEnabled, effectiveAt, default, null, []), nowUtc);
        }

        var state = await store.GetUserStateAsync(userId, cancellationToken) ?? throw new CurrentJupleUserNotFoundException();
        var purchases = await store.GetPurchaseAccessAsync(userId, cancellationToken);
        return DataRetentionPolicy.Evaluate(new DataRetentionInput(true, effectiveAt, state.CreatedAtUtc, state.TrialEndsAtUtc, purchases), nowUtc);
    }
}
