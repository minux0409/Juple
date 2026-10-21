using Juple.Application;
using Juple.Application.Collections.Locking;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Juple.Infrastructure.Collections;

internal sealed class CollectionPasswordAttempt(IDbContextTransaction transaction) : ICollectionPasswordAttempt
{
    public static async Task<ICollectionPasswordAttempt> BeginAsync(JupleDbContext context, FormattableString sql, CancellationToken cancellationToken)
    {
        var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // NOWAIT bounds contention to a refused request, not a connection-pool wait queue.
            await context.Database.ExecuteSqlInterpolatedAsync(sql, cancellationToken);
            return new CollectionPasswordAttempt(transaction);
        }
        catch (SqlException exception) when (exception.Number == 1222)
        {
            await transaction.DisposeAsync();
            throw new RequestCapacityExceededException();
        }
        catch
        {
            await transaction.DisposeAsync();
            throw;
        }
    }

    public Task CommitAsync(CancellationToken cancellationToken) => transaction.CommitAsync(cancellationToken);
    public ValueTask DisposeAsync() => transaction.DisposeAsync();
}
