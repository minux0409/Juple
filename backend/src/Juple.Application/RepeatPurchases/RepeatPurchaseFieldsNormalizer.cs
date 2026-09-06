using Juple.Domain.Purchases;

namespace Juple.Application.RepeatPurchases;

/// <summary>
/// Shared Create/Update normalization for the full RepeatPurchase field set. ProductName follows
/// Purchase.ProductName's identical trim-then-validate approach - required, never collapses to
/// null, since it is the only guaranteed way to identify this setting once ItemId is null (see
/// CK_RepeatPurchases_ProductName_NotWhitespaceOnly). IntervalUnit is not re-validated here: by the
/// time a caller reaches this normalizer, it has already been parsed from the wire by
/// IntervalUnitWireFormat.TryParse, which only ever returns one of the three defined values -
/// nothing downstream re-checks it.
/// </summary>
internal static class RepeatPurchaseFieldsNormalizer
{
    internal static RepeatPurchaseFields Normalize(
        long? itemId,
        string? productName,
        int? intervalValue,
        IntervalUnit intervalUnit,
        DateOnly? nextPurchaseDate,
        bool isReminderEnabled,
        int reminderLeadDays)
    {
        var normalizedProductName = NormalizeProductName(productName);
        var normalizedIntervalValue = NormalizeIntervalValue(intervalValue);
        // Backend never computes/defaults "today" - a missing nextPurchaseDate is a client error,
        // not something this normalizer papers over.
        var normalizedNextPurchaseDate = nextPurchaseDate
            ?? throw new InvalidRepeatPurchaseException("nextPurchaseDate", "nextPurchaseDate is required.");

        if (reminderLeadDays < 0)
        {
            throw new InvalidRepeatPurchaseException(
                "reminderLeadDays", "reminderLeadDays must be zero or greater.");
        }

        return new RepeatPurchaseFields(
            itemId,
            normalizedProductName,
            normalizedIntervalValue,
            intervalUnit,
            normalizedNextPurchaseDate,
            isReminderEnabled,
            reminderLeadDays);
    }

    private static string NormalizeProductName(string? productName)
    {
        var trimmed = productName?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new InvalidRepeatPurchaseException("productName", "productName is required.");
        }

        if (trimmed.Length > 500)
        {
            throw new InvalidRepeatPurchaseException(
                "productName", "productName must be 500 characters or fewer.");
        }

        return trimmed;
    }

    private static int NormalizeIntervalValue(int? intervalValue)
    {
        var value = intervalValue
            ?? throw new InvalidRepeatPurchaseException("intervalValue", "intervalValue is required.");

        if (value <= 0)
        {
            throw new InvalidRepeatPurchaseException(
                "intervalValue", "intervalValue must be greater than zero.");
        }

        return value;
    }
}
