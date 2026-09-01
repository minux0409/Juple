namespace Juple.Application.Items;

public sealed class ItemConcurrencyException(Exception innerException)
    : Exception("The Item was modified concurrently.", innerException);
