using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Safety;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Identity;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Juple.Api.Controllers;

/// <summary>
/// Safety: accepting the Terms of Service, reporting content or a person, and blocking / unblocking a person. Every one of these always
/// works - also for an account whose subscription expired, and (for reporting and blocking) before the Terms were accepted. The acting
/// person is always the internal user taken from the authenticated principal; a request never carries a user id. Reading and handling reports is the
/// Admin's (AdminReportsController); nothing here ever shows a report back.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
public sealed class SafetyController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ITermsConsentService termsService,
    IReportService reportService,
    IUserBlockService blockService) : ControllerBase
{
    [Juple.Api.Safety.AllowWithoutTermsAcceptance]
    [HttpGet("users/me/terms")]
    public Task<IActionResult> GetTermsAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(userId => termsService.GetStatusAsync(userId, cancellationToken), status => Ok(TermsResponse.From(status)), cancellationToken);

    /// <summary>Records the agreement to the CURRENT version. The version is sent so an old screen can never agree to a newer text.</summary>
    [Juple.Api.Safety.AllowWithoutTermsAcceptance]
    [HttpPost("users/me/terms-acceptance")]
    public Task<IActionResult> AcceptTermsAsync([FromBody] AcceptTermsRequest request, CancellationToken cancellationToken) =>
        request.IsAtLeast14 != true
            ? Task.FromResult<IActionResult>(Juple.Api.Safety.SafetyProblems.Create(
                StatusCodes.Status400BadRequest, "Juple requires confirmation that you are at least 14 years old.", "minimumAgeConfirmationRequired"))
            : !(request.IsLegacyFormat
                ? PublishedTerms.AllowsLegacyRequest(request.Version)
                : PublishedTerms.Matches(request.Version, request.HashText, request.LanguageText))
                ? Task.FromResult<IActionResult>(Juple.Api.Safety.SafetyProblems.Create(
                    StatusCodes.Status400BadRequest, "The displayed published terms must match this consent.", "termsDocumentMismatch"))
                : ExecuteAsync(userId => PublishedTerms.AllowsLegacyRequest(request.Version)
                    ? AcceptHistoricalAsync(userId, request.Version!, cancellationToken)
                    : termsService.AcceptAsync(userId, request.Version, cancellationToken), status => Ok(TermsResponse.From(status)), cancellationToken);

    private async Task<TermsStatusDto> AcceptHistoricalAsync(long userId, string version, CancellationToken cancellationToken)
    {
        var status = await termsService.GetStatusAsync(userId, cancellationToken);
        if (status.CurrentVersion != version || (status.AcceptedVersion is not null && status.AcceptedVersion != version))
            throw new InvalidTermsVersionException();
        // Do not rewrite a previous timestamp or downgrade an existing different-version acceptance.
        return status.IsAccepted ? status : await termsService.AcceptAsync(userId, version, cancellationToken);
    }

    /// <summary>201 for a new report, 200 when this person already has an open report of the same thing (nothing is created twice).</summary>
    [HttpPost("reports")]
    [EnableRateLimiting(RateLimitPolicies.ReportCreate)]
    public Task<IActionResult> CreateReportAsync([FromBody] CreateReportRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => reportService.CreateAsync(userId, new CreateReportCommand(request.TargetType, request.TargetId, request.CollectionId, request.Reason, request.Details), cancellationToken),
            receipt => receipt.AlreadyReported ? Ok(receipt) : StatusCode(StatusCodes.Status201Created, receipt),
            cancellationToken);

    /// <summary>A signed-in visitor of a public link reports the Collection behind it; the public view carries no internal id.</summary>
    [HttpPost("public-shares/{publicId}/reports")]
    [EnableRateLimiting(RateLimitPolicies.ReportCreate)]
    public Task<IActionResult> ReportPublicShareAsync(string publicId, [FromBody] ReportPublicShareRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => reportService.CreateForPublicShareAsync(userId, publicId, request.Reason, request.Details, cancellationToken),
            receipt => receipt.AlreadyReported ? Ok(receipt) : StatusCode(StatusCodes.Status201Created, receipt),
            cancellationToken);

    [HttpPost("users/{jupleId}/block")]
    [EnableRateLimiting(RateLimitPolicies.BlockChange)]
    public Task<IActionResult> BlockAsync(string jupleId, CancellationToken cancellationToken) =>
        ExecuteAsync(async userId => { await blockService.BlockAsync(userId, jupleId, cancellationToken); return true; }, _ => NoContent(), cancellationToken);

    [HttpDelete("users/{jupleId}/block")]
    [EnableRateLimiting(RateLimitPolicies.BlockChange)]
    public Task<IActionResult> UnblockAsync(string jupleId, CancellationToken cancellationToken) =>
        ExecuteAsync(async userId => { await blockService.UnblockAsync(userId, jupleId, cancellationToken); return true; }, _ => NoContent(), cancellationToken);

    [HttpGet("users/me/blocked-users")]
    public Task<IActionResult> ListBlockedAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(userId => blockService.ListAsync(userId, cancellationToken), items => Ok(new BlockedUsersResponse(items)), cancellationToken);

    private async Task<IActionResult> ExecuteAsync<TResult>(Func<long, Task<TResult>> action, Func<TResult, IActionResult> success, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), cancellationToken);
            return success(await action(currentUser.UserId));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Juple user bootstrap is required.");
        }
        catch (InvalidTermsVersionException)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]> { ["version"] = ["version is not the current Terms version."] }));
        }
        catch (InvalidReportException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]> { [exception.Field] = [exception.Message] }));
        }
        catch (ReportTypeNotAcceptedException)
        {
            return SafetyProblems.Create(StatusCodes.Status400BadRequest, "A whole Collection can no longer be reported. Report a link or a person instead.", "reportTypeNotAccepted");
        }
        catch (ReportOwnContentException)
        {
            return SafetyProblems.Create(StatusCodes.Status400BadRequest, "You cannot report your own content.", "cannotReportOwnContent");
        }
        catch (ReportTargetNotFoundException)
        {
            return NotFound();
        }
        catch (JupleIdNotFoundException)
        {
            return NotFound();
        }
        catch (InvalidBlockException exception)
        {
            return SafetyProblems.Create(StatusCodes.Status400BadRequest, exception.Message, "cannotBlockSelf");
        }
    }

    [method: JsonConstructor]
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    public sealed record AcceptTermsRequest(string? Version, bool? IsAtLeast14 = null, JsonElement ContentHash = default, JsonElement Language = default)
    {
        // Undefined is absent. Explicit null, a partial modern request or a wrong JSON type must not downgrade to legacy.
        [JsonIgnore] public bool IsLegacyFormat => ContentHash.ValueKind == JsonValueKind.Undefined && Language.ValueKind == JsonValueKind.Undefined;
        [JsonIgnore] public string? HashText => ContentHash.ValueKind == JsonValueKind.String ? ContentHash.GetString() : null;
        [JsonIgnore] public string? LanguageText => Language.ValueKind == JsonValueKind.String ? Language.GetString() : null;

        public AcceptTermsRequest(string? version, bool? age, string? hash, string? language = null)
            : this(version, age, JsonSerializer.SerializeToElement(hash), JsonSerializer.SerializeToElement(language)) { }
    }

    public sealed record TermsResponse(string CurrentVersion, string? AcceptedVersion, DateTimeOffset? AcceptedAtUtc, bool IsAccepted, bool EnforceAcceptance)
    {
        public static TermsResponse From(TermsStatusDto status) => new(status.CurrentVersion, status.AcceptedVersion, status.AcceptedAtUtc, status.IsAccepted, status.EnforceAcceptance);
    }

    /// <summary>TargetType: User | Collection | Item | Comment. TargetId: the Juple ID of a user, otherwise the numeric id. CollectionId is required for an Item (the Collection it is seen through).</summary>
    public sealed record CreateReportRequest(string? TargetType, string? TargetId, long? CollectionId, string? Reason, string? Details);

    public sealed record ReportPublicShareRequest(string? Reason, string? Details);

    public sealed record BlockedUsersResponse(IReadOnlyList<BlockedUserDto> Items);
}
