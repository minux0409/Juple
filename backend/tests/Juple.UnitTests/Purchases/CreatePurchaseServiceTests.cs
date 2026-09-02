using Juple.Application.Items;
using Juple.Application.Purchases;
using Juple.Application.Purchases.CreatePurchase;

namespace Juple.UnitTests.Purchases;

public sealed class CreatePurchaseServiceTests
{
    private static readonly DateOnly ValidDate = new(2026, 8, 15);
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 29, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task CreateAsync_TrimsProductNameOuterWhitespace()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(productName: "  Sunscreen  "));

        Assert.Equal("Sunscreen", store.LastFields!.ProductName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateAsync_WhenProductNameIsMissingOrWhitespaceOnly_ThrowsInvalidPurchase(string? productName)
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(productName: productName)));

        Assert.Equal("productName", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenProductNameExceeds500Characters_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(productName: new string('a', 501))));

        Assert.Equal("productName", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenProductNameIsExactly500Characters_Succeeds()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));
        var maxLengthName = new string('a', 500);

        await service.CreateAsync(17, Command(productName: maxLengthName));

        Assert.Equal(maxLengthName, store.LastFields!.ProductName);
    }

    [Fact]
    public async Task CreateAsync_WhenPurchaseDateIsMissing_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));
        var command = new CreatePurchaseCommand(
            null, "Product", null, null, null, null, null, null, null);

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, command));

        Assert.Equal("purchaseDate", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Theory]
    [InlineData("  store  ", "store")]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData(null, null)]
    public async Task CreateAsync_NormalizesStoreLikeATrimmedDisplayString(string? store, string? expected)
    {
        var fakeStore = new FakePurchaseStore();
        var service = new CreatePurchaseService(fakeStore, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(store: store));

        Assert.Equal(expected, fakeStore.LastFields!.Store);
    }

    [Fact]
    public async Task CreateAsync_WhenStoreExceeds200Characters_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(store: new string('a', 201))));

        Assert.Equal("store", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenVariantExceeds200Characters_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(variant: new string('a', 201))));

        Assert.Equal("variant", exception.Field);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    public async Task CreateAsync_WhenMemoIsNullOrEmpty_CollapsesToNull(string? memo, string? expected)
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(memo: memo));

        Assert.Equal(expected, store.LastFields!.Memo);
    }

    [Fact]
    public async Task CreateAsync_WhenMemoIsWhitespaceOnly_PreservesItVerbatim()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(memo: "  \n  "));

        Assert.Equal("  \n  ", store.LastFields!.Memo);
    }

    [Fact]
    public async Task CreateAsync_WhenMemoExceeds4000Characters_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(memo: new string('a', 4001))));

        Assert.Equal("memo", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenBothAmountAndCurrencyCodeNull_Succeeds()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(amount: null, currencyCode: null));

        Assert.Null(store.LastFields!.Amount);
        Assert.Null(store.LastFields.CurrencyCode);
    }

    [Fact]
    public async Task CreateAsync_WhenAmountProvidedWithoutCurrencyCode_ThrowsInvalidPurchaseOnCurrencyCode()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(amount: 1000m, currencyCode: null)));

        Assert.Equal("currencyCode", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenCurrencyCodeProvidedWithoutAmount_ThrowsInvalidPurchaseOnAmount()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(amount: null, currencyCode: "KRW")));

        Assert.Equal("amount", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenAmountIsNegative_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(amount: -0.01m, currencyCode: "KRW")));

        Assert.Equal("amount", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenAmountIsZero_Succeeds()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(amount: 0m, currencyCode: "KRW"));

        Assert.Equal(0m, store.LastFields!.Amount);
    }

    [Fact]
    public async Task CreateAsync_WhenAmountHasMoreThanFourDecimalPlaces_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(amount: 1.23456m, currencyCode: "KRW")));

        Assert.Equal("amount", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenAmountHasExactlyFourDecimalPlaces_Succeeds()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(amount: 19900.1234m, currencyCode: "KRW"));

        Assert.Equal(19900.1234m, store.LastFields!.Amount);
    }

    [Fact]
    public async Task CreateAsync_WhenAmountIsAtTheDecimal19_4Maximum_Succeeds()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));
        var max = 999_999_999_999_999.9999m;

        await service.CreateAsync(17, Command(amount: max, currencyCode: "KRW"));

        Assert.Equal(max, store.LastFields!.Amount);
    }

    [Fact]
    public async Task CreateAsync_WhenAmountExceedsTheDecimal19_4Maximum_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));
        var overMax = 1_000_000_000_000_000.0000m;

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(amount: overMax, currencyCode: "KRW")));

        Assert.Equal("amount", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Theory]
    [InlineData("krw", "KRW")]
    [InlineData("USD", "USD")]
    [InlineData(" jpy ", "JPY")]
    public async Task CreateAsync_NormalizesCurrencyCodeToUppercase(string input, string expected)
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(amount: 100m, currencyCode: input));

        Assert.Equal(expected, store.LastFields!.CurrencyCode);
    }

    [Theory]
    [InlineData("US")]
    [InlineData("USDD")]
    [InlineData("123")]
    [InlineData("US1")]
    public async Task CreateAsync_WhenCurrencyCodeIsNotThreeAsciiLetters_ThrowsInvalidPurchase(string currencyCode)
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(amount: 100m, currencyCode: currencyCode)));

        Assert.Equal("currencyCode", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenQuantityIsNull_Succeeds()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(quantity: null));

        Assert.Null(store.LastFields!.Quantity);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task CreateAsync_WhenQuantityIsZeroOrNegative_ThrowsInvalidPurchase(int quantity)
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(quantity: quantity)));

        Assert.Equal("quantity", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenQuantityHasMoreThanThreeDecimalPlaces_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(quantity: 1.2345m)));

        Assert.Equal("quantity", exception.Field);
    }

    [Fact]
    public async Task CreateAsync_WhenQuantityHasExactlyThreeDecimalPlaces_Succeeds()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(quantity: 2.5m));

        Assert.Equal(2.5m, store.LastFields!.Quantity);
    }

    [Fact]
    public async Task CreateAsync_WhenQuantityIsAtTheDecimal18_3Maximum_Succeeds()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));
        var max = 999_999_999_999_999.999m;

        await service.CreateAsync(17, Command(quantity: max));

        Assert.Equal(max, store.LastFields!.Quantity);
    }

    [Fact]
    public async Task CreateAsync_WhenQuantityExceedsTheDecimal18_3Maximum_ThrowsInvalidPurchase()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));
        var overMax = 1_000_000_000_000_000.000m;

        var exception = await Assert.ThrowsAsync<InvalidPurchaseException>(
            () => service.CreateAsync(17, Command(quantity: overMax)));

        Assert.Equal("quantity", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_PassesItemIdThroughUnvalidated_StoreIsResponsibleForOwnershipCheck()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command(itemId: 99));

        Assert.Equal(99, store.LastFields!.ItemId);
    }

    [Fact]
    public async Task CreateAsync_UsesTimeProviderForCreatedAtUtc_NotAnyClientInput()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command());

        Assert.Equal(FixedNow, store.LastCreatedAtUtc);
    }

    [Fact]
    public async Task CreateAsync_CallsStoreWithCurrentUser()
    {
        var store = new FakePurchaseStore();
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await service.CreateAsync(17, Command());

        Assert.Equal(17, store.LastUserId);
    }

    [Fact]
    public async Task CreateAsync_WhenItemIsNotOwnedByCurrentUser_PropagatesItemNotFoundException()
    {
        var store = new FakePurchaseStore { ThrowItemNotFound = true };
        var service = new CreatePurchaseService(store, new FakeTimeProvider(FixedNow));

        await Assert.ThrowsAsync<ItemNotFoundException>(
            () => service.CreateAsync(17, Command(itemId: 99)));
    }

    private static CreatePurchaseCommand Command(
        long? itemId = null,
        string? productName = "Product",
        DateOnly? purchaseDate = null,
        decimal? amount = null,
        string? currencyCode = null,
        string? store = null,
        string? variant = null,
        decimal? quantity = null,
        string? memo = null) =>
        new(
            itemId,
            productName,
            purchaseDate ?? ValidDate,
            amount,
            currencyCode,
            store,
            variant,
            quantity,
            memo);

    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FakePurchaseStore : IPurchaseStore
    {
        public bool ThrowItemNotFound { get; init; }

        public bool WasCreateCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public PurchaseFields? LastFields { get; private set; }

        public DateTimeOffset? LastCreatedAtUtc { get; private set; }

        public Task<PurchasePage> ListAsync(
            long userId, PurchasePageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult(new PurchasePage([], null));

        public Task<PurchaseDto?> GetAsync(
            long userId, long purchaseId, CancellationToken cancellationToken = default) =>
            Task.FromResult<PurchaseDto?>(null);

        public Task<PurchaseDto> CreateAsync(
            long userId,
            PurchaseFields fields,
            DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default)
        {
            WasCreateCalled = true;
            LastUserId = userId;
            LastFields = fields;
            LastCreatedAtUtc = createdAtUtc;

            if (ThrowItemNotFound)
            {
                throw new ItemNotFoundException();
            }

            return Task.FromResult(new PurchaseDto(
                1, fields.ItemId, fields.ProductName, fields.PurchaseDate, fields.Amount, fields.CurrencyCode,
                fields.Store, fields.Variant, fields.Quantity, fields.Memo, createdAtUtc));
        }

        public Task UpdateAsync(
            long userId, long purchaseId, PurchaseFields fields, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task DeleteAsync(long userId, long purchaseId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
