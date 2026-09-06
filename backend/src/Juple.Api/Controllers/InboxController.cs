using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Inbox;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/inbox")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class InboxController : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<InboxEntryDto>> SaveAsync(
        SaveInboxEntryRequest request,
        [FromServices] IExternalIdentityAccessor externalIdentityAccessor,
        [FromServices] ICurrentJupleUserAccessor currentUserAccessor,
        [FromServices] IInboxEntrySaveService inboxEntrySaveService,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var result = await inboxEntrySaveService.SaveAsync(
                currentUser.UserId,
                new SaveInboxEntryCommand(request.Url, request.ClientRequestId),
                cancellationToken);

            return result.Created
                ? Created($"/api/v1/inbox/{result.Entry.Id}", result.Entry)
                : Ok(result.Entry);
        }
        catch (InvalidInboxRequestException exception)
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
        catch (InboxEntryClientRequestConflictException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The request conflicts with a prior request using the same clientRequestId.");
        }
    }

    public sealed record SaveInboxEntryRequest(string? Url, Guid? ClientRequestId);
}
