namespace Juple.Domain.Purchases;

/// <summary>
/// Projects a RepeatPurchase's next expected date forward from an actual purchase date, using its
/// IntervalValue/IntervalUnit. Week is deliberately not folded into Day at storage time (see
/// IntervalUnit) - only here, at calculation time, is it expressed as IntervalValue * 7 days. Month
/// uses DateOnly.AddMonths' built-in end-of-month clamp (e.g. Jan 31 + 1 month -> Feb 28/29,
/// depending on leap year) - the same convention major calendar apps use for monthly recurrence,
/// adopted deliberately here rather than by accident.
/// </summary>
public static class RepeatPurchaseIntervalCalculator
{
    /// <summary>
    /// IntervalValue has no stored upper bound, so a large-enough value (especially combined with
    /// Week's *7 multiplier) can push the result past DateOnly's representable range
    /// (0001-01-01..9999-12-31). Rather than let that surface as a raw, uncatchable
    /// OverflowException/ArgumentOutOfRangeException, this returns false for any schedule that
    /// doesn't fit - a predictable, callable-facing outcome instead of a silent wrap or a crash. An
    /// undefined IntervalUnit is a different kind of failure (a caller bug, not a schedule that
    /// legitimately doesn't fit) and is deliberately left to throw instead of being folded into the
    /// false case.
    /// </summary>
    public static bool TryCalculateNextPurchaseDate(
        DateOnly purchaseDate, int intervalValue, IntervalUnit intervalUnit, out DateOnly nextPurchaseDate)
    {
        nextPurchaseDate = default;

        try
        {
            checked
            {
                nextPurchaseDate = intervalUnit switch
                {
                    IntervalUnit.Day => purchaseDate.AddDays(intervalValue),
                    IntervalUnit.Week => purchaseDate.AddDays(intervalValue * 7),
                    IntervalUnit.Month => purchaseDate.AddMonths(intervalValue),
                    _ => throw new ArgumentOutOfRangeException(
                        nameof(intervalUnit), intervalUnit, "Unknown IntervalUnit."),
                };
            }
            return true;
        }
        catch (OverflowException)
        {
            return false;
        }
        catch (ArgumentOutOfRangeException) when (Enum.IsDefined(intervalUnit))
        {
            // A defined IntervalUnit reaching here means AddDays/AddMonths itself rejected the
            // computed date as outside DateOnly's range - not the "Unknown IntervalUnit" branch
            // above, which only ArgumentOutOfRangeException-s for an undefined value and is
            // deliberately left uncaught by this filter.
            return false;
        }
    }
}
