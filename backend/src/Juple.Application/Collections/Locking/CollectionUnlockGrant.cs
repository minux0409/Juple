namespace Juple.Application.Collections.Locking;

/// <summary>An opaque, short-lived unlock token and its expiry - never contains or reveals the password.</summary>
public sealed record CollectionUnlockGrant(string Token, DateTimeOffset ExpiresAtUtc);
