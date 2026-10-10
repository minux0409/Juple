using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Billing;

public sealed class GoogleBillingStore(JupleDbContext dbContext) : IGoogleBillingStore
{
    private const int MaxUpsertAttempts = 5;

    public async Task EnsureAccountLinkAsync(long userId, string accountKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (await dbContext.GoogleAccountLinks.AsNoTracking().AnyAsync(link => link.UserId == userId, cancellationToken))
        {
            return;
        }

        dbContext.GoogleAccountLinks.Add(new GoogleAccountLink(userId, accountKey, nowUtc));
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent call for the same account won: the link exists.
            dbContext.ChangeTracker.Clear();
            if (!await dbContext.GoogleAccountLinks.AsNoTracking().AnyAsync(link => link.UserId == userId, cancellationToken))
            {
                throw;
            }
        }
    }

    public Task<long?> FindUserIdByAccountKeyAsync(string accountKey, CancellationToken cancellationToken = default) =>
        dbContext.GoogleAccountLinks.AsNoTracking()
            .Where(link => link.AccountKey == accountKey)
            .Select(link => (long?)link.UserId)
            .FirstOrDefaultAsync(cancellationToken);

    public Task<StorePurchaseRecord?> FindPurchaseAsync(byte[] externalKeyHash, CancellationToken cancellationToken = default) =>
        dbContext.StorePurchases.AsNoTracking()
            .Where(purchase => purchase.Source == StoreSource.GooglePlay && purchase.ExternalKeyHash == externalKeyHash)
            .Select(ToRecord)
            .FirstOrDefaultAsync(cancellationToken);

    public Task<StorePurchaseRecord?> FindPurchaseAsync(long purchaseId, CancellationToken cancellationToken = default) =>
        dbContext.StorePurchases.AsNoTracking()
            .Where(purchase => purchase.Id == purchaseId)
            .Select(ToRecord)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<StorePurchaseRecord>> ListPurchasesForUserAsync(long userId, CancellationToken cancellationToken = default) =>
        await dbContext.StorePurchases.AsNoTracking()
            .Where(purchase => purchase.UserId == userId)
            .Select(ToRecord)
            .ToListAsync(cancellationToken);

    public async Task<StorePurchaseRecord> UpsertPurchaseAsync(UpsertPurchaseCommand command, CancellationToken cancellationToken = default)
    {
        for (var attempt = 1; ; attempt++)
        {
            dbContext.ChangeTracker.Clear();
            var purchase = await dbContext.StorePurchases.SingleOrDefaultAsync(
                entry => entry.Source == StoreSource.GooglePlay && entry.ExternalKeyHash == command.ExternalKeyHash, cancellationToken);

            if (purchase is null)
            {
                purchase = new StorePurchase(command.UserId, StoreSource.GooglePlay, command.ProductId, command.ExternalKeyHash, command.EncryptedToken, command.NowUtc);
                dbContext.StorePurchases.Add(purchase);
            }
            else if (command.UserId is { } requester && purchase.UserId != requester)
            {
                if (purchase.UserId is null && command.AllowClaimDetached)
                {
                    purchase.LinkTo(requester, command.NowUtc);
                }
                else
                {
                    throw new StorePurchaseOwnershipConflictException();
                }
            }

            purchase.RestoreVerificationHandle(command.EncryptedToken);
            purchase.ApplyVerified(command.Normalized, command.BasePlanId, command.PeriodStartUtc, command.NowUtc);

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                return ToRecordCompiled(purchase);
            }
            catch (Exception exception) when (attempt < MaxUpsertAttempts
                && (exception is DbUpdateConcurrencyException
                    || (exception is DbUpdateException update && SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(update))))
            {
                // A concurrent call inserted or updated the same purchase: reload and re-apply (the ownership rule runs again).
            }
        }
    }

    public async Task MarkAcknowledgedAsync(long purchaseId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        await dbContext.StorePurchases
            .Where(purchase => purchase.Id == purchaseId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(purchase => purchase.AcknowledgementPending, false)
                    .SetProperty(purchase => purchase.AcknowledgedAtUtc, purchase => purchase.AcknowledgedAtUtc ?? nowUtc)
                    .SetProperty(purchase => purchase.UpdatedAtUtc, nowUtc),
                cancellationToken);

    public async Task<StoreEventInsertResult> TryInsertEventAsync(StoreEvent storeEvent, CancellationToken cancellationToken = default)
    {
        dbContext.StoreEvents.Add(storeEvent);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return new StoreEventInsertResult(storeEvent.Id, IsNew: true);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            dbContext.ChangeTracker.Clear();
            var existing = await dbContext.StoreEvents.AsNoTracking()
                .Where(entry => entry.Source == storeEvent.Source && entry.ExternalEventId == storeEvent.ExternalEventId)
                .Select(entry => (long?)entry.Id)
                .FirstOrDefaultAsync(cancellationToken);
            return existing is { } id ? new StoreEventInsertResult(id, IsNew: false) : throw exception;
        }
    }

    public async Task MarkEventDispatchedAsync(long eventId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        await dbContext.StoreEvents
            .Where(entry => entry.Id == eventId && entry.DispatchedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.DispatchedAtUtc, nowUtc), cancellationToken);

    public async Task<StoreEventWork?> ClaimEventAsync(long eventId, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default)
    {
        var leaseUntil = nowUtc + lease;
        var claimed = await dbContext.StoreEvents
            .Where(entry => entry.Id == eventId && entry.ProcessedAtUtc == null && entry.NextAttemptAtUtc <= nowUtc)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.NextAttemptAtUtc, leaseUntil), cancellationToken);
        if (claimed == 0)
        {
            return null;
        }

        return await dbContext.StoreEvents.AsNoTracking()
            .Where(entry => entry.Id == eventId)
            .Select(entry => new StoreEventWork(entry.Id, entry.EventType, entry.TokenHash, entry.EncryptedToken, entry.AttemptCount))
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<long>> ListDueEventIdsAsync(DateTimeOffset nowUtc, int limit, CancellationToken cancellationToken = default) =>
        await dbContext.StoreEvents.AsNoTracking()
            .Where(entry => entry.ProcessedAtUtc == null && entry.NextAttemptAtUtc <= nowUtc)
            .OrderBy(entry => entry.NextAttemptAtUtc)
            .Select(entry => entry.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);

    public async Task CompleteEventAsync(long eventId, StoreEventResult result, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        dbContext.ChangeTracker.Clear();
        var storeEvent = await dbContext.StoreEvents.SingleAsync(entry => entry.Id == eventId, cancellationToken);
        storeEvent.Complete(result, nowUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task FailEventAsync(long eventId, string errorCode, DateTimeOffset nextAttemptAtUtc, bool permanent, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        dbContext.ChangeTracker.Clear();
        var storeEvent = await dbContext.StoreEvents.SingleAsync(entry => entry.Id == eventId, cancellationToken);
        storeEvent.Fail(errorCode, nextAttemptAtUtc, permanent, nowUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<long>> ClaimDuePurchaseIdsAsync(DateTimeOffset nowUtc, TimeSpan lease, int limit, CancellationToken cancellationToken = default)
    {
        var due = await dbContext.StorePurchases.AsNoTracking()
            .Where(purchase => purchase.NextReconcileAtUtc <= nowUtc && purchase.VerificationHandleEncrypted != null)
            .OrderBy(purchase => purchase.NextReconcileAtUtc)
            .Select(purchase => new { purchase.Id, purchase.NextReconcileAtUtc })
            .Take(limit)
            .ToListAsync(cancellationToken);

        var claimed = new List<long>(due.Count);
        var leaseUntil = nowUtc + lease;
        foreach (var candidate in due)
        {
            // Compare-and-set on the value that made it due: a second runner that read the same row loses.
            var updated = await dbContext.StorePurchases
                .Where(purchase => purchase.Id == candidate.Id && purchase.NextReconcileAtUtc == candidate.NextReconcileAtUtc)
                .ExecuteUpdateAsync(setters => setters.SetProperty(purchase => purchase.NextReconcileAtUtc, leaseUntil), cancellationToken);
            if (updated == 1)
            {
                claimed.Add(candidate.Id);
            }
        }

        return claimed;
    }

    private static readonly System.Linq.Expressions.Expression<Func<StorePurchase, StorePurchaseRecord>> ToRecord = purchase => new StorePurchaseRecord(
        purchase.Id,
        purchase.UserId,
        purchase.ProductId,
        purchase.State,
        purchase.Reason,
        purchase.AccessEndsAtUtc,
        purchase.VerificationHandleEncrypted,
        purchase.AcknowledgementPending);

    private static readonly Func<StorePurchase, StorePurchaseRecord> ToRecordCompiled = ToRecord.Compile();
}
