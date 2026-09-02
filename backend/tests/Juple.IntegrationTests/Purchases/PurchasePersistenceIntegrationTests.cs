using Juple.Domain.Items;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Purchases;

public sealed class PurchasePersistenceIntegrationTests : IAsyncLifetime
{
    private const string DefaultProductName = "Test Product";

    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _otherUserId;
    private long _itemId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run Purchase persistence integration " +
                "tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var otherUser = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.AddRange(user, otherUser);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _otherUserId = otherUser.Id;

        var item = new Item(_userId, "https://shop.example/purchase-test", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync();
        _itemId = item.Id;
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.Purchases WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId} OR UserId = {_otherUserId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId} OR Id = {_otherUserId}");
        await _dbContext.DisposeAsync();
    }

    [Fact]
    public async Task Persistence_RoundTripsAllFields()
    {
        var createdAtUtc = DateTimeOffset.UtcNow;
        var purchase = new Purchase(
            _userId,
            _itemId,
            new DateOnly(2026, 8, 15),
            "선크림 250ml",
            19_900.1234m,
            "KRW",
            "Coupang",
            "250ml / Blue",
            2.5m,
            "재구매 예정",
            createdAtUtc);
        _dbContext.Purchases.Add(purchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var reloaded = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == purchase.Id);

        Assert.Equal(_userId, reloaded.UserId);
        Assert.Equal(_itemId, reloaded.ItemId);
        Assert.Equal(new DateOnly(2026, 8, 15), reloaded.PurchaseDate);
        Assert.Equal("선크림 250ml", reloaded.ProductName);
        Assert.Equal(19_900.1234m, reloaded.Amount);
        Assert.Equal("KRW", reloaded.CurrencyCode);
        Assert.Equal("Coupang", reloaded.Store);
        Assert.Equal("250ml / Blue", reloaded.Variant);
        Assert.Equal(2.5m, reloaded.Quantity);
        Assert.Equal("재구매 예정", reloaded.Memo);
        Assert.Equal(createdAtUtc, reloaded.CreatedAtUtc);
    }

    [Fact]
    public async Task Persistence_UserIdColumn_ScopesOwnership()
    {
        var mine = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        var theirs = new Purchase(
            _otherUserId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.AddRange(mine, theirs);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var myPurchases = await _dbContext.Purchases
            .AsNoTracking()
            .Where(p => p.UserId == _userId && (p.Id == mine.Id || p.Id == theirs.Id))
            .ToListAsync();

        Assert.Single(myPurchases);
        Assert.Equal(mine.Id, myPurchases[0].Id);
    }

    [Fact]
    public async Task Persistence_WithNullItemId_Succeeds()
    {
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), "우산", null, null, "오프라인 매장", null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var reloaded = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == purchase.Id);

        Assert.Null(reloaded.ItemId);
        Assert.Equal("우산", reloaded.ProductName);
    }

    [Fact]
    public async Task ItemDelete_PurchaseRowSurvivesWithProductNameAndItemIdSetNull()
    {
        var purchase = new Purchase(
            _userId, _itemId, new DateOnly(2026, 8, 1), "Snapshot Product", 10_000m, "KRW", "Store", null, 1m,
            null, DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        // A raw DELETE against the Items row, exercising the FK's ON DELETE SET NULL directly at
        // the database level - not routed through any application Store, since this round has no
        // Application layer for Purchases yet.
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE Id = {_itemId}");

        var reloaded = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == purchase.Id);

        Assert.Null(reloaded.ItemId);
        // ProductName survives independently of the Item - this is the entire point of it being a
        // required field rather than something read dynamically off the (possibly-gone) Item.
        Assert.Equal("Snapshot Product", reloaded.ProductName);
        Assert.Equal(10_000m, reloaded.Amount);
    }

    [Fact]
    public async Task DecimalPrecision_Amount_PreservesFourDecimalPlaces()
    {
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, 1_234.5678m, "USD", null, null, null,
            null, DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var reloaded = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == purchase.Id);

        Assert.Equal(1_234.5678m, reloaded.Amount);
    }

    [Fact]
    public async Task DecimalPrecision_Quantity_PreservesFractionalUnits()
    {
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, null, null, null, 0.5m, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var reloaded = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == purchase.Id);

        Assert.Equal(0.5m, reloaded.Quantity);
    }

    [Fact]
    public async Task Constraint_NegativeAmount_IsRejected()
    {
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, -1m, "KRW", null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task Constraint_ZeroAmount_IsAccepted()
    {
        // A free/fully-discounted item is a legitimate purchase record.
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, 0m, "KRW", null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);

        await _dbContext.SaveChangesAsync();

        Assert.True(purchase.Id > 0);
    }

    [Fact]
    public async Task Constraint_ZeroOrNegativeQuantity_IsRejected()
    {
        var zeroQuantity = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, null, null, null, 0m, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(zeroQuantity);
        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
        _dbContext.ChangeTracker.Clear();

        var negativeQuantity = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, null, null, null, -1m, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(negativeQuantity);
        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task Constraint_AmountWithoutCurrencyCode_IsRejected()
    {
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, 1_000m, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task Constraint_CurrencyCodeWithoutAmount_IsRejected()
    {
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, "KRW", null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task Constraint_BothAmountAndCurrencyCodeNull_IsAccepted()
    {
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);

        await _dbContext.SaveChangesAsync();

        Assert.True(purchase.Id > 0);
    }

    [Theory]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public async Task Constraint_WhitespaceOnlyProductName_IsRejected(string whitespaceOnlyName)
    {
        var purchase = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), whitespaceOnlyName, null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task Constraint_ProductNameNull_IsRejectedByDatabase()
    {
        // Bypasses the C# non-nullable constructor entirely to prove the database itself - not
        // just the compiler - refuses a NULL ProductName. ExecuteSqlInterpolatedAsync runs outside
        // SaveChanges' pipeline, so the provider's own exception surfaces unwrapped.
        await Assert.ThrowsAsync<SqlException>(() => _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO purchases.Purchases (UserId, PurchaseDate, ProductName, CreatedAtUtc)
             VALUES ({_userId}, {new DateOnly(2026, 8, 1)}, NULL, {DateTimeOffset.UtcNow})
             """));
    }

    [Fact]
    public void IndexModel_UserIdPurchaseDateId_ExistsForLatestFirstHistoryQueries()
    {
        var entityType = _dbContext.Model.FindEntityType(typeof(Purchase))!;

        var index = entityType.GetIndexes().SingleOrDefault(
            i => i.GetDatabaseName() == "IX_Purchases_UserId_PurchaseDate_Id");

        Assert.NotNull(index);
        Assert.Equal(
            new[] { "UserId", "PurchaseDate", "Id" },
            index!.Properties.Select(p => p.Name));
    }

    [Fact]
    public async Task Query_OrderedByPurchaseDateDescendingThenIdDescending_MatchesLatestFirstHistoryOrder()
    {
        var older = new Purchase(
            _userId, null, new DateOnly(2026, 7, 1), DefaultProductName, null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        var newer = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        var newestSameDayFirst = new Purchase(
            _userId, null, new DateOnly(2026, 8, 1), DefaultProductName, null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.AddRange(older, newer, newestSameDayFirst);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var ordered = await _dbContext.Purchases
            .AsNoTracking()
            .Where(p => p.UserId == _userId)
            .OrderByDescending(p => p.PurchaseDate)
            .ThenByDescending(p => p.Id)
            .Select(p => p.Id)
            .ToListAsync();

        Assert.Equal([newestSameDayFirst.Id, newer.Id, older.Id], ordered);
    }
}
