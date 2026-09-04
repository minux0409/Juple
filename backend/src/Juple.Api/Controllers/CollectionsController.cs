using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Application.Collections;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.CreateCollection;
using Juple.Application.Collections.DeleteCollection;
using Juple.Application.Collections.GetCollectionDetail;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Collections.RenameCollection;
using Juple.Application.Collections.SetCollectionFavorite;
using Juple.Application.Identity;
using Juple.Application.Items;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/collections")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class CollectionsController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IListCollectionsService listCollectionsService,
    ICreateCollectionService createCollectionService,
    IGetCollectionDetailService getCollectionDetailService,
    IRenameCollectionService renameCollectionService,
    ISetCollectionFavoriteService setCollectionFavoriteService,
    IDeleteCollectionService deleteCollectionService,
    IGetCollectionItemsService getCollectionItemsService,
    IAddItemToCollectionService addItemToCollectionService,
    IRemoveItemFromCollectionService removeItemFromCollectionService) : ControllerBase
{
    /// <summary>
    /// Cursor-paginated - Collection is a growing user data set (production API, never unbounded),
    /// same limit/cursor conventions as GET /api/v1/items/history, its own CollectionPageCursorCodec.
    /// itemId and excludeItemId are mutually exclusive optional filters composed with that same
    /// pagination (see CollectionsQueryParameters.TryParseItemId, reused for both), never a resource
    /// lookup: itemId restricts to Collections that already contain that Item (ItemDetails'
    /// "이 항목이 들어있는 보관함" section); excludeItemId restricts to Collections that do NOT yet
    /// contain it (the "보관함에 추가" modal - server-side, so a Collection the Item already belongs
    /// to can never resurface as a candidate on any page, unlike filtering client-side against a
    /// separately-paginated membership list). Sending both is a 400, not a silently-picked winner.
    /// The generated SQL for the ItemCount projection below is a single query with a correlated
    /// COUNT(*) subquery per row (observed via EF's SQL logging) - not an N+1 - e.g.:
    /// SELECT [c].[Id], [c].[Name], (SELECT COUNT(*) FROM [collections].[CollectionItems] AS [c0]
    /// WHERE [c0].[CollectionId] = [c].[Id]), [c].[CreatedAtUtc], [c].[UpdatedAtUtc]
    /// FROM [collections].[Collections] AS [c] WHERE [c].[UserId] = @userId ...
    /// excludeItemId composes the same way (a NOT EXISTS predicate, also a single query).
    /// isFavorite is a third, independent filter (the Collections list's "즐겨찾는 보관함" section) -
    /// unlike itemId/excludeItemId it has no mutual-exclusivity rule and freely composes with
    /// either of them.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListAsync(
        [FromQuery] long? itemId,
        [FromQuery] long? excludeItemId,
        [FromQuery] bool? isFavorite,
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken)
    {
        if (!CollectionsQueryParameters.TryParseItemId(itemId, out var resolvedItemId))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["itemId"] = ["itemId must be a positive number."],
            }));
        }

        if (!CollectionsQueryParameters.TryParseItemId(excludeItemId, out var resolvedExcludeItemId))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["excludeItemId"] = ["excludeItemId must be a positive number."],
            }));
        }

        if (resolvedItemId is not null && resolvedExcludeItemId is not null)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["itemId"] = ["itemId and excludeItemId cannot both be specified."],
            }));
        }

        if (!CollectionsQueryParameters.TryParseLimit(limit, out var resolvedLimit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["limit"] = [
                    $"limit must be between {CollectionsQueryParameters.MinLimit} and {CollectionsQueryParameters.MaxLimit}.",
                ],
            }));
        }

        CollectionPageCursor? typedCursor = null;
        if (cursor is not null && !CollectionPageCursorCodec.TryDecode(cursor, out typedCursor))
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
            var page = await listCollectionsService.ListAsync(
                currentUser.UserId, resolvedItemId, resolvedExcludeItemId, isFavorite, typedCursor, resolvedLimit, cancellationToken);

            return Ok(new CollectionsResponse(
                page.Items,
                page.NextCursor is { } nextCursor ? CollectionPageCursorCodec.Encode(nextCursor) : null));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    [HttpPost]
    public async Task<IActionResult> CreateAsync(CreateCollectionRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var collection = await createCollectionService.CreateAsync(
                currentUser.UserId, new CreateCollectionCommand(request.Name), cancellationToken);

            return Created($"/api/v1/collections/{collection.Id}", collection);
        }
        catch (InvalidCollectionException exception)
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
        catch (CollectionNameConflictException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "A Collection with this name already exists.");
        }
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetAsync(long id, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var collection = await getCollectionDetailService.GetAsync(currentUser.UserId, id, cancellationToken);

            return Ok(collection);
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CollectionNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPut("{id:long}")]
    public Task<IActionResult> RenameAsync(
        long id,
        RenameCollectionRequest request,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => renameCollectionService.RenameAsync(
                userId, id, new RenameCollectionCommand(request.Name), cancellationToken),
            cancellationToken);

    /// <summary>
    /// No client-supplied version, same as RenameAsync above - EF's own RowVersion concurrency
    /// check on the store's read-then-save covers a concurrent Rename/SetFavorite race on the same
    /// Collection (whichever save lands second gets 409, never a silent lost update). Returns the
    /// latest CollectionDto (not 204 like Rename/Delete) so the caller can reconcile its optimistic
    /// UI state - e.g. ItemCount/UpdatedAtUtc - against the server's actual result in one round trip.
    /// </summary>
    [HttpPut("{id:long}/favorite")]
    public async Task<IActionResult> SetFavoriteAsync(
        long id,
        SetCollectionFavoriteRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var collection = await setCollectionFavoriteService.SetFavoriteAsync(
                currentUser.UserId, id, new SetCollectionFavoriteCommand(request.IsFavorite), cancellationToken);

            return Ok(collection);
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CollectionNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The Collection was modified concurrently.");
        }
    }

    [HttpDelete("{id:long}")]
    public Task<IActionResult> DeleteAsync(long id, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => deleteCollectionService.DeleteAsync(userId, id, cancellationToken),
            cancellationToken);

    /// <summary>
    /// A day's/Collection's worth of Items is unbounded, so this is always cursor-paginated - the
    /// same limit/cursor conventions and page-boundary keyset semantics as GET
    /// /api/v1/items/history, just with its own CollectionItemPageCursorCodec.
    /// </summary>
    [HttpGet("{id:long}/items")]
    public async Task<IActionResult> GetItemsAsync(
        long id,
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken)
    {
        if (!CollectionsQueryParameters.TryParseLimit(limit, out var resolvedLimit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["limit"] = [
                    $"limit must be between {CollectionsQueryParameters.MinLimit} and {CollectionsQueryParameters.MaxLimit}.",
                ],
            }));
        }

        CollectionItemPageCursor? typedCursor = null;
        if (cursor is not null && !CollectionItemPageCursorCodec.TryDecode(cursor, out typedCursor))
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
            var page = await getCollectionItemsService.GetAsync(
                currentUser.UserId, id, typedCursor, resolvedLimit, cancellationToken);

            return Ok(new CollectionItemsPageResponse(
                page.Items,
                page.NextCursor is { } nextCursor ? CollectionItemPageCursorCodec.Encode(nextCursor) : null));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CollectionNotFoundException)
        {
            return NotFound();
        }
    }

    /// <summary>Idempotent - adding an Item already in the Collection resolves on 204 too (see AddItemToCollectionService).</summary>
    [HttpPut("{id:long}/items/{itemId:long}")]
    public Task<IActionResult> AddItemAsync(long id, long itemId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => addItemToCollectionService.AddAsync(userId, id, itemId, cancellationToken),
            cancellationToken);

    /// <summary>Idempotent - resolves on 204 whether or not the Item was actually in the Collection.</summary>
    [HttpDelete("{id:long}/items/{itemId:long}")]
    public Task<IActionResult> RemoveItemAsync(long id, long itemId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => removeItemFromCollectionService.RemoveAsync(userId, id, itemId, cancellationToken),
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
        catch (InvalidCollectionException exception)
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
        catch (CollectionNotFoundException)
        {
            return NotFound();
        }
        catch (ItemNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionNameConflictException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "A Collection with this name already exists.");
        }
        catch (CollectionConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The Collection was modified concurrently.");
        }
    }

    public sealed record CreateCollectionRequest(string? Name);

    public sealed record RenameCollectionRequest(string? Name);

    public sealed record SetCollectionFavoriteRequest(bool IsFavorite);

    public sealed record CollectionsResponse(IReadOnlyList<CollectionDto> Items, string? NextCursor);

    public sealed record CollectionItemsPageResponse(IReadOnlyList<CollectionItemEntryDto> Items, string? NextCursor);
}
