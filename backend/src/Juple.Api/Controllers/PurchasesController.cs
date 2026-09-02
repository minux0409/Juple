using Juple.Api.Authentication;
using Juple.Api.Purchases;
using Juple.Application.Identity;
using Juple.Application.Items;
using Juple.Application.Purchases;
using Juple.Application.Purchases.CreatePurchase;
using Juple.Application.Purchases.DeletePurchase;
using Juple.Application.Purchases.GetPurchaseDetail;
using Juple.Application.Purchases.ListPurchases;
using Juple.Application.Purchases.UpdatePurchase;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/purchases")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class PurchasesController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IListPurchasesService listPurchasesService,
    IGetPurchaseDetailService getPurchaseDetailService,
    ICreatePurchaseService createPurchaseService,
    IUpdatePurchaseService updatePurchaseService,
    IDeletePurchaseService deletePurchaseService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> ListAsync(
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken)
    {
        if (!PurchasesQueryParameters.TryParseLimit(limit, out var resolvedLimit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["limit"] = [
                    $"limit must be between {PurchasesQueryParameters.MinLimit} and {PurchasesQueryParameters.MaxLimit}.",
                ],
            }));
        }

        PurchasePageCursor? typedCursor = null;
        if (cursor is not null && !PurchasePageCursorCodec.TryDecode(cursor, out typedCursor))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["cursor"] = ["cursor is invalid."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var page = await listPurchasesService.ListAsync(
                currentUser.UserId, typedCursor, resolvedLimit, cancellationToken);

            return Ok(new PurchasesPageResponse(
                page.Purchases.Select(ToResponse).ToList(),
                page.NextCursor is { } nextCursor ? PurchasePageCursorCodec.Encode(nextCursor) : null));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetDetailAsync(long id, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var purchase = await getPurchaseDetailService.GetAsync(currentUser.UserId, id, cancellationToken);

            return Ok(ToResponse(purchase));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (PurchaseNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPost]
    public async Task<IActionResult> CreateAsync(
        CreatePurchaseRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var purchase = await createPurchaseService.CreateAsync(
                currentUser.UserId,
                new CreatePurchaseCommand(
                    request.ItemId,
                    request.ProductName,
                    request.PurchaseDate,
                    request.Amount,
                    request.CurrencyCode,
                    request.Store,
                    request.Variant,
                    request.Quantity,
                    request.Memo),
                cancellationToken);

            return Created($"/api/v1/purchases/{purchase.Id}", ToResponse(purchase));
        }
        catch (InvalidPurchaseException exception)
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
    public Task<IActionResult> UpdateAsync(
        long id,
        UpdatePurchaseRequest request,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => updatePurchaseService.UpdateAsync(
                userId,
                id,
                new UpdatePurchaseCommand(
                    request.ItemId,
                    request.ProductName,
                    request.PurchaseDate,
                    request.Amount,
                    request.CurrencyCode,
                    request.Store,
                    request.Variant,
                    request.Quantity,
                    request.Memo),
                cancellationToken),
            cancellationToken);

    [HttpDelete("{id:long}")]
    public Task<IActionResult> DeleteAsync(long id, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => deletePurchaseService.DeleteAsync(userId, id, cancellationToken),
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
        catch (InvalidPurchaseException exception)
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
        catch (PurchaseNotFoundException)
        {
            return NotFound();
        }
        catch (ItemNotFoundException)
        {
            return NotFound();
        }
    }

    private static PurchaseResponse ToResponse(PurchaseDto purchase) => new(
        purchase.Id,
        purchase.ItemId,
        purchase.ProductName,
        purchase.PurchaseDate,
        PurchaseDecimalFormat.Format(purchase.Amount),
        purchase.CurrencyCode,
        purchase.Store,
        purchase.Variant,
        PurchaseDecimalFormat.Format(purchase.Quantity),
        purchase.Memo,
        purchase.CreatedAtUtc);

    // Amount/Quantity are wire strings, never decimal/double, so a value like
    // 999999999999999.9999 - valid in decimal(19,4) but not exactly representable as a JS Number -
    // never loses precision crossing the JSON boundary in either direction. See
    // PurchaseFieldsNormalizer (request parsing) and PurchaseDecimalFormat (response formatting).
    public sealed record PurchaseResponse(
        long Id,
        long? ItemId,
        string ProductName,
        DateOnly PurchaseDate,
        string? Amount,
        string? CurrencyCode,
        string? Store,
        string? Variant,
        string? Quantity,
        string? Memo,
        DateTimeOffset CreatedAtUtc);

    public sealed record PurchasesPageResponse(IReadOnlyList<PurchaseResponse> Purchases, string? NextCursor);

    public sealed record CreatePurchaseRequest(
        long? ItemId,
        string? ProductName,
        DateOnly? PurchaseDate,
        string? Amount,
        string? CurrencyCode,
        string? Store,
        string? Variant,
        string? Quantity,
        string? Memo);

    public sealed record UpdatePurchaseRequest(
        long? ItemId,
        string? ProductName,
        DateOnly? PurchaseDate,
        string? Amount,
        string? CurrencyCode,
        string? Store,
        string? Variant,
        string? Quantity,
        string? Memo);
}
