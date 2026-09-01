namespace Juple.Application.Categories;

/// <summary>
/// Shared Create/Rename normalization: trim outer whitespace, reject a missing or
/// whitespace-only value (Name is required, unlike Item.Title), enforce the 100-character limit.
/// </summary>
internal static class CategoryNameNormalizer
{
    internal static string Normalize(string? name)
    {
        var trimmedName = name?.Trim();
        if (string.IsNullOrEmpty(trimmedName))
        {
            throw new InvalidCategoryException("name", "Name is required.");
        }

        if (trimmedName.Length > 100)
        {
            throw new InvalidCategoryException("name", "Name must be 100 characters or fewer.");
        }

        return trimmedName;
    }
}
