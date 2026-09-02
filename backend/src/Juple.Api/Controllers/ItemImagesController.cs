using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Images;
using Juple.Application.Images.DeleteItemImage;
using Juple.Application.Images.ListItemImages;
using Juple.Application.Images.UploadItemImage;
using Juple.Application.Items;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/items/{itemId:long}/images")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class ItemImagesController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IListItemImagesService listItemImagesService,
    IUploadItemImageService uploadItemImageService,
    IDeleteItemImageService deleteItemImageService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> ListAsync(long itemId, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var images = await listItemImagesService.ListAsync(currentUser.UserId, itemId, cancellationToken);

            return Ok(new ItemImagesResponse(images.Select(ToResponse).ToList()));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (ItemNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(11 * 1024 * 1024)]
    public async Task<IActionResult> UploadAsync(
        long itemId,
        IFormFile? file,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);

            // Only the file's own bytes are used; its client-supplied filename/Content-Type are
            // never read.
            byte[]? content = null;
            if (file is not null && file.Length > 0)
            {
                using var memoryStream = new MemoryStream();
                await file.CopyToAsync(memoryStream, cancellationToken);
                content = memoryStream.ToArray();
            }

            var image = await uploadItemImageService.UploadAsync(
                currentUser.UserId, itemId, content, cancellationToken);

            return Created($"/api/v1/items/{itemId}/images/{image.Id}", ToResponse(image));
        }
        catch (InvalidItemImageException exception)
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
        catch (ItemNotFoundException)
        {
            return NotFound();
        }
        catch (ItemImageLimitExceededException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "This Item already has the maximum number of images.");
        }
    }

    [HttpDelete("{imageId:long}")]
    public async Task<IActionResult> DeleteAsync(long itemId, long imageId, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await deleteItemImageService.DeleteAsync(currentUser.UserId, itemId, imageId, cancellationToken);

            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    private static ItemImageResponse ToResponse(ItemImageDto image) =>
        new(image.Id, image.ContentType, image.ByteLength, image.SortOrder, image.CreatedAtUtc, image.ReadUrl);

    public sealed record ItemImagesResponse(IReadOnlyList<ItemImageResponse> Images);

    public sealed record ItemImageResponse(
        long Id,
        string ContentType,
        long ByteLength,
        int SortOrder,
        DateTimeOffset CreatedAtUtc,
        Uri? ReadUrl);
}
