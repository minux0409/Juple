namespace Juple.Api.Configuration;

/// <summary>
/// Bound from the "CollectionUnlockGrant" configuration section. EncryptionKey is a Base64-encoded,
/// high-entropy 32-byte key used only to seal Collection unlock grants (see
/// CollectionUnlockTokenProtector) - its own secret with its own lifecycle, independent of
/// PublicCollectionCursor:EncryptionKey (never derived from it, never falling back to it). Rotating
/// it invalidates every outstanding unlock grant (people simply re-enter the password).
/// Must be supplied via user-secrets locally, explicit test configuration in tests, and
/// environment/Key Vault-backed configuration in deployed environments - never committed to
/// source. The API refuses to start without a valid one (see Program.cs).
/// </summary>
public sealed class CollectionUnlockGrantOptions
{
    public string EncryptionKey { get; set; } = string.Empty;
}
