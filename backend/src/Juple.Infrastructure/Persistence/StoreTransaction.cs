using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;

namespace Juple.Infrastructure.Persistence;

/// <summary>
/// A store's own transaction - or, when the request already has one open on the same context (a
/// notification outbox scope - see SocialNotificationPublisher.BeginAtomicScopeAsync, or
/// CollectionWriteTransactions), a part of that one. Owned: exactly an EF transaction. Joined: Commit
/// is left to the owner, so the store's writes and the outbox events it causes commit together; a
/// partial rollback cannot be expressed inside someone else's transaction, so RollbackAsync throws and
/// the whole owning transaction rolls back instead of silently keeping half of the work.
/// </summary>
public sealed class StoreTransaction : IAsyncDisposable
{
    private readonly IDbContextTransaction? _owned;

    private StoreTransaction(IDbContextTransaction? owned)
    {
        _owned = owned;
    }

    public bool IsJoined => _owned is null;

    public static async Task<StoreTransaction> BeginOrJoinAsync(DatabaseFacade database, CancellationToken cancellationToken = default) =>
        database.CurrentTransaction is null
            ? new StoreTransaction(await database.BeginTransactionAsync(cancellationToken))
            : new StoreTransaction(null);

    public Task CommitAsync(CancellationToken cancellationToken = default) =>
        _owned?.CommitAsync(cancellationToken) ?? Task.CompletedTask;

    public Task RollbackAsync(CancellationToken cancellationToken = default) =>
        _owned?.RollbackAsync(cancellationToken)
        ?? throw new InvalidOperationException("A store cannot roll back part of a transaction it joined; the owning transaction must roll back.");

    public ValueTask DisposeAsync() => _owned?.DisposeAsync() ?? ValueTask.CompletedTask;
}

public static class StoreTransactionExtensions
{
    public static Task<StoreTransaction> BeginOrJoinTransactionAsync(this DatabaseFacade database, CancellationToken cancellationToken = default) =>
        StoreTransaction.BeginOrJoinAsync(database, cancellationToken);
}
