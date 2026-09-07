namespace Juple.Domain.Push;

/// <summary>
/// A user-owned device's Push registration - Backend's own source of truth for "which devices
/// should receive Push for this user," independent of whatever Push transport (Azure Notification
/// Hubs' own Installation model, or any other) eventually delivers it. Kept independent on purpose:
/// this row's lifecycle (register/rotate/disable) must never depend on a Notification Hub already
/// existing, and a future transport swap never needs a Mobile-facing contract change.
///
/// InstallationId is a stable, client-generated identifier for one app install on one device
/// (mobile generates and persists it locally, e.g. via a UUID kept in device storage) - it is the
/// idempotency key for re-registration, never derived from a hardware fingerprint. PushToken is the
/// current FCM/APNs token for that install; tokens rotate over the install's lifetime, which is why
/// re-registration replaces PushToken rather than inserting a new row.
///
/// (Platform, InstallationId) is globally unique (see UX_PushDeviceRegistrations_Platform_InstallationId),
/// not scoped per user: InstallationId identifies one physical app installation, and one app
/// installation can only ever be actively signed into one Juple user at a time - it must never
/// exist as an active, enabled row for two different users simultaneously. A second user
/// registering the same installation (an account switch on a shared/reused device) reassigns this
/// same row via ReassignOwner rather than creating a second one; see
/// PushDeviceRegistrationStore.RegisterAsync for how the DB constraint - not just this class -
/// enforces that even under concurrent registration calls.
///
/// PushToken is a secret-like value: never logged, never returned in full via any API response.
/// </summary>
public sealed class PushDeviceRegistration
{
    private PushDeviceRegistration()
    {
    }

    public PushDeviceRegistration(
        long userId,
        PushPlatform platform,
        string installationId,
        string pushToken,
        string locale,
        DateTimeOffset createdAtUtc,
        DateTimeOffset updatedAtUtc)
    {
        UserId = userId;
        Platform = platform;
        InstallationId = installationId;
        PushToken = pushToken;
        Locale = locale;
        IsEnabled = true;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = updatedAtUtc;
        LastSeenAtUtc = updatedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public PushPlatform Platform { get; private set; }

    public string InstallationId { get; private set; } = null!;

    public string PushToken { get; private set; } = null!;

    /// <summary>
    /// The app's currently-resolved UI language at registration time (e.g. "ko"/"en" - see Mobile's
    /// i18n/languagePreference.ts), never User.PreferredLocale. PreferredLocale is only the device
    /// OS locale captured once at bootstrap (see CurrentUserBootstrapService/getDeviceRegionalSettings)
    /// and can silently diverge from a user's own in-app language choice - Push text must reflect
    /// what the user actually sees in the app, so this field is the one push-text generation reads.
    /// </summary>
    public string Locale { get; private set; } = null!;

    public bool IsEnabled { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public DateTimeOffset LastSeenAtUtc { get; private set; }

    /// <summary>
    /// Re-registration for the same owning user and (Platform, InstallationId): refreshes the token
    /// (it may have rotated) and re-enables a previously-disabled registration - a reinstall or a
    /// fresh app launch after the user re-enabled OS notification permission is not a new device, it
    /// is this same install checking back in.
    /// </summary>
    public void Reregister(string pushToken, string locale, DateTimeOffset nowUtc)
    {
        PushToken = pushToken;
        Locale = locale;
        IsEnabled = true;
        UpdatedAtUtc = nowUtc;
        LastSeenAtUtc = nowUtc;
    }

    /// <summary>
    /// The same physical installation just signed in as a different Juple user (account switch on a
    /// shared/reused device, or a previous owner's logout never reached the server before someone
    /// else signed in) - transfers this exact row to the new owner rather than leaving a second,
    /// independent row for the same installation. Re-enables unconditionally: whichever user just
    /// registered is the one who should receive Push next, regardless of whether the previous owner
    /// had already disabled it.
    /// </summary>
    public void ReassignOwner(long userId, string pushToken, string locale, DateTimeOffset nowUtc)
    {
        UserId = userId;
        PushToken = pushToken;
        Locale = locale;
        IsEnabled = true;
        UpdatedAtUtc = nowUtc;
        LastSeenAtUtc = nowUtc;
    }

    /// <summary>Idempotent - disabling an already-disabled registration is a no-op. Called on logout (PushDeviceRegistrationStore.DisableAsync) and by the Push dispatch worker when a provider reports this token as permanently invalid (PushDeviceRegistrationStore.DisableByIdAsync; see PushSendFailureCodes.IsPermanent). The row is kept (not deleted) so a later re-login/re-registration is a simple Reregister/ReassignOwner.</summary>
    public void Disable(DateTimeOffset updatedAtUtc)
    {
        if (!IsEnabled)
        {
            return;
        }

        IsEnabled = false;
        UpdatedAtUtc = updatedAtUtc;
    }
}
