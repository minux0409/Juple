namespace Juple.Application.RepeatPurchases;

/// <summary>Keyset pagination position for a RepeatPurchase list ordered by NextPurchaseDate ASC, Id ASC.</summary>
public sealed record RepeatPurchasePageCursor(DateOnly NextPurchaseDate, long Id);
