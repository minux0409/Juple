using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Core;
using Juple.Application.Expenses;

namespace Juple.Infrastructure.Expenses;

/// <summary>ARM read-only Query API, using the existing Azure credential chain; no credential or ARM URL is accepted from a browser.</summary>
public sealed class AzureExpenseSource(HttpClient http, TokenCredential credential) : IAzureExpenseSource, IAzureCostDetailsSource
{
    public const string ApiVersion = "2025-03-01";
    public async Task<IReadOnlyList<AzureExpenseCost>> QueryAsync(ExpenseAzureScope scope, DateOnly month, CancellationToken ct)
        => await QueryDimensionAsync(scope, month, "ServiceName", ct);
    private async Task<IReadOnlyList<AzureExpenseCost>> QueryDimensionAsync(ExpenseAzureScope scope, DateOnly month, string dimension, CancellationToken ct)
    {
        ExpenseRules.ValidateScope(scope);
        var path = $"{scope.Scope}/providers/Microsoft.CostManagement/query";
        var url = new Uri($"https://management.azure.com{path}?api-version={ApiVersion}");
        var from = month.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var through = month.AddMonths(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddTicks(-1);
        var body = new { type = "ActualCost", timeframe = "Custom", timePeriod = new { from, to = through }, dataset = new {
            granularity = "Daily", aggregation = new { totalCost = new { name = "PreTaxCost", function = "Sum" } },
            grouping = new[] { new { type = "Dimension", name = dimension } } } };
        var rows = new List<AzureExpenseCost>();
        for (var page = 0; page < 20; page++)
        {
            using var response = await SendAsync(url, body, ct);
            if (response.StatusCode == HttpStatusCode.NoContent) return rows;
            var length = response.Content.Headers.ContentLength;
            if (length > 8 * 1024 * 1024) Invalid();
            // Bounded even for chunked or dishonest Content-Length responses.
            await using var input = await response.Content.ReadAsStreamAsync(ct);
            using var copy = new MemoryStream(); var buffer = new byte[16 * 1024]; int read;
            while ((read = await input.ReadAsync(buffer, ct)) > 0)
            { if (copy.Length + read > 8 * 1024 * 1024) Invalid(); await copy.WriteAsync(buffer.AsMemory(0, read), ct); }
            using var json = JsonDocument.Parse(copy.ToArray(), new JsonDocumentOptions { MaxDepth = 32 });
            var properties = json.RootElement.GetProperty("properties");
            rows.AddRange(Parse(properties, dimension));
            if (rows.Count > 20_000) Invalid();
            if (!properties.TryGetProperty("nextLink", out var link) || link.ValueKind == JsonValueKind.Null || string.IsNullOrEmpty(link.GetString())) return rows;
            var next = new Uri(link.GetString()!, UriKind.Absolute);
            // Never send an ARM bearer token to an arbitrary nextLink host/path, including a different cost scope.
            if (next.Scheme != "https" || next.Host != "management.azure.com" || !next.IsDefaultPort || !string.IsNullOrEmpty(next.UserInfo)
                || !next.AbsolutePath.Equals(path, StringComparison.OrdinalIgnoreCase) || !string.IsNullOrEmpty(next.Fragment)) Invalid();
            url = next;
        }
        Invalid(); return rows;
    }
    private async Task<HttpResponseMessage> SendAsync(Uri url, object body, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            var token = await credential.GetTokenAsync(new TokenRequestContext(["https://management.azure.com/.default"]), ct);
            using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
            var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (response.IsSuccessStatusCode) return response;
            var status = response.StatusCode;
            if (attempt < 2 && status is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable)
            {
                var delay = response.Headers.RetryAfter?.Delta
                    ?? (response.Headers.RetryAfter?.Date is { } retryAt ? retryAt - DateTimeOffset.UtcNow : TimeSpan.FromSeconds(2 * (attempt + 1)));
                if (response.Headers.TryGetValues("x-ms-ratelimit-microsoft.consumption-retry-after", out var delays)
                    && int.TryParse(delays.FirstOrDefault(), out var seconds)) delay = TimeSpan.FromSeconds(seconds);
                response.Dispose();
                // Do not retry earlier than Azure asked just to fit our interactive request budget.
                if (delay > TimeSpan.FromSeconds(30)) throw new ExpenseRequestException("azureCostThrottled", "Azure requested a longer retry delay. Retry synchronization later.");
                await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(delay.TotalSeconds, 1, 30)), ct); continue;
            }
            response.Dispose();
            throw new ExpenseRequestException(status is HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized ? "azureCostAccessDenied"
                : status == HttpStatusCode.TooManyRequests ? "azureCostThrottled" : "azureCostUnavailable", "Azure cost query did not succeed. Check the configured identity, scope or retry later.");
        }
    }
    public static IReadOnlyList<AzureExpenseCost> Parse(JsonElement properties, string dimension = "ServiceName")
    {
        var names = properties.GetProperty("columns").EnumerateArray().Select(column => column.GetProperty("name").GetString()).ToList();
        var amountIndex = names.IndexOf("PreTaxCost"); if (amountIndex < 0) amountIndex = names.IndexOf("Cost");
        var dateIndex = names.IndexOf("UsageDate"); var serviceIndex = names.IndexOf(dimension); var currencyIndex = names.IndexOf("Currency");
        if (new[] { amountIndex, dateIndex, serviceIndex, currencyIndex }.Any(index => index < 0)) Invalid();
        var result = new List<AzureExpenseCost>();
        foreach (var row in properties.GetProperty("rows").EnumerateArray())
        {
            if (row.GetArrayLength() != names.Count) Invalid();
            if (!row[amountIndex].TryGetDecimal(out var amount)) Invalid();
            if (!DateOnly.TryParseExact(row[dateIndex].ToString(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) Invalid();
            var service = row[serviceIndex].ValueKind == JsonValueKind.Null ? "Unattributed Azure charge" : row[serviceIndex].GetString();
            var currency = row[currencyIndex].GetString();
            if (string.IsNullOrWhiteSpace(service) || service.Length > (dimension == "ResourceId" ? 2048 : 200)) Invalid();
            ExpenseRules.Currency(currency);
            result.Add(new AzureExpenseCost(date, service!, currency!, amount, row[amountIndex].GetRawText()));
        }
        return result;
    }
    public async Task<AzureCostDetail> ResourcesAsync(ExpenseAzureScope scope, DateOnly month, CancellationToken ct)
    {
        try {
            var rows = await QueryDimensionAsync(scope, month, "ResourceId", ct);
            return new("available", rows.Select(x => new AzureCostPoint(x.Date, x.ServiceName, x.Currency, x.Amount)).ToArray());
        }
        catch (Exception e) when (e is ExpenseRequestException or HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException or Azure.Identity.AuthenticationFailedException or Azure.Identity.CredentialUnavailableException)
        { ct.ThrowIfCancellationRequested(); return new(e is ExpenseRequestException known ? known.Code : "azureCostUnavailable", []); }
    }
    public async Task<AzureCostDetail> ForecastAsync(ExpenseAzureScope scope, DateOnly month, CancellationToken ct)
    {
        ExpenseRules.ValidateScope(scope);
        try {
            // Azure's model output, never a locally extrapolated price or a ledger entry.
            var url = new Uri($"https://management.azure.com{scope.Scope}/providers/Microsoft.CostManagement/forecast?api-version={ApiVersion}");
            using var response = await SendAsync(url, new {
                type = "ActualCost", timeframe = "Custom", includeActualCost = true, includeFreshPartialCost = false,
                timePeriod = new { from = month.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), to = month.AddMonths(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddTicks(-1) },
                dataset = new { granularity = "Daily", aggregation = new { totalCost = new { name = "PreTaxCost", function = "Sum" } } }
            }, ct);
            if (response.StatusCode == HttpStatusCode.NoContent) return new("noForecast", []);
            await using var input = await response.Content.ReadAsStreamAsync(ct);
            using var buffer = new MemoryStream(); var bytes = new byte[8192]; int count;
            while ((count = await input.ReadAsync(bytes, ct)) > 0) { if (buffer.Length + count > 512 * 1024) Invalid(); await buffer.WriteAsync(bytes.AsMemory(0, count), ct); }
            using var json = JsonDocument.Parse(buffer.ToArray());
            var properties = json.RootElement.GetProperty("properties");
            if (properties.TryGetProperty("nextLink", out var next) && next.ValueKind == JsonValueKind.String && !string.IsNullOrEmpty(next.GetString())) Invalid();
            var names = properties.GetProperty("columns").EnumerateArray().Select(x => x.GetProperty("name").GetString()).ToList();
            var cost = names.IndexOf("PreTaxCost"); if (cost < 0) cost = names.IndexOf("Cost");
            var date = names.IndexOf("UsageDate"); var currency = names.IndexOf("Currency");
            if (cost < 0 || date < 0 || currency < 0) Invalid();
            var rows = new List<AzureCostPoint>();
            foreach (var row in properties.GetProperty("rows").EnumerateArray()) {
                if (row.GetArrayLength() != names.Count) Invalid();
                if (!row[cost].TryGetDecimal(out var amount)) Invalid();
                if (!DateOnly.TryParseExact(row[date].ToString(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)) Invalid();
                if (day < month || day >= month.AddMonths(1) || rows.Count >= 366) Invalid();
                rows.Add(new(day, "Azure forecast including actual cost", ExpenseRules.Currency(row[currency].GetString()), amount));
            }
            return new(rows.Count == 0 ? "noForecast" : "available", rows);
        }
        catch (Exception e) when (e is ExpenseRequestException or HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException or Azure.Identity.AuthenticationFailedException or Azure.Identity.CredentialUnavailableException)
        { ct.ThrowIfCancellationRequested(); return new(e is ExpenseRequestException known ? known.Code : "azureForecastUnavailable", []); }
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Invalid() => throw new ExpenseRequestException("invalidAzureResponse", "Azure returned an unsupported or oversized cost response; no snapshot was applied.");
}
