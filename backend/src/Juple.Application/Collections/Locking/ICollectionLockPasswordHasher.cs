namespace Juple.Application.Collections.Locking;

/// <summary>Salted, slow, versioned password hashing for Collection locks (never a plain digest).</summary>
public interface ICollectionLockPasswordHasher
{
    string Hash(string password);

    bool Verify(string passwordHash, string password);
}
