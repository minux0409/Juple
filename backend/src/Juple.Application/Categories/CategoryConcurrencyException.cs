namespace Juple.Application.Categories;

public sealed class CategoryConcurrencyException(Exception innerException)
    : Exception("The Category was modified concurrently.", innerException);
