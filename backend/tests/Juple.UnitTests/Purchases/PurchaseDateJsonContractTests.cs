using System.Text.Json;
using Juple.Api.Controllers;

namespace Juple.UnitTests.Purchases;

/// <summary>
/// Verifies the "YYYY-MM-DD" wire contract for PurchaseDate holds under the same
/// JsonSerializerOptions ASP.NET Core applies by default ([ApiController] uses camelCase property
/// naming and the built-in DateOnly converter) - without standing up a full HTTP test harness,
/// which this codebase does not otherwise use (see PurchasePersistenceIntegrationTests's DB-only
/// integration style).
/// </summary>
public sealed class PurchaseDateJsonContractTests
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [Fact]
    public void Serialize_PurchaseResponse_WritesPurchaseDateAsDateOnlyString()
    {
        var response = new PurchasesController.PurchaseResponse(
            1, null, "Product", new DateOnly(2026, 8, 15), null, null, null, null, null, null,
            DateTimeOffset.UtcNow);

        var json = JsonSerializer.Serialize(response, Options);

        Assert.Contains("\"purchaseDate\":\"2026-08-15\"", json);
    }

    [Fact]
    public void Deserialize_CreatePurchaseRequest_ParsesIsoDateString()
    {
        var json = """{"productName":"Product","purchaseDate":"2026-08-15"}""";

        var request = JsonSerializer.Deserialize<PurchasesController.CreatePurchaseRequest>(json, Options);

        Assert.Equal(new DateOnly(2026, 8, 15), request!.PurchaseDate);
    }

    [Fact]
    public void Deserialize_CreatePurchaseRequest_WhenPurchaseDateOmitted_LeavesItNull()
    {
        var json = """{"productName":"Product"}""";

        var request = JsonSerializer.Deserialize<PurchasesController.CreatePurchaseRequest>(json, Options);

        Assert.Null(request!.PurchaseDate);
    }

    [Fact]
    public void Deserialize_CreatePurchaseRequest_WhenPurchaseDateIsNotIsoFormat_Throws()
    {
        var json = """{"productName":"Product","purchaseDate":"08/15/2026"}""";

        Assert.Throws<JsonException>(
            () => JsonSerializer.Deserialize<PurchasesController.CreatePurchaseRequest>(json, Options));
    }
}
