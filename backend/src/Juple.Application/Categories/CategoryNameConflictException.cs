namespace Juple.Application.Categories;

public sealed class CategoryNameConflictException()
    : Exception("A Category with this name already exists for this user.");
