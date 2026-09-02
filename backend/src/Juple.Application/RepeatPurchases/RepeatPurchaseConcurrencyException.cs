namespace Juple.Application.RepeatPurchases;

public sealed class RepeatPurchaseConcurrencyException(Exception innerException)
    : Exception("The RepeatPurchase was modified concurrently.", innerException);
