using Juple.Application.Categories;
using Juple.Domain.Categories;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Categories;

public sealed class CategoryStore(JupleDbContext dbContext) : ICategoryStore
{
    public async Task<IReadOnlyList<CategoryDto>> ListAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        await dbContext.Categories
            .AsNoTracking()
            .Where(category => category.UserId == userId)
            .OrderBy(category => category.SortOrder)
            .ThenBy(category => category.Id)
            .Select(category => new CategoryDto(category.Id, category.Name, category.SortOrder))
            .ToListAsync(cancellationToken);

    public async Task<CategoryDto> CreateAsync(
        long userId,
        string name,
        CancellationToken cancellationToken = default)
    {
        var maxSortOrder = await dbContext.Categories
            .Where(category => category.UserId == userId)
            .Select(category => (int?)category.SortOrder)
            .MaxAsync(cancellationToken);

        var category = new Category(userId, name, (maxSortOrder ?? -1) + 1);
        dbContext.Categories.Add(category);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            throw new CategoryNameConflictException();
        }

        return new CategoryDto(category.Id, category.Name, category.SortOrder);
    }

    public async Task RenameAsync(
        long userId,
        long categoryId,
        string name,
        CancellationToken cancellationToken = default)
    {
        var category = await dbContext.Categories
            .FirstOrDefaultAsync(category => category.Id == categoryId && category.UserId == userId, cancellationToken);
        if (category is null)
        {
            throw new CategoryNotFoundException();
        }

        category.Rename(name);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            throw new CategoryNameConflictException();
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CategoryConcurrencyException(exception);
        }
    }

    public async Task DeleteAsync(
        long userId,
        long categoryId,
        CancellationToken cancellationToken = default)
    {
        var category = await dbContext.Categories
            .FirstOrDefaultAsync(category => category.Id == categoryId && category.UserId == userId, cancellationToken);
        if (category is null)
        {
            return;
        }

        dbContext.Categories.Remove(category);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Matches Item's delete-vs-delete race handling: another request already removed this
            // Category, so the desired end state (absent) was already reached.
        }
    }
}
