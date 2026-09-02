namespace Juple.Application.Purchases;

/// <summary>Keyset pagination position for a Purchase list ordered by PurchaseDate DESC, Id DESC.</summary>
public sealed record PurchasePageCursor(DateOnly PurchaseDate, long Id);
