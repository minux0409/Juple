using Juple.Domain.Items;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Purchases;

public sealed class RepeatPurchasePersistenceIntegrationTests : IAsyncLifetime
{
    private const string DefaultProductName = "Test Product";

    private JupleDbContext _dbContext = null!;
    private string _connectionString = null!;
    private long _userId;
    private long _itemId;

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run RepeatPurchase persistence " +
                "integration tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;

        var item = new Item(_userId, "https://shop.example/repeat-purchase-test", DateTimeOffset.UtcNow);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync();
        _itemId = item.Id;
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.Purchases WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.RepeatPurchases WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM users.Users WHERE Id = {_userId}");
        await _dbContext.DisposeAsync();
    }

    private RepeatPurchase NewRepeatPurchase(
        long? itemId,
        string productName = DefaultProductName,
        int intervalValue = 30,
        IntervalUnit intervalUnit = IntervalUnit.Day,
        DateOnly? nextPurchaseDate = null,
        bool isReminderEnabled = false,
        int reminderLeadDays = 0,
        bool isEnabled = true) =>
        new(
            _userId,
            itemId,
            productName,
            intervalValue,
            intervalUnit,
            nextPurchaseDate ?? new DateOnly(2026, 9, 30),
            isReminderEnabled,
            reminderLeadDays,
            isEnabled,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow);

    [Fact]
    public async Task Persistence_RoundTripsAllFields()
    {
        var createdAtUtc = DateTimeOffset.UtcNow;
        var updatedAtUtc = createdAtUtc.AddMinutes(5);
        var repeatPurchase = new RepeatPurchase(
            _userId,
            _itemId,
            "세럼 30ml",
            2,
            IntervalUnit.Week,
            new DateOnly(2026, 10, 1),
            true,
            3,
            true,
            createdAtUtc,
            updatedAtUtc);
        _dbContext.RepeatPurchases.Add(repeatPurchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var reloaded = await _dbContext.RepeatPurchases.AsNoTracking()
            .SingleAsync(rp => rp.Id == repeatPurchase.Id);

        Assert.Equal(_userId, reloaded.UserId);
        Assert.Equal(_itemId, reloaded.ItemId);
        Assert.Equal("세럼 30ml", reloaded.ProductName);
        Assert.Equal(2, reloaded.IntervalValue);
        Assert.Equal(IntervalUnit.Week, reloaded.IntervalUnit);
        Assert.Equal(new DateOnly(2026, 10, 1), reloaded.NextPurchaseDate);
        Assert.True(reloaded.IsReminderEnabled);
        Assert.Equal(3, reloaded.ReminderLeadDays);
        Assert.True(reloaded.IsEnabled);
        Assert.Equal(createdAtUtc, reloaded.CreatedAtUtc);
        Assert.Equal(updatedAtUtc, reloaded.UpdatedAtUtc);
        Assert.NotEmpty(reloaded.RowVersion);
    }

    [Fact]
    public async Task Persistence_WithNullItemId_Succeeds()
    {
        var repeatPurchase = NewRepeatPurchase(itemId: null, productName: "우산");
        _dbContext.RepeatPurchases.Add(repeatPurchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var reloaded = await _dbContext.RepeatPurchases.AsNoTracking()
            .SingleAsync(rp => rp.Id == repeatPurchase.Id);

        Assert.Null(reloaded.ItemId);
        Assert.Equal("우산", reloaded.ProductName);
    }

    [Theory]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public async Task Constraint_WhitespaceOnlyProductName_IsRejected(string whitespaceOnlyName)
    {
        var repeatPurchase = NewRepeatPurchase(itemId: null, productName: whitespaceOnlyName);
        _dbContext.RepeatPurchases.Add(repeatPurchase);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task Constraint_ProductNameNull_IsRejectedByDatabase()
    {
        // Bypasses the C# non-nullable constructor entirely to prove the database itself refuses a
        // NULL ProductName, mirroring Purchase's identical constraint test.
        await Assert.ThrowsAsync<SqlException>(() => _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO purchases.RepeatPurchases
                 (UserId, ProductName, IntervalValue, IntervalUnit, NextPurchaseDate,
                  IsReminderEnabled, ReminderLeadDays, IsEnabled, CreatedAtUtc, UpdatedAtUtc)
             VALUES
                 ({_userId}, NULL, 30, 0, {new DateOnly(2026, 9, 30)}, 0, 0, 1,
                  {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})
             """));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task Constraint_IntervalValueZeroOrNegative_IsRejected(int invalidIntervalValue)
    {
        var repeatPurchase = NewRepeatPurchase(itemId: null, intervalValue: invalidIntervalValue);
        _dbContext.RepeatPurchases.Add(repeatPurchase);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task Constraint_InvalidIntervalUnit_IsRejectedByDatabase()
    {
        // IntervalUnit only defines Day=0/Week=1/Month=2 - this proves the database itself blocks
        // any other tinyint value, not just the .NET enum type at compile time.
        await Assert.ThrowsAsync<SqlException>(() => _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO purchases.RepeatPurchases
                 (UserId, ProductName, IntervalValue, IntervalUnit, NextPurchaseDate,
                  IsReminderEnabled, ReminderLeadDays, IsEnabled, CreatedAtUtc, UpdatedAtUtc)
             VALUES
                 ({_userId}, {DefaultProductName}, 30, 99, {new DateOnly(2026, 9, 30)}, 0, 0, 1,
                  {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})
             """));
    }

    [Fact]
    public async Task Constraint_ReminderLeadDaysNegative_IsRejected()
    {
        var repeatPurchase = NewRepeatPurchase(itemId: null, reminderLeadDays: -1);
        _dbContext.RepeatPurchases.Add(repeatPurchase);

        await Assert.ThrowsAsync<DbUpdateException>(() => _dbContext.SaveChangesAsync());
    }

    [Fact]
    public async Task Constraint_ReminderLeadDaysZero_IsAccepted()
    {
        // "Remind me on the day itself" is a legitimate setting, not an edge case to reject.
        var repeatPurchase = NewRepeatPurchase(itemId: null, isReminderEnabled: true, reminderLeadDays: 0);
        _dbContext.RepeatPurchases.Add(repeatPurchase);

        await _dbContext.SaveChangesAsync();

        Assert.True(repeatPurchase.Id > 0);
    }

    [Fact]
    public async Task ItemDelete_RepeatPurchaseRowSurvivesWithItemIdSetNull()
    {
        var repeatPurchase = NewRepeatPurchase(_itemId, productName: "Snapshot Product");
        _dbContext.RepeatPurchases.Add(repeatPurchase);
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        // A raw DELETE against the Items row, exercising the FK's ON DELETE SET NULL directly at
        // the database level - not routed through any application Store, since this round has no
        // Application layer for Items/RepeatPurchases.
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.Items WHERE Id = {_itemId}");

        var reloaded = await _dbContext.RepeatPurchases.AsNoTracking()
            .SingleAsync(rp => rp.Id == repeatPurchase.Id);

        Assert.Null(reloaded.ItemId);
        // ProductName survives independently of the Item - the entire point of requiring it.
        Assert.Equal("Snapshot Product", reloaded.ProductName);
    }

    [Fact]
    public async Task RepeatPurchaseDelete_PurchaseRowSurvivesWithRepeatPurchaseIdSetNull()
    {
        var repeatPurchase = NewRepeatPurchase(_itemId);
        _dbContext.RepeatPurchases.Add(repeatPurchase);
        await _dbContext.SaveChangesAsync();

        var purchase = new Purchase(
            _userId, _itemId, new DateOnly(2026, 9, 1), "Logged Purchase", null, null, null, null, null, null,
            DateTimeOffset.UtcNow);
        _dbContext.Purchases.Add(purchase);
        await _dbContext.SaveChangesAsync();
        // Purchase.RepeatPurchaseId has no constructor/Update() setter yet in this commit (the
        // future "log a purchase" use case will own that write) - set it directly via the tracked
        // entry, the same technique EF itself uses to materialize a private-setter property.
        _dbContext.Entry(purchase).Property(nameof(Purchase.RepeatPurchaseId)).CurrentValue =
            repeatPurchase.Id;
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM purchases.RepeatPurchases WHERE Id = {repeatPurchase.Id}");

        var reloaded = await _dbContext.Purchases.AsNoTracking().SingleAsync(p => p.Id == purchase.Id);

        Assert.Null(reloaded.RepeatPurchaseId);
        Assert.Equal("Logged Purchase", reloaded.ProductName);
    }

    [Fact]
    public async Task ItemCanHaveMultipleRepeatPurchases()
    {
        var first = NewRepeatPurchase(_itemId, productName: "Variant A");
        var second = NewRepeatPurchase(_itemId, productName: "Variant B");
        _dbContext.RepeatPurchases.AddRange(first, second);

        // No (UserId, ItemId) uniqueness is enforced - a single Item may be tracked by more than
        // one independent repeat setting (e.g. two variants of the same product).
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var forItem = await _dbContext.RepeatPurchases
            .AsNoTracking()
            .Where(rp => rp.ItemId == _itemId)
            .Select(rp => rp.Id)
            .ToListAsync();

        Assert.Equal(2, forItem.Count);
        Assert.Contains(first.Id, forItem);
        Assert.Contains(second.Id, forItem);
    }

    [Fact]
    public void IndexModel_UserIdIsEnabledNextPurchaseDateId_ExistsForUpcomingScheduleQueries()
    {
        var entityType = _dbContext.Model.FindEntityType(typeof(RepeatPurchase))!;

        var index = entityType.GetIndexes().SingleOrDefault(
            i => i.GetDatabaseName() == "IX_RepeatPurchases_UserId_IsEnabled_NextPurchaseDate_Id");

        Assert.NotNull(index);
        Assert.Equal(
            new[] { "UserId", "IsEnabled", "NextPurchaseDate", "Id" },
            index!.Properties.Select(p => p.Name));
    }

    [Fact]
    public void IndexModel_RepeatPurchasesItemId_ExistsForItemScopedLookup()
    {
        var entityType = _dbContext.Model.FindEntityType(typeof(RepeatPurchase))!;

        var index = entityType.GetIndexes().SingleOrDefault(
            i => i.GetDatabaseName() == "IX_RepeatPurchases_ItemId");

        Assert.NotNull(index);
        Assert.Equal(new[] { "ItemId" }, index!.Properties.Select(p => p.Name));
    }

    [Fact]
    public void IndexModel_PurchasesRepeatPurchaseId_ExistsForRepeatPurchaseScopedLookup()
    {
        var entityType = _dbContext.Model.FindEntityType(typeof(Purchase))!;

        var index = entityType.GetIndexes().SingleOrDefault(
            i => i.GetDatabaseName() == "IX_Purchases_RepeatPurchaseId");

        Assert.NotNull(index);
        Assert.Equal(new[] { "RepeatPurchaseId" }, index!.Properties.Select(p => p.Name));
    }
}
