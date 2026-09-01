using Juple.Api.Authentication;
using Juple.Application.Categories;
using Juple.Application.Categories.CreateCategory;
using Juple.Application.Categories.DeleteCategory;
using Juple.Application.Categories.ListCategories;
using Juple.Application.Categories.RenameCategory;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/categories")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class CategoriesController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IListCategoriesService listCategoriesService,
    ICreateCategoryService createCategoryService,
    IRenameCategoryService renameCategoryService,
    IDeleteCategoryService deleteCategoryService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> ListAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var categories = await listCategoriesService.ListAsync(currentUser.UserId, cancellationToken);

            return Ok(new CategoriesResponse(categories));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    [HttpPost]
    public async Task<IActionResult> CreateAsync(CreateCategoryRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var category = await createCategoryService.CreateAsync(
                currentUser.UserId, new CreateCategoryCommand(request.Name), cancellationToken);

            return Created($"/api/v1/categories/{category.Id}", category);
        }
        catch (InvalidCategoryException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CategoryNameConflictException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "A Category with this name already exists.");
        }
    }

    [HttpPut("{id:long}")]
    public Task<IActionResult> RenameAsync(
        long id,
        RenameCategoryRequest request,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => renameCategoryService.RenameAsync(
                userId, id, new RenameCategoryCommand(request.Name), cancellationToken),
            cancellationToken);

    [HttpDelete("{id:long}")]
    public Task<IActionResult> DeleteAsync(long id, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => deleteCategoryService.DeleteAsync(userId, id, cancellationToken),
            cancellationToken);

    private async Task<IActionResult> ExecuteAsync(
        Func<long, Task> action,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await action(currentUser.UserId);
            return NoContent();
        }
        catch (InvalidCategoryException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CategoryNotFoundException)
        {
            return NotFound();
        }
        catch (CategoryNameConflictException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "A Category with this name already exists.");
        }
        catch (CategoryConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The Category was modified concurrently.");
        }
    }

    public sealed record CreateCategoryRequest(string? Name);

    public sealed record RenameCategoryRequest(string? Name);

    public sealed record CategoriesResponse(IReadOnlyList<CategoryDto> Categories);
}
