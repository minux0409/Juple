using Juple.Application.Items;
using Juple.Application.Purchases;
using Juple.Domain.Purchases;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Purchases;

public sealed class PurchaseStore(JupleDbContext dbContext) : IPurchaseStore
{
    // Purchases has no long-running I/O between the ownership check and the write, so rather than
    // holding a transaction/lock across that window, a same-user concurrent Item delete racing the
    // check is instead caught here as the FK violation it produces at save time and translated to
    // the same ItemNotFoundException the check itself would have thrown had it lost the race -
    // this keeps the outward 404 semantics identical either way and never lets a raw
    // DbUpdateException/SqlException reach the API as a 500. Item's own delete semantics
    // (ON DELETE SET NULL for already-persisted Purchases) are unaffected - this only concerns a
    // Purchase write that is still in flight when the race happens.
    private const string ItemForeignKeyConstraintName = "FK_Purchases_Items_ItemId";

    public async Task<PurchasePage> ListAsync(
        long userId,
        PurchasePageCursor? cursor,
        int limit,
        long? itemId = null,
        CancellationToken cancellationToken = default)
    {
        await EnsureItemOwnedIfProvidedAsync(userId, itemId, cancellationToken);

        var purchasesQuery = dbContext.Purchases
            .AsNoTracking()
            .Where(purchase => purchase.UserId == userId);

        if (itemId is not null)
        {
            purchasesQuery = purchasesQuery.Where(purchase => purchase.ItemId == itemId);
        }

        if (cursor is not null)
        {
            purchasesQuery = purchasesQuery.Where(purchase =>
                purchase.PurchaseDate < cursor.PurchaseDate
                || (purchase.PurchaseDate == cursor.PurchaseDate && purchase.Id < cursor.Id));
        }

        var pagedQuery = purchasesQuery
            .OrderByDescending(purchase => purchase.PurchaseDate)
            .ThenByDescending(purchase => purchase.Id)
            .Select(purchase => new PurchaseDto(
                purchase.Id,
                purchase.ItemId,
                purchase.ProductName,
                purchase.PurchaseDate,
                purchase.Amount,
                purchase.CurrencyCode,
                purchase.Store,
                purchase.Variant,
                purchase.Quantity,
                purchase.Memo,
                purchase.CreatedAtUtc));

        var page = await pagedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;

        var nextCursor = hasMore
            ? new PurchasePageCursor(pageRows[^1].PurchaseDate, pageRows[^1].Id)
            : null;

        return new PurchasePage(pageRows, nextCursor);
    }

    public Task<PurchaseDto?> GetAsync(
        long userId,
        long purchaseId,
        CancellationToken cancellationToken = default) =>
        dbContext.Purchases
            .AsNoTracking()
            .Where(purchase => purchase.Id == purchaseId && purchase.UserId == userId)
            .Select(purchase => new PurchaseDto(
                purchase.Id,
                purchase.ItemId,
                purchase.ProductName,
                purchase.PurchaseDate,
                purchase.Amount,
                purchase.CurrencyCode,
                purchase.Store,
                purchase.Variant,
                purchase.Quantity,
                purchase.Memo,
                purchase.CreatedAtUtc))
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<PurchaseDto> CreateAsync(
        long userId,
        PurchaseFields fields,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default)
    {
        await EnsureItemOwnedIfProvidedAsync(userId, fields.ItemId, cancellationToken);

        var purchase = new Purchase(
            userId,
            fields.ItemId,
            fields.PurchaseDate,
            fields.ProductName,
            fields.Amount,
            fields.CurrencyCode,
            fields.Store,
            fields.Variant,
            fields.Quantity,
            fields.Memo,
            createdAtUtc);
        dbContext.Purchases.Add(purchase);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerForeignKeyViolationDetector.IsForeignKeyViolation(exception, ItemForeignKeyConstraintName))
        {
            throw new ItemNotFoundException();
        }

        return new PurchaseDto(
            purchase.Id,
            purchase.ItemId,
            purchase.ProductName,
            purchase.PurchaseDate,
            purchase.Amount,
            purchase.CurrencyCode,
            purchase.Store,
            purchase.Variant,
            purchase.Quantity,
            purchase.Memo,
            purchase.CreatedAtUtc);
    }

    public async Task UpdateAsync(
        long userId,
        long purchaseId,
        PurchaseFields fields,
        CancellationToken cancellationToken = default)
    {
        var purchase = await dbContext.Purchases
            .FirstOrDefaultAsync(purchase => purchase.Id == purchaseId && purchase.UserId == userId, cancellationToken);
        if (purchase is null)
        {
            throw new PurchaseNotFoundException();
        }

        await EnsureItemOwnedIfProvidedAsync(userId, fields.ItemId, cancellationToken);

        purchase.Update(
            fields.ItemId,
            fields.PurchaseDate,
            fields.ProductName,
            fields.Amount,
            fields.CurrencyCode,
            fields.Store,
            fields.Variant,
            fields.Quantity,
            fields.Memo);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerForeignKeyViolationDetector.IsForeignKeyViolation(exception, ItemForeignKeyConstraintName))
        {
            throw new ItemNotFoundException();
        }
    }

    public async Task DeleteAsync(
        long userId,
        long purchaseId,
        CancellationToken cancellationToken = default)
    {
        var purchase = await dbContext.Purchases
            .FirstOrDefaultAsync(purchase => purchase.Id == purchaseId && purchase.UserId == userId, cancellationToken);
        if (purchase is null)
        {
            return;
        }

        dbContext.Purchases.Remove(purchase);

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    // Cross-module ownership check for the Items/Purchases boundary - mirrors
    // ItemStore.AssignCategoryAsync's identical check against Categories, including reusing that
    // other module's own NotFoundException type rather than inventing a Purchases-specific one.
    private async Task EnsureItemOwnedIfProvidedAsync(
        long userId,
        long? itemId,
        CancellationToken cancellationToken)
    {
        if (itemId is not { } requestedItemId)
        {
            return;
        }

        var itemIsOwnedByUser = await dbContext.Items
            .AsNoTracking()
            .AnyAsync(item => item.Id == requestedItemId && item.UserId == userId, cancellationToken);
        if (!itemIsOwnedByUser)
        {
            throw new ItemNotFoundException();
        }
    }
}
