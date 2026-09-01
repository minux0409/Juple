namespace Juple.Application.Categories.RenameCategory;

public interface IRenameCategoryService
{
    Task RenameAsync(
        long userId,
        long categoryId,
        RenameCategoryCommand command,
        CancellationToken cancellationToken = default);
}
