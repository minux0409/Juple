using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Juple.Domain.Expenses;

namespace Juple.Application.Expenses;

public static partial class ExpenseRules
{
    public static ExpenseValues Validate(ExpenseValues value)
    {
        static string Text(string? text, int max, string name) => !string.IsNullOrWhiteSpace(text) && text.Trim().Length <= max
            ? text.Trim() : throw new ExpenseRequestException("invalidExpense", $"{name} is required and must be at most {max} characters.");
        var currency = Currency(value.Currency);
        if (!Enum.IsDefined(value.Category) || !Enum.IsDefined(value.Status) || !Enum.IsDefined(value.Kind)) Fail("Invalid category, status or kind.");
        if (value.OccurredOn.Year is < 2000 or > 2100 || value.PaidOn?.Year is < 2000 or > 2100) Fail("Invalid accounting date.");
        foreach (var amount in new[] { (decimal?)value.GrossAmount, value.NetAmount, value.TaxAmount })
            if (amount is { } number && (number is < -999_999_999_999m or > 999_999_999_999m || decimal.Round(number, 12) != number)) Fail("Amount is outside the supported range or precision.");
        if ((value.NetAmount is null) != (value.TaxAmount is null)) Fail("Supply both net and tax, or leave both unknown.");
        if (value.NetAmount is { } net && value.TaxAmount is { } tax && net + tax != value.GrossAmount) Fail("Net plus tax must equal gross.");
        if (value.Kind == ExpenseKind.Charge && (value.GrossAmount < 0 || value.NetAmount < 0 || value.TaxAmount < 0)) Fail("A charge cannot be negative.");
        if (value.Kind == ExpenseKind.Refund && (value.GrossAmount >= 0 || value.NetAmount > 0 || value.TaxAmount > 0 || value.OriginalExpenseId is null)) Fail("A refund needs a negative amount and its original expense.");
        if (value.Kind != ExpenseKind.Refund && value.OriginalExpenseId is not null) Fail("Only refunds may reference an original expense.");
        if (value.Status == ExpenseStatus.Paid && value.PaidOn is null) Fail("A paid expense needs its actual payment date.");
        if (value.Memo?.Length > 2000 || value.InvoiceReference?.Length > 200) Fail("Memo or invoice reference is too long.");
        if (value.ConvertedCurrency is not null || value.ExchangeRate is not null || value.ExchangeRateOn is not null)
        {
            if (value.ConvertedCurrency is null || value.ExchangeRate is null or <= 0 or > 1_000_000_000 || value.ExchangeRateOn is null) Fail("Currency conversion needs currency, positive rate and rate date.");
            if (Currency(value.ConvertedCurrency!) == currency) Fail("Conversion currencies must differ.");
            if (decimal.Round(value.ExchangeRate!.Value, 12) != value.ExchangeRate) Fail("Exchange rate has too many decimal places.");
        }
        return value with { Name = Text(value.Name, 200, "name"), Provider = Text(value.Provider, 200, "provider"), Currency = currency,
            PaymentMethod = Text(value.PaymentMethod, 80, "paymentMethod"), InvoiceReference = string.IsNullOrWhiteSpace(value.InvoiceReference) ? null : value.InvoiceReference.Trim(),
            ConvertedCurrency = value.ConvertedCurrency is null ? null : Currency(value.ConvertedCurrency) };
    }
    public static void Validate(ExpenseFilter filter)
    {
        if (filter.From > filter.Through || filter.From.AddYears(1) < filter.Through || filter.From.Year < 2000 || filter.Through.Year > 2100) Fail("Choose a period of at most one year.");
        if (filter.Limit is < 1 or > 100 || filter.Cursor < 0) Fail("Invalid page.");
        if (filter.Currency is not null) Currency(filter.Currency);
        if (filter.Provider?.Length > 200 || filter.PaymentMethod?.Length > 80 || filter.Environment?.Length > 32 || filter.ServiceName?.Length > 200) Fail("Filter is too long.");
        if (filter.Category is { } category && !Enum.IsDefined(category) || filter.Status is { } status && !Enum.IsDefined(status)) Fail("Invalid filter.");
    }
    public static string Currency(string? value) => value is not null && CurrencyPattern().IsMatch(value) ? value : throw new ExpenseRequestException("invalidExpense", "Currency must be a three-letter uppercase ISO code.");
    public static string Hash(string input) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input)));
    public static string ManualKey(ExpenseWrite command) => Hash(command.Values.InvoiceReference is { } reference
        ? $"invoice:{command.Values.Provider.ToUpperInvariant()}:{command.Values.Currency}:{reference.ToUpperInvariant()}"
        : $"request:{command.RequestId:D}");
    public static string AzureKey(string scope, AzureExpenseCost row) => Hash($"azure:{scope.ToLowerInvariant()}:{row.Date:yyyy-MM-dd}:{row.ServiceName}:{row.Currency}");
    public static void ValidateScope(ExpenseAzureScope scope)
    {
        if (!ScopePattern().IsMatch(scope.Scope) || !Guid.TryParse(scope.Scope.Split('/')[2], out _)
            || string.IsNullOrWhiteSpace(scope.Environment) || scope.Environment.Length > 32) Fail("Configure explicit resource-group scopes and environment labels.");
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    public static void Fail(string message) => throw new ExpenseRequestException("invalidExpense", message);
    [GeneratedRegex("^[A-Z]{3}\\z", RegexOptions.CultureInvariant)] private static partial Regex CurrencyPattern();
    [GeneratedRegex("^/subscriptions/[0-9a-fA-F-]{36}/resourceGroups/[A-Za-z0-9_.()-]{1,90}\\z", RegexOptions.CultureInvariant)] private static partial Regex ScopePattern();
}
