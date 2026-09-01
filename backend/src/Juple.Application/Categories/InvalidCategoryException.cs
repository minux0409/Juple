namespace Juple.Application.Categories;

public sealed class InvalidCategoryException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
