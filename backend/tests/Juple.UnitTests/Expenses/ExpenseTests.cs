using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Azure.Core;
using Juple.Application.Admin;
using Juple.Application.Billing;
using Juple.Application.Expenses;
using Juple.Domain.Admin;
using Juple.Domain.Expenses;
using Juple.Infrastructure.Expenses;

namespace Juple.UnitTests.Expenses;

public sealed class ExpenseTests
{
    private static readonly DateOnly Day = new(2026, 10, 20);
    public static ExpenseValues Valid() => new("Developer program", "Apple", ExpenseCategory.DeveloperProgram, Day, Day,
        "USD", 90m, 9m, 99m, "Company card", ExpenseStatus.Paid, ExpenseKind.Charge, "invoice-1", "Original invoice retained");
    [Fact] public void Policy_is_reference_only_and_other_policies_are_unchanged()
    {
        Assert.Equal(1.99m, SubscriptionPricingPolicy.MonthlyUsdReferencePrice); Assert.Equal("USD", SubscriptionPricingPolicy.ReferenceCurrency);
        Assert.Equal(30, new BillingOptions().TrialDurationDays); Assert.False(new BillingOptions().ProgramEnabled);
        Assert.False(new ExpenseOptions().Enabled); Assert.False(new ExpenseOptions().AzureSyncEnabled);
    }
    [Fact] public void Exact_decimal_tax_is_required_and_unknown_is_distinct_from_zero()
    {
        Assert.Equal(99m, ExpenseRules.Validate(Valid()).GrossAmount);
        Assert.Null(ExpenseRules.Validate(Valid() with { NetAmount = null, TaxAmount = null }).TaxAmount);
        Assert.Throws<ExpenseRequestException>(() => ExpenseRules.Validate(Valid() with { TaxAmount = 0 }));
        Assert.Throws<ExpenseRequestException>(() => ExpenseRules.Validate(Valid() with { NetAmount = null }));
        var tiny = Valid() with { NetAmount = 0.100000000001m, TaxAmount = 0.2m, GrossAmount = 0.300000000001m };
        Assert.Equal(tiny, ExpenseRules.Validate(tiny));
    }
    [Theory] [InlineData("usd")] [InlineData("KR")] [InlineData(" KRW")] [InlineData("USD\n")] [InlineData("<x>")]
    public void Currency_is_bounded(string currency) => Assert.Throws<ExpenseRequestException>(() => ExpenseRules.Validate(Valid() with { Currency = currency }));
    [Fact] public void Payment_refund_dates_amounts_and_conversion_are_validated()
    {
        foreach (var value in new[] { Valid() with { PaidOn = null }, Valid() with { GrossAmount = -1 }, Valid() with { GrossAmount = 1.0000000000001m },
            Valid() with { Kind = ExpenseKind.Refund }, Valid() with { Name = " " }, Valid() with { Category = (ExpenseCategory)999 },
            Valid() with { ExchangeRate = 1300m }, Valid() with { ConvertedCurrency = "USD", ExchangeRate = 1m, ExchangeRateOn = Day } })
            Assert.Throws<ExpenseRequestException>(() => ExpenseRules.Validate(value));
        Assert.Equal(-99m, ExpenseRules.Validate(Valid() with { Kind = ExpenseKind.Refund, GrossAmount = -99, NetAmount = -90, TaxAmount = -9, OriginalExpenseId = 1 }).GrossAmount);
    }
    [Fact] public void Deduplication_is_stable_across_requests_and_scope_casing()
    {
        var a = new ExpenseWrite(Guid.NewGuid(), Valid()); var b = new ExpenseWrite(Guid.NewGuid(), Valid());
        Assert.Equal(ExpenseRules.ManualKey(a), ExpenseRules.ManualKey(b));
        Assert.NotEqual(ExpenseRules.ManualKey(a), ExpenseRules.ManualKey(b with { Values = b.Values with { Currency = "KRW" } }));
        var cost = new AzureExpenseCost(Day, "SQL Database", "KRW", 1m, "1.0");
        Assert.Equal(ExpenseRules.AzureKey("/scope", cost), ExpenseRules.AzureKey("/SCOPE", cost));
    }
    [Fact] public void Conversion_exports_exact_amount_without_replacing_original_currency_or_rate()
    {
        var values = ExpenseRules.Validate(Valid() with { ConvertedCurrency = "KRW", ExchangeRate = 1375.123456789012m, ExchangeRateOn = Day });
        var row = new ExpenseRow(new Expense(Guid.NewGuid(), ExpenseSource.Manual, "fx", values, 1, DateTimeOffset.UtcNow), []);
        var csv = Encoding.UTF8.GetString(ExpenseSpreadsheetWriter.Csv([row]));
        Assert.Contains("\"USD\",\"90\",\"9\",\"99\",\"KRW\",\"1375.123456789012\",\"2026-10-20\",\"136137.222222112188\"", csv);
        using var zip = new ZipArchive(new MemoryStream(ExpenseSpreadsheetWriter.Excel([row])), ZipArchiveMode.Read);
        using var input = zip.GetEntry("xl/worksheets/sheet1.xml")!.Open();
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var cells = XDocument.Load(input).Descendants(ns + "row").Last().Elements(ns + "c").ToArray();
        Assert.Equal("USD", cells[9].Value); Assert.Equal("99", cells[12].Value); Assert.Equal("KRW", cells[13].Value);
        Assert.Equal("1375.123456789012", cells[14].Value); Assert.Equal("2026-10-20", cells[15].Value);
        Assert.Equal("136137.222222112188", cells[16].Value);
        Assert.Equal("inlineStr", cells[16].Attribute("t")!.Value); // Beyond Excel's 15-digit precision.
    }
    [Theory] [InlineData(2026, 1, 31, 2026, 2, 28, 2026, 3, 31)] [InlineData(2024, 1, 31, 2024, 2, 29, 2024, 3, 31)]
    public void Monthly_schedule_keeps_its_anchor(int y, int m, int d, int y2, int m2, int d2, int y3, int m3, int d3)
    {
        var schedule = new ExpenseRecurringSchedule(1, ExpenseFrequency.Monthly, new DateOnly(y, m, d));
        schedule.Advance(); Assert.Equal(new DateOnly(y2, m2, d2), schedule.NextDueOn);
        schedule.Advance(); Assert.Equal(new DateOnly(y3, m3, d3), schedule.NextDueOn);
    }
    [Fact] public void Leap_year_annual_schedule_returns_to_leap_day()
    {
        var schedule = new ExpenseRecurringSchedule(1, ExpenseFrequency.Yearly, new DateOnly(2024, 2, 29));
        for (var i = 0; i < 4; i++) schedule.Advance(); Assert.Equal(new DateOnly(2028, 2, 29), schedule.NextDueOn);
    }
    [Fact] public async Task Every_service_read_write_and_evidence_download_rechecks_active_admin()
    {
        var admins = new AdminLookup(); var service = new ExpenseService(null!, admins, new ExpenseOptions { Enabled = true }, TimeProvider.System);
        await Assert.ThrowsAsync<ExpenseForbiddenException>(() => service.ListAsync(1, new(Day, Day), default));
        await Assert.ThrowsAsync<ExpenseForbiddenException>(() => service.SaveAsync(1, null, new(Guid.NewGuid(), Valid()), default));
        var evidence = new ExpenseEvidenceService(service, null!, null!, null!, TimeProvider.System);
        await Assert.ThrowsAsync<ExpenseForbiddenException>(() => evidence.DownloadAsync(1, 1, 1, default));
        admins.Access = new AdminAccess(1, AdminRole.Admin); await service.RequireAdminAsync(1, default);
        admins.Access = null; await Assert.ThrowsAsync<ExpenseForbiddenException>(() => service.RequireAdminAsync(1, default));
    }
    [Fact] public async Task Feature_off_rejects_before_accessing_the_ledger()
    {
        var service = new ExpenseService(null!, new AdminLookup { Access = new(1, AdminRole.Owner) }, new(), TimeProvider.System);
        var error = await Assert.ThrowsAsync<ExpenseRequestException>(() => service.ListAsync(1, new(Day, Day), default)); Assert.Equal("expensesDisabled", error.Code);
    }
    [Fact] public void Csv_and_excel_are_actual_safe_documents_with_original_values()
    {
        var row = new ExpenseRow(new Expense(Guid.NewGuid(), ExpenseSource.Manual, "key", Valid() with { Name = "=WEBSERVICE(\"bad\")", Memo = "회계 원본\nline2" }, 1, DateTimeOffset.UtcNow), []);
        var csv = Encoding.UTF8.GetString(ExpenseSpreadsheetWriter.Csv([row])); Assert.Contains("\t=WEBSERVICE", csv); Assert.Contains("회계 원본", csv);
        using var zip = new ZipArchive(new MemoryStream(ExpenseSpreadsheetWriter.Excel([row])), ZipArchiveMode.Read);
        Assert.Equal(5, zip.Entries.Count); Assert.NotNull(zip.GetEntry("[Content_Types].xml"));
        using var input = zip.GetEntry("xl/worksheets/sheet1.xml")!.Open(); var xml = XDocument.Load(input);
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        Assert.Empty(xml.Descendants(ns + "f")); Assert.Contains(xml.Descendants(ns + "t"), element => element.Value.StartsWith("=WEBSERVICE"));
        Assert.Contains(xml.Descendants(ns + "v"), element => element.Value == "99");
    }
    [Fact] public void Decimal_text_round_trip_does_not_lose_precision()
    {
        var json = JsonSerializer.Serialize(Valid() with { GrossAmount = 123456.123456123456m });
        Assert.Contains("\"123456.123456123456\"", json); Assert.Equal(123456.123456123456m, JsonSerializer.Deserialize<ExpenseValues>(json)!.GrossAmount);
    }
    [Fact] public void Evidence_rejects_disguised_or_encrypted_files()
    {
        Assert.Throws<ExpenseRequestException>(() => ExpenseEvidenceService.DetectType("<script>evil</script>"u8));
        Assert.Throws<ExpenseRequestException>(() => ExpenseEvidenceService.DetectType("%PDF-1.7 /Encrypt"u8));
        Assert.Equal("application/pdf", ExpenseEvidenceService.DetectType("%PDF-1.7"u8));
    }
    [Fact] public async Task Malware_scanning_is_fail_closed_when_unconfigured()
    {
        var error = await Assert.ThrowsAsync<ExpenseRequestException>(() => new ClamAvExpenseScanner(new()).ScanAsync("%PDF-1.7"u8.ToArray(), default));
        Assert.Equal("evidenceScannerUnavailable", error.Code);
        var service = new ExpenseService(null!, new AdminLookup { Access = new(1, AdminRole.Owner) }, new() { Enabled = true }, TimeProvider.System);
        var evidence = new ExpenseEvidenceService(service, null!, new ClamAvExpenseScanner(new()), null!, TimeProvider.System);
        using var input = new MemoryStream("%PDF-1.7 upload fixture"u8.ToArray());
        var uploadError = await Assert.ThrowsAsync<ExpenseRequestException>(() => evidence.UploadAsync(1, 7, Guid.NewGuid(), "invoice.pdf", input, default));
        Assert.Equal("evidenceScannerUnavailable", uploadError.Code); // Rejected before touching the ledger or blob store.
    }
    [Fact] public async Task Azure_follows_pages_and_refuses_cross_scope_or_external_next_links()
    {
        const string scope = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-juple-test";
        var calls = 0;
        var handler = new Handler(request => {
            calls++; Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            var next = calls == 1 ? $"https://management.azure.com{scope}/providers/Microsoft.CostManagement/query?api-version=2025-03-01&$skiptoken=2" : null;
            return Reply(next, calls == 1 ? "1.23456789012345" : "2"); });
        var rows = await new AzureExpenseSource(new HttpClient(handler), new Credential()).QueryAsync(new(scope, "DEV"), new(2026, 10, 1), default);
        Assert.Equal(2, rows.Count); Assert.Equal("1.23456789012345", rows[0].RawAmount); Assert.Equal("KRW", rows[0].Currency);
        var evil = new Handler(_ => Reply("https://evil.test/steal", "1"));
        await Assert.ThrowsAsync<ExpenseRequestException>(() => new AzureExpenseSource(new HttpClient(evil), new Credential()).QueryAsync(new(scope, "DEV"), new(2026, 10, 1), default));
    }
    [Fact] public void Azure_parser_uses_named_columns_and_rejects_missing_dimensions()
    {
        using var json = JsonDocument.Parse("""{"columns":[{"name":"Currency"},{"name":"ServiceName"},{"name":"UsageDate"},{"name":"PreTaxCost"}],"rows":[["KRW","SQL Database",20261020,0.1]]} """);
        Assert.Equal(0.1m, AzureExpenseSource.Parse(json.RootElement).Single().Amount);
        using var invalid = JsonDocument.Parse("""{"columns":[],"rows":[]} """);
        Assert.Throws<ExpenseRequestException>(() => AzureExpenseSource.Parse(invalid.RootElement));
    }
    [Fact] public async Task Azure_long_retry_after_is_not_shortened_or_retried_in_a_loop()
    {
        var calls = 0;
        var handler = new Handler(_ => { calls++; var reply = new HttpResponseMessage(HttpStatusCode.TooManyRequests); reply.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromMinutes(2)); return reply; });
        var error = await Assert.ThrowsAsync<ExpenseRequestException>(() => new AzureExpenseSource(new HttpClient(handler), new Credential()).QueryAsync(
            new("/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test", "DEV"), new(2026, 10, 1), default));
        Assert.Equal("azureCostThrottled", error.Code); Assert.Equal(1, calls);
    }
    private static HttpResponseMessage Reply(string? next, string amount) => new(HttpStatusCode.OK) { Content = new StringContent("{\"properties\":{\"columns\":[{\"name\":\"PreTaxCost\"},{\"name\":\"UsageDate\"},{\"name\":\"ServiceName\"},{\"name\":\"Currency\"}],\"rows\":[[" + amount + ",20261020,\"SQL Database\",\"KRW\"]],\"nextLink\":" + JsonSerializer.Serialize(next) + "}}") };
    private sealed class Credential : TokenCredential
    { public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) => new("test-only", DateTimeOffset.UtcNow.AddHours(1)); public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) => ValueTask.FromResult(GetToken(requestContext, cancellationToken)); }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(respond(request)); }
    private sealed class AdminLookup : IAdminAccessStore
    { public AdminAccess? Access { get; set; } public Task<AdminAccess?> FindActiveAsync(long userId, CancellationToken cancellationToken = default) => Task.FromResult(Access); }
}

// The clamd wire contract is exercised against a loopback fixture; it does not pretend to run a real virus database.
public sealed class ExpenseScannerProtocolTests
{
    [Theory]
    [InlineData("stream: OK", null)]
    [InlineData("stream: Eicar-Signature FOUND", "evidenceMalware")]
    [InlineData("stream: scan limit ERROR", "evidenceScannerUnavailable")]
    public async Task Only_a_complete_clean_reply_allows_evidence(string response, string? expectedCode)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0); listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        var server = Task.Run(async () => {
            using var socket = await listener.AcceptTcpClientAsync(deadline.Token); await using var stream = socket.GetStream();
            var command = new byte[10]; await stream.ReadExactlyAsync(command, deadline.Token); Assert.Equal("zINSTREAM\0", Encoding.ASCII.GetString(command));
            var header = new byte[4];
            while (true) { await stream.ReadExactlyAsync(header, deadline.Token); var count = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(header); if (count == 0) break; var chunk = new byte[count]; await stream.ReadExactlyAsync(chunk, deadline.Token); }
            await stream.WriteAsync(Encoding.ASCII.GetBytes(response + "\0"), deadline.Token);
        }, deadline.Token);
        try
        {
            var scanner = new ClamAvExpenseScanner(new ExpenseOptions { ClamAvHost = "127.0.0.1", ClamAvPort = port });
            if (expectedCode is null) await scanner.ScanAsync("%PDF-1.7 fixture"u8.ToArray(), deadline.Token);
            else Assert.Equal(expectedCode, (await Assert.ThrowsAsync<ExpenseRequestException>(() => scanner.ScanAsync("%PDF-1.7 fixture"u8.ToArray(), deadline.Token))).Code);
            await server;
        }
        finally { listener.Stop(); }
    }
}
