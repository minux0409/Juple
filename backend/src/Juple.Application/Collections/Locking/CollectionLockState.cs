namespace Juple.Application.Collections.Locking;

/// <summary>
/// PasswordHash is the hash that currently opens this Collection: its Owner's lock password;
/// UsesOwnerPassword is false only for a Collection of an Owner who has no lock password yet, which
/// still opens with its legacy per-Collection password (see CollectionLockPasswordSource).
/// </summary>
public sealed record CollectionLockState(
    long CollectionId,
    bool IsLocked,
    string? PasswordHash,
    int LockVersion,
    bool UsesOwnerPassword = false);
