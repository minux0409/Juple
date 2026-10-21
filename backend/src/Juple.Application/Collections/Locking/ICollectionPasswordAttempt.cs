namespace Juple.Application.Collections.Locking;

/// <summary>
/// A database reservation held from the throttle check through its committed result. Competing
/// attempts refuse immediately instead of all passing the check before the first hash completes.
/// No external HTTP is allowed inside this short, bounded password-only transaction.
/// </summary>
public interface ICollectionPasswordAttempt : IAsyncDisposable
{
    Task CommitAsync(CancellationToken cancellationToken);
}
