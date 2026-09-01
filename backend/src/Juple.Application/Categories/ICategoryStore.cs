namespace Juple.Application.Categories;

public interface ICategoryStore
{
    Task<IReadOnlyList<CategoryDto>> ListAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>Places the new Category after the caller's current highest SortOrder.</summary>
    Task<CategoryDto> CreateAsync(long userId, string name, CancellationToken cancellationToken = default);

    Task RenameAsync(
        long userId,
        long categoryId,
        string name,
        CancellationToken cancellationToken = default);

    /// <summary>A missing or other-user's Category is treated as already deleted and completes without error.</summary>
    Task DeleteAsync(long userId, long categoryId, CancellationToken cancellationToken = default);
}
