namespace Juple.Application.RepeatPurchases;

public sealed record RepeatPurchasePage(
    IReadOnlyList<RepeatPurchaseDto> RepeatPurchases, RepeatPurchasePageCursor? NextCursor);
