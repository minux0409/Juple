using Juple.Application.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Storage;

namespace Juple.Infrastructure.Collections;

/// <summary>
/// ICollectionWriteTransactions on the request's own JupleDbContext: every store and the notification
/// publisher of the request save through that same context, so their writes join this transaction.
/// </summary>
public sealed class CollectionWriteTransactions(JupleDbContext dbContext) : ICollectionWriteTransactions
{
    public async Task<ICollectionWriteTransaction> BeginAsync(CancellationToken cancellationToken = default) =>
        new Transaction(await dbContext.Database.BeginTransactionAsync(cancellationToken), dbContext);

    private sealed class Transaction(IDbContextTransaction transaction, JupleDbContext dbContext) : ICollectionWriteTransaction
    {
        private bool _committed;

        public async Task CommitAsync(CancellationToken cancellationToken = default)
        {
            await transaction.CommitAsync(cancellationToken);
            _committed = true;
        }

        public async ValueTask DisposeAsync()
        {
            if (!_committed)
            {
                // Rolled back: nothing saved inside it exists any more, so nothing it saved may stay
                // tracked as if it did.
                dbContext.ChangeTracker.Clear();
            }

            await transaction.DisposeAsync();
        }
    }
}
