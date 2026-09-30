namespace Juple.Application.Collections;

/// <summary>
/// One database transaction around several Collection writes AND the notification (outbox) rows they
/// cause - both go through the same request-scoped database context, so they commit together or not
/// at all. Disposing it without CommitAsync rolls everything back. Only for an operation that spans
/// several store calls (e.g. 다른 컬렉션에 복제); a single store call keeps its own transaction. Never
/// run anything outside the database inside it (Push is sent later, by the dispatch Job).
/// </summary>
public interface ICollectionWriteTransactions
{
    Task<ICollectionWriteTransaction> BeginAsync(CancellationToken cancellationToken = default);
}

public interface ICollectionWriteTransaction : IAsyncDisposable
{
    Task CommitAsync(CancellationToken cancellationToken = default);
}
