using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Application.Identity;
using Juple.Application.Support;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// 고객센터 > 문의하기: the signed-in user's own support inquiries. The owner is always the internal user id taken from
/// the authenticated principal - the request carries none - and anyone else's inquiry id is a plain 404, never a 403
/// that would confirm it exists. There is deliberately NO answer route here: Juple has no admin/operator/support-agent
/// authorization (the only policy is the ordinary signed-in user), and an answer endpoint behind it would let any user
/// answer any inquiry. Answers are recorded through ISupportInquiryService.AnswerAsync until a secure operator
/// mechanism exists.
/// </summary>
[ApiController]
[Route("api/v1/support/inquiries")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
public sealed class SupportInquiriesController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ISupportInquiryService inquiryService) : ControllerBase
{
    /// <summary>Idempotent per (user, clientRequestId): a retry returns the same inquiry (200) instead of creating another (201).</summary>
    [HttpPost]
    [EnableRateLimiting(RateLimitPolicies.SupportInquiryCreate)]
    public Task<IActionResult> CreateAsync([FromBody] CreateSupportInquiryRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inquiryService.CreateAsync(
                userId,
                new CreateSupportInquiryCommand(
                    request.ClientRequestId,
                    request.Type,
                    request.Content,
                    request.Diagnostics is { } diagnostics
                        ? new SupportInquiryDiagnosticsInput(
                            diagnostics.AppVersion,
                            diagnostics.BuildNumber,
                            diagnostics.Platform,
                            diagnostics.OsVersion,
                            diagnostics.DeviceModel,
                            diagnostics.Locale)
                        : null),
                cancellationToken),
            result => result.Created
                ? Created($"/api/v1/support/inquiries/{result.Inquiry.InquiryId}", result.Inquiry)
                : Ok(result.Inquiry),
            cancellationToken);

    /// <summary>Newest first; cursor is the previous page's nextCursor (keyset by id - no OFFSET).</summary>
    [HttpGet]
    public Task<IActionResult> ListAsync([FromQuery] long? cursor, [FromQuery] int? limit, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inquiryService.ListAsync(userId, cursor, limit, cancellationToken),
            page => Ok(new SupportInquiriesResponse(
                page.Items,
                page.NextCursor?.ToString(System.Globalization.CultureInfo.InvariantCulture))),
            cancellationToken);

    [HttpGet("{inquiryId:long}")]
    public Task<IActionResult> GetAsync(long inquiryId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inquiryService.GetAsync(userId, inquiryId, cancellationToken),
            inquiry => Ok(inquiry),
            cancellationToken);

    private async Task<IActionResult> ExecuteAsync<TResult>(
        Func<long, Task<TResult>> action,
        Func<TResult, IActionResult> success,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return success(await action(currentUser.UserId));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (SupportInquiryNotFoundException)
        {
            return NotFound();
        }
        catch (SupportInquiryClientRequestConflictException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "clientRequestId was already used for a different inquiry.");
        }
        catch (InvalidSupportInquiryException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    /// <summary>No user id by design. Type is the stable code (Account, Subscription, LinkSaving, CollectionSharing, Bug, FeatureRequest, Other).</summary>
    public sealed record CreateSupportInquiryRequest(
        Guid? ClientRequestId,
        string? Type,
        string? Content,
        SupportInquiryDiagnosticsRequest? Diagnostics);

    public sealed record SupportInquiryDiagnosticsRequest(
        string? AppVersion,
        string? BuildNumber,
        string? Platform,
        string? OsVersion,
        string? DeviceModel,
        string? Locale);

    public sealed record SupportInquiriesResponse(IReadOnlyList<SupportInquiryDto> Items, string? NextCursor);
}
