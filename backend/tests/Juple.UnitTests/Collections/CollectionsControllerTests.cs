using Juple.Api.Controllers;
using Microsoft.AspNetCore.Mvc;

namespace Juple.UnitTests.Collections;

/// <summary>
/// Direct unit tests of CollectionsController's own request validation (before any service call),
/// mirroring how CategoryNameNormalizer etc. are unit-tested - no HTTP test host/package needed
/// since these branches never reach currentUserAccessor/listCollectionsService, so every
/// constructor dependency below can stay null - a call would throw NullReferenceException and
/// fail the test loudly if a change ever made one of these branches reach further than intended.
/// </summary>
public sealed class CollectionsControllerTests
{
    [Fact]
    public async Task ListAsync_WhenItemIdAndExcludeItemIdBothSpecified_ReturnsBadRequest()
    {
        var controller = new CollectionsController(
            null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!);

        var result = await controller.ListAsync(
            itemId: 1, excludeItemId: 2, isFavorite: null, limit: null, cursor: null, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        var problem = Assert.IsType<ValidationProblemDetails>(badRequest.Value);
        Assert.Contains("itemId", problem.Errors.Keys);
    }

    [Fact]
    public async Task ListAsync_WhenExcludeItemIdNotPositive_ReturnsBadRequest()
    {
        var controller = new CollectionsController(
            null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!);

        var result = await controller.ListAsync(
            itemId: null, excludeItemId: -1, isFavorite: null, limit: null, cursor: null, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        var problem = Assert.IsType<ValidationProblemDetails>(badRequest.Value);
        Assert.Contains("excludeItemId", problem.Errors.Keys);
    }

    [Fact]
    public async Task ListAsync_WhenItemIdNotPositive_ReturnsBadRequest()
    {
        var controller = new CollectionsController(
            null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!);

        var result = await controller.ListAsync(
            itemId: -1, excludeItemId: null, isFavorite: null, limit: null, cursor: null, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        var problem = Assert.IsType<ValidationProblemDetails>(badRequest.Value);
        Assert.Contains("itemId", problem.Errors.Keys);
    }
}
