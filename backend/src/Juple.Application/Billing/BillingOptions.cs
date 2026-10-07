using Juple.Domain.Billing;

namespace Juple.Application.Billing;

/// <summary>
/// Bound from the "Billing" configuration section - the explicit, server-side switch for the subscription program.
///
/// ProgramEnabled defaults to false: nobody is restricted, no trial is started or consumed, nothing is frozen, and the
/// app behaves exactly as it did before billing existed. It is turned on later, deliberately, with a real ProgramStartAtUtc
/// (see <see cref="TrialPolicy"/> for how that instant sets the existing accounts' fresh 30 days).
///
/// TrialDurationDays exists only so a configuration that disagrees with the fixed 30-day product decision fails loudly
/// at startup instead of silently becoming a different policy; the trial length itself is TrialPolicy, not this value.
///
/// TrialIdentityHashKey is the HMAC secret (Base64, at least 32 bytes) for the trial ledger. It is required only while the
/// program is enabled, is never committed, and comes from user-secrets locally and from the environment / a Key Vault-backed
/// Container Apps secret reference when deployed (Billing__TrialIdentityHashKey) - no code change is needed to move it.
/// There is no development entitlement override of any kind.
/// </summary>
public sealed class BillingOptions
{
    public const int MinimumHashKeyBytes = 32;

    public bool ProgramEnabled { get; set; }

    public DateTimeOffset? ProgramStartAtUtc { get; set; }

    public int TrialDurationDays { get; set; } = TrialPolicy.DurationDays;

    public string? TrialIdentityHashKey { get; set; }
}

public static class BillingOptionsValidator
{
    /// <summary>Throws <see cref="InvalidOperationException"/> with the exact setting at fault. Never echoes the secret.</summary>
    public static void Validate(BillingOptions options)
    {
        if (options.TrialDurationDays != TrialPolicy.DurationDays)
        {
            throw new InvalidOperationException(
                $"Billing:TrialDurationDays must be {TrialPolicy.DurationDays} (the trial length is a fixed product decision), but is {options.TrialDurationDays}.");
        }

        if (!options.ProgramEnabled)
        {
            // Nothing else is required (or looked at) until the program is launched.
            return;
        }

        if (options.ProgramStartAtUtc is null)
        {
            throw new InvalidOperationException("Billing:ProgramStartAtUtc is required when Billing:ProgramEnabled is true.");
        }

        if (!TrialIdentityHasher.TryDecodeKey(options.TrialIdentityHashKey, out _))
        {
            throw new InvalidOperationException(
                $"Billing:TrialIdentityHashKey is required when Billing:ProgramEnabled is true: a Base64 value of at least {BillingOptions.MinimumHashKeyBytes} bytes.");
        }
    }
}
