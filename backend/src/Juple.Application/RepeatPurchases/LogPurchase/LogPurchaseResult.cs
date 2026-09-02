using Juple.Application.Purchases;

namespace Juple.Application.RepeatPurchases.LogPurchase;

/// <summary>Both DTOs reflect the row state after the same committed transaction - never a partial result.</summary>
public sealed record LogPurchaseResult(PurchaseDto Purchase, RepeatPurchaseDto RepeatPurchase);
