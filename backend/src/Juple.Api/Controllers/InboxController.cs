using System.Globalization;
using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Inbox;
using Juple.Application.Inbox.GetDailyInbox;
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

    [HttpGet]
    public async Task<ActionResult<DailyInboxResult>> GetDailyAsync(
        [FromQuery] string? date,
        [FromServices] IExternalIdentityAccessor externalIdentityAccessor,
        [FromServices] ICurrentJupleUserAccessor currentUserAccessor,
        [FromServices] IGetDailyInboxService getDailyInboxService,
        CancellationToken cancellationToken)
    {
        if (!TryParseDate(date, out var requestedDate))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["date"] = ["Date must use the YYYY-MM-DD format."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return Ok(await getDailyInboxService.GetAsync(
                currentUser.UserId,
                currentUser.TimeZoneId,
                requestedDate,
                cancellationToken));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    private static bool TryParseDate(string? value, out DateOnly? date)
    {
        if (value is null)
        {
            date = null;
            return true;
        }

        if (DateOnly.TryParseExact(
            value,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var parsedDate))
        {
            date = parsedDate;
            return true;
        }

        date = null;
        return false;
    }

    public sealed record SaveInboxEntryRequest(string? Url, Guid? ClientRequestId);
}