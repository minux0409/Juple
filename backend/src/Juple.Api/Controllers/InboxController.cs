using Juple.Api.Authentication;
using Juple.Application.Collections.Public;
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
        catch (CollectionShareUrlNotSavableException exception)
        {
            // A stable code (and the Collection's public id, which the caller already holds in the URL it sent) so a
            // client can open the Collection instead of showing a generic error.
            var problem = new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "A Juple Collection share link cannot be saved as a link.",
            };
            problem.Extensions["code"] = CollectionShareUrlNotSavableException.Code;
            problem.Extensions["publicId"] = exception.PublicId;
            return new ObjectResult(problem) { StatusCode = StatusCodes.Status400BadRequest };
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
