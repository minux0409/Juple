namespace Juple.Api.Configuration;

/// <summary>
/// Bound from the "PublicCollectionCursor" configuration section. EncryptionKey is a Base64-encoded
/// AES-256 key used only to keep the anonymous Public API's pagination cursor (see
/// PublicCollectionItemPageCursorCodec) opaque and tamper-proof - it is not an authentication or
/// authorization secret. Losing or rotating it only makes in-flight "load more" cursors decode as
/// invalid (the Web Viewer simply has nothing further to load), never a security or data-loss
/// incident, so it does not need the durability guarantees a real signing/session key would.
/// Must be supplied via user-secrets locally or environment/Key Vault-backed configuration in
/// deployed environments - never committed to source. See Program.cs's startup check.
/// </summary>
public sealed class PublicCollectionCursorOptions
{
    public string EncryptionKey { get; set; } = string.Empty;
}
