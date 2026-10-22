using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Core;
using Juple.Application.Admin;

namespace Juple.Infrastructure.Analytics;

/// <summary>Opt-in, bounded aggregate-only Azure Monitor adapter; no user query, URL, token, IP or raw log is returned.</summary>
public sealed class AzureAdminTelemetrySource(HttpClient http, TokenCredential credential, AdminWorkspaceOptions options) : IAdminTelemetrySource
{
    public async Task<WorkspaceTelemetry> ReadAsync(AdminDateRange p, CancellationToken ct)
    {
        if (!options.TelemetryEnabled || !Guid.TryParse(options.TelemetryWorkspaceId, out var workspace)
            || string.IsNullOrWhiteSpace(options.TelemetryRoleName) || options.TelemetryRoleName.Length > 128
            || !System.Text.RegularExpressions.Regex.IsMatch(options.TelemetryRoleName, "^[A-Za-z0-9_.-]+$")) return new(false, "notConfigured", []);
        try
        {
            var start = p.StartUtc.ToString("o", CultureInfo.InvariantCulture); var end = p.EndExclusiveUtc.ToString("o", CultureInfo.InvariantCulture);
            var query = $"""
                AppRequests
                | where AppRoleName == '{options.TelemetryRoleName}'
                | where TimeGenerated >= datetime({start}) and TimeGenerated < datetime({end})
                | summarize Requests=count(),Errors5xx=countif(toint(ResultCode)>=500),Unauthorized=countif(ResultCode=='401') by Day=startofday(datetime_utc_to_local(TimeGenerated,'Asia/Seoul'))
                | order by Day asc
                | take 366
                """;
            using var request = new HttpRequestMessage(HttpMethod.Post, $"https://api.loganalytics.azure.com/v1/workspaces/{workspace:D}/query");
            var token = await credential.GetTokenAsync(new TokenRequestContext(["https://api.loganalytics.io/.default"]), ct);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
            request.Content = JsonContent.Create(new { query });
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode) return new(false, response.StatusCode is System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.Unauthorized ? "accessDenied" : "queryFailed", []);
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var limited = new MemoryStream(); var buffer = new byte[8192]; int n;
            while ((n = await stream.ReadAsync(buffer, ct)) > 0) { if (limited.Length + n > 256 * 1024) return new(false, "responseTooLarge", []); await limited.WriteAsync(buffer.AsMemory(0, n), ct); }
            using var json = JsonDocument.Parse(limited.ToArray());
            if (json.RootElement.TryGetProperty("error", out _)) return new(false, "partialQueryFailure", []);
            var table = json.RootElement.GetProperty("tables")[0];
            var names = table.GetProperty("columns").EnumerateArray().Select(x => x.GetProperty("name").GetString()).ToList();
            var day = names.IndexOf("Day"); var total = names.IndexOf("Requests"); var errors = names.IndexOf("Errors5xx"); var unauth = names.IndexOf("Unauthorized");
            if (new[] { day, total, errors, unauth }.Any(x => x < 0)) return new(false, "unsupportedResponse", []);
            var rows = table.GetProperty("rows").EnumerateArray().Select(x => new WorkspaceHttpDay(
                DateOnly.Parse(x[day].GetString()![..10], CultureInfo.InvariantCulture), x[total].GetInt64(), x[errors].GetInt64(), x[unauth].GetInt64())).ToArray();
            return new(rows.Length > 0, rows.Length > 0 ? "available" : "noTelemetry", rows);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException or FormatException or KeyNotFoundException or ArgumentException or IndexOutOfRangeException or Azure.Identity.AuthenticationFailedException or Azure.Identity.CredentialUnavailableException)
        { ct.ThrowIfCancellationRequested(); return new(false, "queryUnavailable", []); }
    }
}
