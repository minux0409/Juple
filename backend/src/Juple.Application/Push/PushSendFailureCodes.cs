namespace Juple.Application.Push;

/// <summary>
/// Canonical FailureCode values an IPushSender may put on a Failed PushSendResult - shared between
/// senders (who classify a provider-specific error down to one of these) and
/// DispatchDuePushNotificationsService (who decides whether a permanent one should also disable the
/// PushDeviceRegistration, not just record a Failed delivery). Keeping this vocabulary
/// transport-agnostic means the dispatch worker's disable policy never depends on FCM/APNs-specific
/// enum names, and stays correct if the transport is ever swapped.
///
/// Only Unregistered/SenderIdMismatch are treated as permanent (see
/// DispatchDuePushNotificationsService.IsPermanentFailure) - deliberately conservative. FCM's own
/// INVALID_ARGUMENT, for example, can also mean "our own payload was malformed" rather than "this
/// token is dead" (confirmed against Google's own FCM v1 error-code documentation), so disabling a
/// user's device on that code would risk punishing a real device for a Backend bug. When genuinely
/// unsure, the safer default is "record Failed, let it retry" - never a spurious disable.
/// </summary>
public static class PushSendFailureCodes
{
    /// <summary>The token itself is permanently dead (FCM UNREGISTERED, or any future transport's equivalent) - the registration should stop being retried forever.</summary>
    public const string Unregistered = "unregistered";

    /// <summary>The token belongs to a different Firebase project/sender than this Backend is configured for - also permanently unusable for us.</summary>
    public const string SenderIdMismatch = "sender_id_mismatch";

    /// <summary>Request-shape error (FCM INVALID_ARGUMENT) - may or may not be the token; never auto-disables (see this type's own remarks).</summary>
    public const string InvalidArgument = "invalid_argument";

    /// <summary>Provider-side rate limiting - transient, retry later.</summary>
    public const string QuotaExceeded = "quota_exceeded";

    /// <summary>Provider transport temporarily unavailable - transient, retry later.</summary>
    public const string Unavailable = "unavailable";

    /// <summary>Provider-side internal error - transient, retry later.</summary>
    public const string Internal = "internal";

    /// <summary>APNs certificate/web push auth key issue - a server credential problem, not this specific token; never auto-disables.</summary>
    public const string ThirdPartyAuthError = "third_party_auth_error";

    /// <summary>This Backend's own send call did not complete within its send timeout - see IPushSender implementations' own timeout policy. Always transient.</summary>
    public const string SendTimeout = "send_timeout";

    /// <summary>No IPushSender transport is configured at all (see NotConfiguredPushSender) - not a token problem, never disables the registration.</summary>
    public const string TransportNotConfigured = "push_transport_not_configured";

    /// <summary>Anything a sender could not classify into a more specific code above.</summary>
    public const string UnknownError = "unknown_error";

    private static readonly HashSet<string> PermanentCodes = new(
        [Unregistered, SenderIdMismatch], StringComparer.Ordinal);

    /// <summary>Whether this FailureCode means the PushDeviceRegistration itself should be disabled, not just this one delivery recorded as Failed.</summary>
    public static bool IsPermanent(string? failureCode) =>
        failureCode is not null && PermanentCodes.Contains(failureCode);
}
