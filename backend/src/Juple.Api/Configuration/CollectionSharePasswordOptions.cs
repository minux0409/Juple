namespace Juple.Api.Configuration;

/// <summary>
/// Bound from the "CollectionSharePassword" configuration section. EncryptionKey is a Base64-encoded,
/// high-entropy 32-byte key used only to seal Collection share passwords so their Owner can see them
/// again (see CollectionSharePasswordProtector) - its own secret, independent of every other key
/// (never derived from, and never falling back to, the unlock-grant or cursor keys). KeyId is stamped
/// into every sealed password, but only one key is active at a time: there is no keyring of older
/// keys, so changing the key (or KeyId) leaves every earlier sealed password unreadable
/// (sharePasswordUnreadable - the Owner sets a new one). Required by the HTTP API only; the one-shot
/// Job modes never build anything that uses it (see Program.cs).
/// Must be supplied via user-secrets locally, explicit test configuration in tests, and
/// environment/Key Vault-backed configuration in deployed environments (a different key per
/// environment) - never committed to source. The API refuses to start without a valid one.
/// </summary>
public sealed class CollectionSharePasswordOptions
{
    public string EncryptionKey { get; set; } = string.Empty;

    public byte KeyId { get; set; } = 1;
}
