namespace Juple.Application.Collections;

public sealed class CollectionConcurrencyException(Exception innerException)
    : Exception("The Collection was modified concurrently.", innerException);
