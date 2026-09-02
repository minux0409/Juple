namespace Juple.Application.Purchases;

public sealed record PurchasePage(IReadOnlyList<PurchaseDto> Purchases, PurchasePageCursor? NextCursor);
