using Juple.Api.Authentication;
using Juple.Api.RepeatPurchases;
using Juple.Application.Identity;
using Juple.Application.Items;
using Juple.Application.Purchases;
using Juple.Application.RepeatPurchases;
using Juple.Application.RepeatPurchases.CreateRepeatPurchase;
using Juple.Application.RepeatPurchases.DeleteRepeatPurchase;
using Juple.Application.RepeatPurchases.GetRepeatPurchaseDetail;
using Juple.Application.RepeatPurchases.ListRepeatPurchases;
using Juple.Application.RepeatPurchases.LogPurchase;
using Juple.Application.RepeatPurchases.RepeatPurchaseStateTransition;
using Juple.Application.RepeatPurchases.UpdateRepeatPurchase;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/repeat-purchases")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class RepeatPurchasesController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IListRepeatPurchasesService listRepeatPurchasesService,
    IGetRepeatPurchaseDetailService getRepeatPurchaseDetailService,
    ICreateRepeatPurchaseService createRepeatPurchaseService,
    IUpdateRepeatPurchaseService updateRepeatPurchaseService,
    IRepeatPurchaseStateTransitionService repeatPurchaseStateTransitionService,
    IDeleteRepeatPurchaseService deleteRepeatPurchaseService,
    ILogPurchaseService logPurchaseService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> ListAsync(
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        [FromQuery] long? itemId,
        [FromQuery] string? includeDisabled,
        CancellationToken cancellationToken)
    {
        if (!RepeatPurchasesQueryParameters.TryParseLimit(limit, out var resolvedLimit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["limit"] = [
                    $"limit must be between {RepeatPurchasesQueryParameters.MinLimit} and {RepeatPurchasesQueryParameters.MaxLimit}.",
                ],
            }));
        }

        RepeatPurchasePageCursor? typedCursor = null;
        if (cursor is not null && !RepeatPurchasePageCursorCodec.TryDecode(cursor, out typedCursor))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["cursor"] = ["cursor is invalid."],
            }));
        }

        if (!RepeatPurchasesQueryParameters.TryParseItemId(itemId, out var resolvedItemId))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["itemId"] = ["itemId must be a positive number."],
            }));
        }

        var resolvedIncludeDisabled = RepeatPurchasesQueryParameters.ParseIncludeDisabled(includeDisabled);

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var page = await listRepeatPurchasesService.ListAsync(
                currentUser.UserId, typedCursor, resolvedLimit, resolvedItemId, resolvedIncludeDisabled,
                cancellationToken);

            return Ok(new RepeatPurchasesPageResponse(
                page.RepeatPurchases.Select(ToResponse).ToList(),
                page.NextCursor is { } nextCursor ? RepeatPurchasePageCursorCodec.Encode(nextCursor) : null));
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

    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetDetailAsync(long id, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var repeatPurchase = await getRepeatPurchaseDetailService.GetAsync(
                currentUser.UserId, id, cancellationToken);

            return Ok(ToResponse(repeatPurchase));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (RepeatPurchaseNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPost]
    public async Task<IActionResult> CreateAsync(
        CreateRepeatPurchaseRequest request,
        CancellationToken cancellationToken)
    {
        if (!IntervalUnitWireFormat.TryParse(request.IntervalUnit, out var intervalUnit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["intervalUnit"] = ["intervalUnit must be 'day', 'week', or 'month'."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var created = await createRepeatPurchaseService.CreateAsync(
                currentUser.UserId,
                new CreateRepeatPurchaseCommand(
                    request.ItemId,
                    request.ProductName,
                    request.IntervalValue,
                    intervalUnit,
                    request.NextPurchaseDate,
                    request.IsReminderEnabled,
                    request.ReminderLeadDays),
                cancellationToken);

            return Created($"/api/v1/repeat-purchases/{created.Id}", ToResponse(created));
        }
        catch (InvalidRepeatPurchaseException exception)
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
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> UpdateAsync(
        long id,
        UpdateRepeatPurchaseRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(request.Version) ||
            !RepeatPurchaseVersionCodec.TryDecode(request.Version, out var expectedVersion))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["version"] = ["version is required and must be a valid version token."],
            }));
        }

        if (!IntervalUnitWireFormat.TryParse(request.IntervalUnit, out var intervalUnit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["intervalUnit"] = ["intervalUnit must be 'day', 'week', or 'month'."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var updated = await updateRepeatPurchaseService.UpdateAsync(
                currentUser.UserId,
                id,
                new UpdateRepeatPurchaseCommand(
                    request.ItemId,
                    request.ProductName,
                    request.IntervalValue,
                    intervalUnit,
                    request.NextPurchaseDate,
                    request.IsReminderEnabled,
                    request.ReminderLeadDays),
                expectedVersion!,
                cancellationToken);

            // Returns the full updated resource (not 204) so the client always has the new version
            // on hand and is never forced into a follow-up GET just to keep editing.
            return Ok(ToResponse(updated));
        }
        catch (InvalidRepeatPurchaseException exception)
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
        catch (RepeatPurchaseNotFoundException)
        {
            return NotFound();
        }
        catch (ItemNotFoundException)
        {
            return NotFound();
        }
        catch (RepeatPurchaseConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The RepeatPurchase was modified concurrently.");
        }
    }

    [HttpPost("{id:long}/enable")]
    public Task<IActionResult> EnableAsync(long id, CancellationToken cancellationToken) =>
        StateTransitionAsync(
            userId => repeatPurchaseStateTransitionService.EnableAsync(userId, id, cancellationToken),
            cancellationToken);

    [HttpPost("{id:long}/disable")]
    public Task<IActionResult> DisableAsync(long id, CancellationToken cancellationToken) =>
        StateTransitionAsync(
            userId => repeatPurchaseStateTransitionService.DisableAsync(userId, id, cancellationToken),
            cancellationToken);

    [HttpDelete("{id:long}")]
    public Task<IActionResult> DeleteAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => deleteRepeatPurchaseService.DeleteAsync(userId, id, cancellationToken),
            cancellationToken);

    [HttpPost("{id:long}/log-purchase")]
    public async Task<IActionResult> LogPurchaseAsync(
        long id,
        LogPurchaseRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(request.Version) ||
            !RepeatPurchaseVersionCodec.TryDecode(request.Version, out var expectedVersion))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["version"] = ["version is required and must be a valid version token."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var result = await logPurchaseService.LogAsync(
                currentUser.UserId,
                id,
                new LogPurchaseCommand(
                    request.PurchaseDate,
                    request.Amount,
                    request.CurrencyCode,
                    request.Store,
                    request.Variant,
                    request.Quantity,
                    request.Memo),
                expectedVersion!,
                cancellationToken);

            // Both the newly-logged Purchase and the RepeatPurchase's advanced schedule reflect the
            // same committed transaction - never a partial result (see ILogPurchaseStore.LogAsync).
            return Ok(new LogPurchaseResponse(
                PurchasesController.ToResponse(result.Purchase), ToResponse(result.RepeatPurchase)));
        }
        catch (InvalidPurchaseException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
        catch (InvalidRepeatPurchaseException exception)
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
        catch (RepeatPurchaseNotFoundException)
        {
            return NotFound();
        }
        catch (ItemNotFoundException)
        {
            return NotFound();
        }
        catch (RepeatPurchaseConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The RepeatPurchase was modified concurrently.");
        }
    }

    // Enable/Disable change RowVersion/UpdatedAtUtc (except on an idempotent no-op call, where
    // both stay exactly as they were), so - like Update - they return 200 with the current DTO
    // instead of 204: the client never ends up holding a version that went stale the instant its
    // own state-change call committed.
    private async Task<IActionResult> StateTransitionAsync(
        Func<long, Task<RepeatPurchaseDto>> transition,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var updated = await transition(currentUser.UserId);
            return Ok(ToResponse(updated));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (RepeatPurchaseNotFoundException)
        {
            return NotFound();
        }
        catch (RepeatPurchaseConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The RepeatPurchase was modified concurrently.");
        }
    }

    private async Task<IActionResult> TransitionAsync(
        Func<long, Task> transition,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await transition(currentUser.UserId);
            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (RepeatPurchaseNotFoundException)
        {
            return NotFound();
        }
        catch (RepeatPurchaseConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The RepeatPurchase was modified concurrently.");
        }
    }

    private static RepeatPurchaseResponse ToResponse(RepeatPurchaseDto repeatPurchase) => new(
        repeatPurchase.Id,
        repeatPurchase.ItemId,
        repeatPurchase.ProductName,
        repeatPurchase.IntervalValue,
        IntervalUnitWireFormat.ToWireValue(repeatPurchase.IntervalUnit),
        repeatPurchase.NextPurchaseDate,
        repeatPurchase.IsReminderEnabled,
        repeatPurchase.ReminderLeadDays,
        repeatPurchase.IsEnabled,
        repeatPurchase.CreatedAtUtc,
        repeatPurchase.UpdatedAtUtc,
        RepeatPurchaseVersionCodec.Encode(repeatPurchase.Version));

    public sealed record RepeatPurchaseResponse(
        long Id,
        long? ItemId,
        string ProductName,
        int IntervalValue,
        string IntervalUnit,
        DateOnly NextPurchaseDate,
        bool IsReminderEnabled,
        int ReminderLeadDays,
        bool IsEnabled,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset UpdatedAtUtc,
        string Version);

    public sealed record RepeatPurchasesPageResponse(
        IReadOnlyList<RepeatPurchaseResponse> RepeatPurchases, string? NextCursor);

    public sealed record CreateRepeatPurchaseRequest(
        long? ItemId,
        string? ProductName,
        int? IntervalValue,
        string? IntervalUnit,
        DateOnly? NextPurchaseDate,
        bool IsReminderEnabled,
        int ReminderLeadDays);

    public sealed record UpdateRepeatPurchaseRequest(
        string? Version,
        long? ItemId,
        string? ProductName,
        int? IntervalValue,
        string? IntervalUnit,
        DateOnly? NextPurchaseDate,
        bool IsReminderEnabled,
        int ReminderLeadDays);

    // No ItemId/ProductName/RepeatPurchaseId fields - the client never supplies them for
    // log-purchase, only the Purchase-specific fields (see LogPurchaseCommand).
    public sealed record LogPurchaseRequest(
        string? Version,
        DateOnly? PurchaseDate,
        string? Amount,
        string? CurrencyCode,
        string? Store,
        string? Variant,
        string? Quantity,
        string? Memo);

    public sealed record LogPurchaseResponse(
        PurchasesController.PurchaseResponse Purchase, RepeatPurchaseResponse RepeatPurchase);
}
