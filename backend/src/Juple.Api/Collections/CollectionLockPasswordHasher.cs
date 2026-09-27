using Juple.Application.Collections.Locking;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Juple.Api.Collections;

/// <summary>
/// Reuses ASP.NET Core Identity's PasswordHasher - the platform's vetted, versioned, salted
/// PBKDF2 implementation (V3 format: HMAC-SHA512, per-hash random salt, iteration count embedded in
/// the hash so it can be raised later without invalidating stored hashes; constant-time compare).
/// The iteration count is set explicitly rather than inherited so a framework default change never
/// silently weakens it. Only the resulting hash string is ever stored.
/// </summary>
public sealed class CollectionLockPasswordHasher : ICollectionLockPasswordHasher
{
    private const int IterationCount = 210_000;

    private static readonly object HashUser = new();

    private readonly PasswordHasher<object> _hasher = new(Options.Create(new PasswordHasherOptions
    {
        CompatibilityMode = PasswordHasherCompatibilityMode.IdentityV3,
        IterationCount = IterationCount,
    }));

    public string Hash(string password) => _hasher.HashPassword(HashUser, password);

    public bool Verify(string passwordHash, string password)
    {
        try
        {
            return _hasher.VerifyHashedPassword(HashUser, passwordHash, password) is
                PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
