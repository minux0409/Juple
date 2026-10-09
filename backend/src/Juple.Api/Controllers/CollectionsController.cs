using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Domain.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.CreateCollection;
using Juple.Application.Collections.DeleteCollection;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.GetCollectionDetail;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.GetCollectionShare;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.MoveCollectionItem;
using Juple.Application.Collections.MergeCollections;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Collections.RenameCollection;
using Juple.Application.Collections.RevokeCollectionShare;
using Juple.Application.Collections.RestoreCollection;
using Juple.Application.Collections.SetCollectionColor;
using Juple.Application.Collections.SetCollectionFavorite;
using Juple.Application.Collections.SetCollectionIcon;
using Juple.Application.Collections.SetCollectionIconImage;
using Juple.Application.Collections.SharePassword;
using Juple.Application.Collections.Submissions;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Collections.TransferCollectionItem;
using Juple.Application.Collections.UndoMergeCollections;
using Juple.Application.Collections.UndoTransferCollectionItem;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

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
    ISetCollectionIconService setCollectionIconService,
    ISetCollectionColorService setCollectionColorService,
    IDeleteCollectionService deleteCollectionService,
    IRestoreCollectionService restoreCollectionService,
    IGetCollectionItemsService getCollectionItemsService,
    IAddItemToCollectionService addItemToCollectionService,
    IRemoveItemFromCollectionService removeItemFromCollectionService,
    IMoveCollectionItemService moveCollectionItemService,
    ITransferCollectionItemService transferCollectionItemService,
    IUndoTransferCollectionItemService undoTransferCollectionItemService,
    IMergeCollectionsService mergeCollectionsService,
    IUndoMergeCollectionsService undoMergeCollectionsService,
    IEnableCollectionShareService enableCollectionShareService,
    IGetCollectionShareService getCollectionShareService,
    IRevokeCollectionShareService revokeCollectionShareService,
    IOptions<PublicWebOptions> publicWebOptions) : ControllerBase
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
    /// <remarks>
    /// scope selects which accessible Collections to list: "owned" (내 컬렉션), "shared" (공유
    /// 컬렉션: shared with the caller, plus the caller's own currently-shared ones - see
    /// CollectionListScope.Shared), "all" (owned + shared with the caller, one server-side ordering - the
    /// Categories screen's default filter) or "favorites" (both, only the caller's own favorite
    /// marks). Omitting scope keeps its original meaning, owned, so existing callers (the Direct
    /// Share category snapshot, older app versions) are unchanged. Each row carries an explicit
    /// accessRole and the caller's own isFavorite, so clients never infer either themselves.
    /// </remarks>
    [HttpGet]
    public async Task<IActionResult> ListAsync(
        [FromQuery] long? itemId,
        [FromQuery] long? excludeItemId,
        [FromQuery] bool? isFavorite,
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken,
        [FromQuery] string? scope = null)
    {
        CollectionListScope resolvedScope;
        switch (scope)
        {
            case null or "owned":
                resolvedScope = CollectionListScope.Owned;
                break;
            case "shared":
                resolvedScope = CollectionListScope.Shared;
                break;
            case "all":
                resolvedScope = CollectionListScope.All;
                break;
            case "favorites":
                resolvedScope = CollectionListScope.Favorites;
                break;
            case "myPending":
                resolvedScope = CollectionListScope.MyPending;
                break;
            default:
                return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
                {
                    ["scope"] = ["scope must be 'owned', 'shared', 'all', 'favorites' or 'myPending'."],
                }));
        }

        // The legacy isFavorite filter only ever applied to owned Collections; the other scopes
        // express it through scope=favorites instead.
        if (resolvedScope != CollectionListScope.Owned && isFavorite is not null)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["isFavorite"] = ["isFavorite only applies to scope 'owned' - use scope 'favorites'."],
            }));
        }

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
            var page = resolvedScope == CollectionListScope.Owned
                ? await listCollectionsService.ListAsync(
                    currentUser.UserId, resolvedItemId, resolvedExcludeItemId, isFavorite, typedCursor, resolvedLimit, cancellationToken)
                : await listCollectionsService.ListByScopeAsync(
                    currentUser.UserId, resolvedScope, resolvedItemId, resolvedExcludeItemId, typedCursor, resolvedLimit, cancellationToken);

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
                currentUser.UserId,
                new CreateCollectionCommand(request.Name, request.Icon, request.Color),
                cancellationToken);

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
    [CollectionPermission(CollectionPermission.Edit, requireUnlock: true)]
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
    [CollectionPermission(CollectionPermission.Favorite)]
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

    /// <summary>Same shape as SetFavoriteAsync above (returns the latest CollectionDto, no client-supplied version).</summary>
    [HttpPut("{id:long}/icon")]
    [CollectionPermission(CollectionPermission.Edit, requireUnlock: true)]
    public async Task<IActionResult> SetIconAsync(
        long id,
        SetCollectionIconRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var collection = await setCollectionIconService.SetIconAsync(
                currentUser.UserId, id, new SetCollectionIconCommand(request.Icon), cancellationToken);

            return Ok(collection);
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
        catch (CollectionConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The Collection was modified concurrently.");
        }
    }

    /// <summary>Same shape as SetIconAsync above (returns the latest CollectionDto, no client-supplied version).</summary>
    [HttpPut("{id:long}/color")]
    [CollectionPermission(CollectionPermission.Edit, requireUnlock: true)]
    public async Task<IActionResult> SetColorAsync(
        long id,
        SetCollectionColorRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var collection = await setCollectionColorService.SetColorAsync(
                currentUser.UserId, id, new SetCollectionColorCommand(request.Color), cancellationToken);

            return Ok(collection);
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
        catch (CollectionConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The Collection was modified concurrently.");
        }
    }

    /// <summary>
    /// The Owner's photo as this Collection's icon (multipart field "file"; JPEG/PNG/WebP by magic
    /// bytes, at most 5MB - the app sends a ~512px resize). Replaces any previous photo; the
    /// built-in icon stays as the fallback. Same Owner-only + unlock gate as the icon/color edits.
    /// Returns the updated CollectionDto (with a fresh IconImageUrl).
    /// </summary>
    [HttpPut("{id:long}/icon-image")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    [CollectionPermission(CollectionPermission.Edit, requireUnlock: true)]
    public async Task<IActionResult> SetIconImageAsync(
        long id,
        IFormFile? file,
        [FromServices] ISetCollectionIconImageService setCollectionIconImageService,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            // Only the file's own bytes are used - never its client-supplied name or Content-Type.
            byte[]? content = null;
            if (file is not null && file.Length > 0)
            {
                using var memoryStream = new MemoryStream();
                await file.CopyToAsync(memoryStream, cancellationToken);
                content = memoryStream.ToArray();
            }

            return Ok(await setCollectionIconImageService.UploadAsync(currentUser.UserId, id, content, cancellationToken));
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
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Juple user bootstrap is required.");
        }
        catch (CollectionNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionConcurrencyException)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "The Collection was modified concurrently.");
        }
    }

    /// <summary>Back to the built-in icon (idempotent). Returns the updated CollectionDto.</summary>
    [HttpDelete("{id:long}/icon-image")]
    [CollectionPermission(CollectionPermission.Edit, requireUnlock: true)]
    public async Task<IActionResult> RemoveIconImageAsync(
        long id,
        [FromServices] ISetCollectionIconImageService setCollectionIconImageService,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return Ok(await setCollectionIconImageService.RemoveAsync(currentUser.UserId, id, cancellationToken));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Juple user bootstrap is required.");
        }
        catch (CollectionNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionConcurrencyException)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "The Collection was modified concurrently.");
        }
    }

    [HttpDelete("{id:long}")]
    [CollectionPermission(CollectionPermission.Delete, requireUnlock: true)]
    public Task<IActionResult> DeleteAsync(long id, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => deleteCollectionService.DeleteAsync(userId, id, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Idempotent - if this Collection already has an active share, returns that same one (same
    /// PublicId, same ShareUrl) rather than minting a new link. The 1:1 CollectionDto-reuse-ban
    /// from the public side applies here too, just in reverse: CollectionShareResponse is never
    /// reused by the anonymous side. Optional body { permission: "read" | "write" } (absent = read)
    /// applies only when a new link is created.
    /// </summary>
    [HttpPost("{id:long}/share")]
    [CollectionPermission(CollectionPermission.ManageShare, requireUnlock: true)]
    public async Task<IActionResult> EnableShareAsync(
        long id,
        CancellationToken cancellationToken,
        [FromBody] SetSharePermissionRequest? request = null)
    {
        var permission = Juple.Domain.Collections.CollectionSharePermission.Read;
        if (request?.Permission is not null && !PublicSharePermissions.TryParse(request.Permission, out permission))
        {
            return InvalidSharePermission();
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var share = await enableCollectionShareService.EnableAsync(
                currentUser.UserId, id, permission, request?.RaiseLowerRoles == true, cancellationToken);
            return Ok(ToShareResponse(share));
        }
        catch (CollectionCollaborationConflictException exception)
        {
            return CollectionProblems.Conflict(exception.Code);
        }
        catch (CollectionConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The Collection was modified concurrently.");
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

    /// <summary>Share is null (not a 404) when the Collection is owned but currently unshared - a valid, common state.</summary>
    [HttpGet("{id:long}/share")]
    [CollectionPermission(CollectionPermission.ManageShare)]
    public async Task<IActionResult> GetShareAsync(long id, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var share = await getCollectionShareService.GetAsync(currentUser.UserId, id, cancellationToken);
            return Ok(new CollectionShareStatusResponse(
                share is not null, share is null ? null : ToShareResponse(share)));
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

    /// <summary>
    /// The active 모든 사용자 link, for anyone who may view the Collection - an accepted Contributor or
    /// Viewer passes on the link the Owner already made public. Read-only and minimal: whether the
    /// link is on, and its canonical URL. Never its permission, the share password or any other
    /// share setting (those stay behind ManageShare above); a pending invitee or anyone else gets
    /// 404 like every other read. Metadata like the card, so no unlock grant: anyone opening the
    /// URL still meets the Collection's own password gate.
    /// </summary>
    [HttpGet("{id:long}/share/link")]
    public Task<IActionResult> GetShareLinkAsync(
        long id,
        [FromServices] IGetCollectionShareLinkService shareLinkService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => shareLinkService.GetActivePublicIdAsync(userId, id, cancellationToken),
            publicId => Ok(new CollectionShareLinkResponse(publicId is not null, publicId is null ? null : ShareUrlFor(publicId))),
            cancellationToken);

    /// <summary>
    /// 친구에게 / ID로 공유: passes the Collection's public link on to these Juple users (at most
    /// ShareCollectionLinkService.MaxRecipientsPerShare) as a Juple notification - never an
    /// invitation or a membership. Anyone who may view the Collection; the public link must still be
    /// on right now (409 publicLinkInactive otherwise, and nobody is sent anything). Unknown or
    /// malformed IDs come back in notFound; one's own ID is skipped.
    /// </summary>
    [HttpPost("{id:long}/share/link/send")]
    [EnableRateLimiting(RateLimitPolicies.CollectionInvite)]
    public Task<IActionResult> SendShareLinkAsync(
        long id,
        SendShareLinkRequest request,
        [FromServices] Juple.Application.Collections.ShareLink.IShareCollectionLinkService shareLinkService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => shareLinkService.ShareAsync(userId, id, request.JupleIds, cancellationToken),
            result => Ok(new SendShareLinkResponse(result.Sent, result.NotFound)),
            cancellationToken);

    /// <summary>
    /// Idempotent - revoking an already-unshared Collection resolves on 204 too. The revoked
    /// PublicId is never reactivated by a later EnableShareAsync call (see
    /// CollectionShareStore.EnableAsync, which always mints a fresh one when no active row exists).
    /// </summary>
    [HttpDelete("{id:long}/share")]
    [CollectionPermission(CollectionPermission.ManageShare, requireUnlock: true)]
    public Task<IActionResult> RevokeShareAsync(long id, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => revokeCollectionShareService.RevokeAsync(userId, id, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Switches the active public link between "read" (anyone with the link views) and "write"
    /// (additionally, holders SIGNED IN to Juple may add their own links - never anonymously).
    /// 409 publicShareNotActive when there is no active link.
    /// </summary>
    [HttpPut("{id:long}/share/permission")]
    [CollectionPermission(CollectionPermission.ManageShare, requireUnlock: true)]
    public Task<IActionResult> SetSharePermissionAsync(long id, SetSharePermissionRequest request, CancellationToken cancellationToken)
    {
        if (!PublicSharePermissions.TryParse(request.Permission, out var permission))
        {
            return Task.FromResult(InvalidSharePermission());
        }

        return ExecuteAsync(
            userId => enableCollectionShareService.SetPermissionAsync(userId, id, permission, request.RaiseLowerRoles == true, cancellationToken),
            share => share is null
                ? CollectionProblems.Create(StatusCodes.Status409Conflict, "There is no active public link.", CollectionProblems.PublicShareNotActive)
                : Ok(ToShareResponse(share)),
            cancellationToken);
    }

    private IActionResult InvalidSharePermission() =>
        BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
        {
            ["permission"] = ["permission must be \"read\" or \"write\"."],
        }));

    /// <summary>
    /// Composes the canonical share URL server-side from PublicWebOptions - the Mobile client never
    /// assembles this itself or needs to know the Public Web's base URL.
    /// </summary>
    private CollectionShareResponse ToShareResponse(CollectionShareDto share) =>
        new(share.PublicId, ShareUrlFor(share.PublicId), share.CreatedAtUtc, PublicSharePermissions.ToWire(share.Permission));

    private string ShareUrlFor(string publicId) => $"{publicWebOptions.Value.BaseUrl.TrimEnd('/')}/c/{publicId}";

    /// <summary>
    /// A day's/Collection's worth of Items is unbounded, so this is always cursor-paginated - the
    /// same limit/cursor conventions and page-boundary keyset semantics as GET
    /// /api/v1/items/history, just with its own CollectionItemPageCursorCodec. Optional `sort`:
    /// "dateDesc" (newest added first) or "dateAsc" (oldest first) orders the whole Collection by
    /// when each link was added; omitted, the original manual order is returned unchanged. A cursor
    /// is only valid with the `sort` that issued it (400 otherwise) - changing the order starts over.
    /// Optional fromUtc/toUtc (date orders only): just the links added within [fromUtc, toUtc) - one
    /// section from GET {id}/items/sections, paged on its own; omitted, the whole Collection, unchanged.
    /// Optional q (2-100 characters after trimming): the Collection Details link search - only this
    /// Collection's links (same access/lock gates) whose title or link contains the term, in a date order
    /// (newest added first unless dateAsc is asked, or by visible name with nameAsc / nameDesc), paged with the
    /// same cursor. Never anyone's memo.
    /// </summary>
    [HttpGet("{id:long}/items")]
    public async Task<IActionResult> GetItemsAsync(
        long id,
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null,
        [FromQuery] string? sort = null,
        [FromQuery] DateTimeOffset? fromUtc = null,
        [FromQuery] DateTimeOffset? toUtc = null,
        [FromQuery] string? q = null)
    {
        if (!CollectionsQueryParameters.TryParseItemSort(sort, out var resolvedSort))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["sort"] = ["sort must be \"dateDesc\", \"dateAsc\", \"nameAsc\" or \"nameDesc\"."],
            }));
        }

        string? searchTerm = null;
        if (q is not null)
        {
            searchTerm = ItemSearchPattern.Normalize(q);
            if (searchTerm is null || fromUtc is not null || toUtc is not null)
            {
                return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
                {
                    ["q"] = [$"q must be {ItemSearchPattern.MinLength}-{ItemSearchPattern.MaxLength} characters and cannot be combined with fromUtc/toUtc."],
                }));
            }

            // Results are shown newest-added first unless the caller asked for the other date order.
            if (resolvedSort == CollectionItemSort.Manual)
            {
                resolvedSort = CollectionItemSort.DateDesc;
            }
        }

        if (resolvedSort is CollectionItemSort.NameAsc or CollectionItemSort.NameDesc && searchTerm is null)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["sort"] = ["The name orders apply to the link search (q) only."],
            }));
        }

        var isWindowed = fromUtc is not null || toUtc is not null;
        if (isWindowed && resolvedSort == CollectionItemSort.Manual)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["fromUtc"] = ["fromUtc/toUtc require sort \"dateDesc\" or \"dateAsc\"."],
            }));
        }

        if (fromUtc is { } from && toUtc is { } to && to <= from)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["toUtc"] = ["toUtc must be later than fromUtc."],
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

        CollectionItemPageCursor? typedCursor = null;
        if (cursor is not null
            && (!CollectionItemPageCursorCodec.TryDecode(cursor, out typedCursor) || typedCursor!.Sort != resolvedSort))
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
            var page = searchTerm is not null
                ? await getCollectionItemsService.SearchAsync(
                    currentUser.UserId, id, searchTerm, typedCursor, resolvedLimit, resolvedSort, unlockToken, cancellationToken)
                : isWindowed
                ? await getCollectionItemsService.GetRangeAsync(
                    currentUser.UserId,
                    id,
                    fromUtc ?? DateTimeOffset.MinValue,
                    toUtc ?? DateTimeOffset.MaxValue,
                    typedCursor,
                    resolvedLimit,
                    resolvedSort,
                    unlockToken,
                    cancellationToken)
                : await getCollectionItemsService.GetAsync(
                    currentUser.UserId, id, typedCursor, resolvedLimit, unlockToken, resolvedSort, cancellationToken);

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
        catch (CollectionSharePasswordRequiredException)
        {
            return CollectionProblems.SharePasswordRequired();
        }
        catch (CollectionLockedException)
        {
            return CollectionProblems.CollectionLocked();
        }
    }

    /// <summary>
    /// 일자순 summary of a Collection: its non-empty 오늘 / 어제 / 이번 주 / month sections (the caller's
    /// stored TimeZoneId, like GET /api/v1/items/history/sections) with exact link counts - no link
    /// data. Each section's links then come from GET {id}/items with its fromUtc/toUtc. Same access
    /// and lock gates as the item list.
    /// </summary>
    [HttpGet("{id:long}/items/sections")]
    public async Task<IActionResult> GetItemSectionsAsync(
        long id,
        [FromServices] IGetCollectionItemSectionsService getCollectionItemSectionsService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var sections = await getCollectionItemSectionsService.GetAsync(
                currentUser.UserId, id, currentUser.TimeZoneId, unlockToken, cancellationToken);
            return Ok(new CollectionItemSectionsResponse(sections));
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
        catch (CollectionSharePasswordRequiredException)
        {
            return CollectionProblems.SharePasswordRequired();
        }
        catch (CollectionLockedException)
        {
            return CollectionProblems.CollectionLocked();
        }
    }

    /// <summary>
    /// Header carrying the short-lived grant from POST {id}/unlock. A header (not a query string) so
    /// it never lands in URL logs.
    /// </summary>
    public const string UnlockTokenHeader = "X-Juple-Collection-Unlock";

    /// <summary>
    /// One link of a Collection as the read-only shared view (for opening another member's Item -
    /// GET /items/{id} stays owner-only). Same access + lock gates as the list.
    /// </summary>
    [HttpGet("{id:long}/items/{itemId:long}")]
    public Task<IActionResult> GetSharedItemAsync(
        long id,
        long itemId,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => getCollectionItemsService.GetItemAsync(userId, id, itemId, unlockToken, cancellationToken),
            item => item is null ? NotFound() : Ok(item),
            cancellationToken);

    // ---- Lock (Owner manages; every member, the Owner included, must unlock) ----

    /// <summary>
    /// Owner only. Locks the Collection under the Owner's one lock password - no password is sent or
    /// created here (409 collectionLockPasswordNotConfigured until they set one in Settings). An older
    /// app still sending a per-Collection password gets 409 collectionLockUsesAccountPassword instead
    /// of a lock that would not open with the password it just typed.
    /// </summary>
    [HttpPut("{id:long}/lock")]
    [EnableRateLimiting(RateLimitPolicies.CollectionUnlock)]
    public async Task<IActionResult> SetLockAsync(
        long id,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] SetCollectionLockRequest? request,
        [FromServices] ICollectionLockService lockService,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrEmpty(request?.Password) || !string.IsNullOrEmpty(request?.CurrentPassword))
        {
            return CollectionProblems.Create(
                StatusCodes.Status409Conflict,
                "Collections now use the account's Collection lock password.",
                CollectionProblems.LockUsesAccountPassword);
        }

        try
        {
            return await ExecuteAsync(userId => lockService.LockAsync(userId, id, cancellationToken), cancellationToken);
        }
        catch (CollectionLockPasswordNotConfiguredException)
        {
            return CollectionProblems.LockPasswordNotConfigured();
        }
    }

    /// <summary>Owner only. Removes the lock after verifying the Owner's lock password (no bypass).</summary>
    [HttpPost("{id:long}/lock/remove")]
    [EnableRateLimiting(RateLimitPolicies.CollectionUnlock)]
    public Task<IActionResult> RemoveLockAsync(
        long id,
        RemoveCollectionLockRequest request,
        [FromServices] ICollectionLockService lockService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => lockService.RemoveAsync(userId, id, request.CurrentPassword, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Owner or Contributor. Verifies the password (throttled) and returns a short-lived grant for
    /// this user and this Collection - sent back in the X-Juple-Collection-Unlock header.
    /// </summary>
    [HttpPost("{id:long}/unlock")]
    [EnableRateLimiting(RateLimitPolicies.CollectionUnlock)]
    public Task<IActionResult> UnlockAsync(
        long id,
        UnlockCollectionRequest request,
        [FromServices] ICollectionLockService lockService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => lockService.UnlockAsync(userId, id, request.Password, cancellationToken),
            grant => Ok(new UnlockCollectionResponse(grant.Token, grant.ExpiresAtUtc)),
            cancellationToken);

    // ---- Share password (the Owner manages it; recipients prove it) ----

    /// <summary>
    /// Owner only. The share-password setting of this Collection: mode ("none", "legacyCommonLock",
    /// "perCollection") and whether it is on - never the password, its hash or its ciphertext.
    /// </summary>
    [HttpGet("{id:long}/share-password")]
    public Task<IActionResult> GetSharePasswordAsync(
        long id,
        [FromServices] ICollectionSharePasswordService sharePasswordService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => sharePasswordService.GetStatusAsync(userId, id, cancellationToken),
            status => Ok(status),
            cancellationToken);

    /// <summary>
    /// Owner only; a locked Collection also needs the Owner's lock grant (X-Juple-Collection-Unlock).
    /// Sets or changes the share password (4-64 characters) - every recipient grant stops working.
    /// </summary>
    [HttpPut("{id:long}/share-password")]
    public Task<IActionResult> SetSharePasswordAsync(
        long id,
        SetSharePasswordRequest request,
        [FromServices] ICollectionSharePasswordService sharePasswordService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => sharePasswordService.SetAsync(userId, id, request.Password, request.ConfirmPassword, unlockToken, cancellationToken),
            status => Ok(status),
            cancellationToken);

    /// <summary>
    /// Owner only, same gates. Removes the share-password protection - the sharing itself (members,
    /// the public link and its permission) is untouched.
    /// </summary>
    [HttpDelete("{id:long}/share-password")]
    public Task<IActionResult> RemoveSharePasswordAsync(
        long id,
        [FromServices] ICollectionSharePasswordService sharePasswordService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => sharePasswordService.RemoveAsync(userId, id, unlockToken, cancellationToken),
            status => Ok(status),
            cancellationToken);

    /// <summary>
    /// Owner only, same gates. The share password itself, only on this explicit request (a POST, so
    /// nothing caches or prefetches it) - never stored by any cache (Cache-Control: no-store).
    /// </summary>
    [HttpPost("{id:long}/share-password/reveal")]
    public async Task<IActionResult> RevealSharePasswordAsync(
        long id,
        [FromServices] ICollectionSharePasswordService sharePasswordService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null)
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
        return await ExecuteAsync(
            userId => sharePasswordService.RevealAsync(userId, id, unlockToken, cancellationToken),
            password => Ok(new RevealSharePasswordResponse(password)),
            cancellationToken);
    }

    /// <summary>
    /// A member (Contributor/Viewer) proves the share password (throttled, persisted across
    /// replicas) and gets a short-lived grant for this user and Collection - sent back in the
    /// X-Juple-Collection-Unlock header. A stranger gets 404 whatever the password: it never grants
    /// access, a role or a membership.
    /// </summary>
    [HttpPost("{id:long}/share-password/unlock")]
    [EnableRateLimiting(RateLimitPolicies.CollectionUnlock)]
    public Task<IActionResult> UnlockSharePasswordAsync(
        long id,
        UnlockCollectionRequest request,
        [FromServices] ICollectionSharePasswordService sharePasswordService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => sharePasswordService.UnlockAsync(userId, id, request.Password, cancellationToken),
            grant => Ok(new UnlockCollectionResponse(grant.Token, grant.ExpiresAtUtc)),
            cancellationToken);

    // ---- Collaboration (Owner only) ----

    /// <summary>Current collaborators and pending invitations, identified by Juple ID only.</summary>
    [HttpGet("{id:long}/collaborators")]
    public Task<IActionResult> GetCollaborationAsync(
        long id,
        [FromServices] ICollectionCollaborationService collaborationService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => collaborationService.GetOverviewAsync(userId, id, cancellationToken),
            overview => Ok(overview),
            cancellationToken);

    /// <summary>
    /// Any member (Owner or Contributor): who is in this Collection - the Owner and accepted
    /// Contributors, by Juple ID and chosen display name only. Pending invitations and CanManage
    /// only for the Owner. Membership is metadata like the Collection card, so no unlock grant.
    /// </summary>
    [HttpGet("{id:long}/participants")]
    public Task<IActionResult> GetParticipantsAsync(
        long id,
        [FromServices] ICollectionCollaborationService collaborationService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => collaborationService.GetParticipantsAsync(userId, id, cancellationToken),
            participants => Ok(participants),
            cancellationToken);

    /// <summary>
    /// Invites the user with this exact Juple ID - as a Contributor (공동작업, the default) or a
    /// Viewer (보기 전용 공유, role "viewer"); they must accept it themselves.
    /// </summary>
    [HttpPost("{id:long}/invitations")]
    [CollectionPermission(CollectionPermission.ManageCollaborators, requireUnlock: true)]
    [EnableRateLimiting(RateLimitPolicies.CollectionInvite)]
    public Task<IActionResult> InviteAsync(
        long id,
        InviteCollaboratorRequest request,
        [FromServices] ICollectionCollaborationService collaborationService,
        CancellationToken cancellationToken)
    {
        if (!TryParseInviteRole(request.Role, out var role))
        {
            return Task.FromResult<IActionResult>(BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["role"] = ["role must be \"contributor\" or \"viewer\"."],
            })));
        }

        return ExecuteAsync(
            userId => collaborationService.InviteAsync(userId, id, request.JupleId, role, cancellationToken),
            invitation => Ok(invitation),
            cancellationToken);
    }

    /// <summary>Absent → Contributor (the pre-Viewer contract); otherwise exactly "contributor", "submitter" or "viewer", any case.</summary>
    private static bool TryParseInviteRole(string? value, out CollectionCollaboratorRole role)
    {
        role = CollectionCollaboratorRole.Contributor;
        if (value is null)
        {
            return true;
        }

        switch (value.Trim().ToLowerInvariant())
        {
            case CollectionDtoAccessRoles.Contributor:
                return true;
            case CollectionDtoAccessRoles.Viewer:
                role = CollectionCollaboratorRole.Viewer;
                return true;
            case CollectionDtoAccessRoles.Submitter:
                role = CollectionCollaboratorRole.Submitter;
                return true;
            default:
                return false;
        }
    }

    [HttpDelete("{id:long}/invitations/{invitationId:long}")]
    [CollectionPermission(CollectionPermission.ManageCollaborators, requireUnlock: true)]
    public Task<IActionResult> RevokeInvitationAsync(
        long id,
        long invitationId,
        [FromServices] ICollectionCollaborationService collaborationService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => collaborationService.RevokeInvitationAsync(userId, id, invitationId, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Changes what a still-pending invitation grants: "viewer" (읽기) or "contributor" (쓰기).
    /// 409 invitationNotPending once answered, publicShareActive for "viewer" while the public link
    /// grants 링크 추가 - its permission is the minimum (nothing is switched off automatically).
    /// </summary>
    [HttpPut("{id:long}/invitations/{invitationId:long}/role")]
    [CollectionPermission(CollectionPermission.ManageCollaborators, requireUnlock: true)]
    public Task<IActionResult> ChangeInvitationRoleAsync(
        long id,
        long invitationId,
        ChangeRoleRequest request,
        [FromServices] ICollectionCollaborationService collaborationService,
        CancellationToken cancellationToken)
    {
        if (!TryParseRequiredRole(request.Role, out var role))
        {
            return Task.FromResult(InvalidRole());
        }

        return ExecuteAsync(
            userId => collaborationService.ChangeInvitationRoleAsync(userId, id, invitationId, role, cancellationToken),
            cancellationToken);
    }

    /// <summary>
    /// Changes an accepted member's role (addressed by Juple ID): "viewer" (읽기) or "contributor"
    /// (쓰기), effective on their next request. 409 publicShareActive for "viewer" while the public
    /// link grants 링크 추가 (its permission is the minimum). The Owner has no member row, so their own role can never be changed here.
    /// </summary>
    [HttpPut("{id:long}/collaborators/{jupleId}/role")]
    [CollectionPermission(CollectionPermission.ManageCollaborators, requireUnlock: true)]
    public Task<IActionResult> ChangeCollaboratorRoleAsync(
        long id,
        string jupleId,
        ChangeRoleRequest request,
        [FromServices] ICollectionCollaborationService collaborationService,
        CancellationToken cancellationToken)
    {
        if (!TryParseRequiredRole(request.Role, out var role))
        {
            return Task.FromResult(InvalidRole());
        }

        return ExecuteAsync(
            userId => collaborationService.ChangeCollaboratorRoleAsync(userId, id, jupleId, role, cancellationToken),
            cancellationToken);
    }

    /// <summary>Unlike an invitation's (which defaults for older clients), a role change must name the role.</summary>
    private static bool TryParseRequiredRole(string? value, out CollectionCollaboratorRole role)
    {
        role = CollectionCollaboratorRole.Contributor;
        return value is not null && TryParseInviteRole(value, out role);
    }

    private IActionResult InvalidRole() =>
        BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
        {
            ["role"] = ["role must be \"contributor\" or \"viewer\"."],
        }));

    /// <summary>
    /// 컬렉션에서 나가기: the caller (an accepted member, not the Owner) leaves the Collection - the same removal as when
    /// the Owner removes them (see ICollectionCollaborationService.LeaveAsync). 204; 403 for the Owner; 404 for anyone
    /// who is not a member (a stranger, a public-link visitor, a pending invitee). A literal "me" - never a Juple ID.
    /// </summary>
    [HttpDelete("{id:long}/collaborators/me")]
    public Task<IActionResult> LeaveAsync(
        long id,
        [FromServices] ICollectionCollaborationService collaborationService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => collaborationService.LeaveAsync(userId, id, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Removes a Contributor (addressed by Juple ID - never an internal id) and exactly the links
    /// they added to this Collection; their Items themselves are untouched.
    /// </summary>
    [HttpDelete("{id:long}/collaborators/{jupleId}")]
    [CollectionPermission(CollectionPermission.ManageCollaborators, requireUnlock: true)]
    public Task<IActionResult> RemoveCollaboratorAsync(
        long id,
        string jupleId,
        [FromServices] ICollectionCollaborationService collaborationService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => collaborationService.RemoveCollaboratorAsync(userId, id, jupleId, cancellationToken),
            cancellationToken);

    /// <summary>
    /// 204: added - idempotent, an Item already in the Collection resolves on 204 too (see
    /// AddItemToCollectionService). 202 { submitted: true }: the caller may only propose links here
    /// (승인 후 추가) - it waits for the Owner and is not a link of the Collection yet. 409
    /// linkAlreadyInCollection / linkAlreadyPending for a proposal of a link that is already there or
    /// already waiting.
    /// </summary>
    [HttpPut("{id:long}/items/{itemId:long}")]
    public Task<IActionResult> AddItemAsync(long id, long itemId, CancellationToken cancellationToken, [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => addItemToCollectionService.AddAsync(userId, id, itemId, unlockToken, cancellationToken),
            outcome => outcome == CollectionLinkAddOutcome.Submitted ? Accepted(new LinkSubmittedResponse(true)) : NoContent(),
            cancellationToken);

    /// <summary>
    /// The caller's one emoji reaction to this link (Owner and accepted members, any role; 404 for
    /// everyone else): none yet - added; another - changed in place; the same - unchanged (never a
    /// toggle: the app calls DELETE to take it back). reactionKey must be one of the catalog keys (400
    /// otherwise). Answers the link's reactions as they are now.
    /// </summary>
    [HttpPut("{id:long}/items/{itemId:long}/reaction")]
    public Task<IActionResult> SetReactionAsync(
        long id,
        long itemId,
        SetReactionRequest request,
        [FromServices] Juple.Application.Collections.Reactions.ICollectionItemReactionService reactionService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => reactionService.SetAsync(userId, id, itemId, request?.ReactionKey, unlockToken, cancellationToken),
            reactions => Ok(reactions),
            cancellationToken);

    /// <summary>Takes the caller's reaction to this link back; having none is a success too. Answers the link's reactions as they are now.</summary>
    [HttpDelete("{id:long}/items/{itemId:long}/reaction")]
    public Task<IActionResult> RemoveReactionAsync(
        long id,
        long itemId,
        [FromServices] Juple.Application.Collections.Reactions.ICollectionItemReactionService reactionService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => reactionService.DeleteAsync(userId, id, itemId, unlockToken, cancellationToken),
            reactions => Ok(reactions),
            cancellationToken);

    /// <summary>
    /// A link's comments (Owner and accepted members, any role; 404 for everyone else), oldest first:
    /// the newest `limit` (default 30, at most 100) or, with `before` (the previousCursor of the last
    /// page), the page before it. Plain text only; never in the public link's views. The same content
    /// gate as reading the links - a lock or share password needs its grant first.
    /// </summary>
    [HttpGet("{id:long}/items/{itemId:long}/comments")]
    public Task<IActionResult> ListCommentsAsync(
        long id,
        long itemId,
        [FromQuery] long? before,
        [FromQuery] int? limit,
        [FromServices] Juple.Application.Collections.Comments.ICollectionItemCommentService commentService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => commentService.ListAsync(userId, id, itemId, before, limit, unlockToken, cancellationToken),
            page => Ok(page),
            cancellationToken);

    /// <summary>Adds the caller's comment (trimmed, 1..1000 characters, 400 otherwise); answers it as stored.</summary>
    [HttpPost("{id:long}/items/{itemId:long}/comments")]
    public Task<IActionResult> AddCommentAsync(
        long id,
        long itemId,
        PostCommentRequest request,
        [FromServices] Juple.Application.Collections.Comments.ICollectionItemCommentService commentService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => commentService.CreateAsync(userId, id, itemId, request?.Body, unlockToken, request?.ParentCommentId, cancellationToken),
            comment => StatusCode(StatusCodes.Status201Created, comment),
            cancellationToken);

    /// <summary>
    /// One thread's replies, oldest first: `limit` (default 30, at most 100) after `after` (the nextCursor of the last page; omit for the
    /// first). {commentId} is a TOP-LEVEL comment of the link (404 otherwise). Same access and content gate as the comments themselves.
    /// </summary>
    [HttpGet("{id:long}/items/{itemId:long}/comments/{commentId:long}/replies")]
    public Task<IActionResult> ListCommentRepliesAsync(
        long id,
        long itemId,
        long commentId,
        [FromQuery] long? after,
        [FromQuery] int? limit,
        [FromServices] Juple.Application.Collections.Comments.ICollectionItemCommentService commentService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => commentService.ListRepliesAsync(userId, id, itemId, commentId, after, limit, unlockToken, cancellationToken),
            page => Ok(page),
            cancellationToken);

    /// <summary>Hearts a comment for the caller. Idempotent (a repeat is the same answer): {liked: true, likeCount}. 404 for a comment that is not a live one of this link.</summary>
    [HttpPut("{id:long}/items/{itemId:long}/comments/{commentId:long}/like")]
    public Task<IActionResult> LikeCommentAsync(
        long id,
        long itemId,
        long commentId,
        [FromServices] Juple.Application.Collections.Comments.ICollectionItemCommentService commentService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => commentService.SetLikeAsync(userId, id, itemId, commentId, true, unlockToken, cancellationToken),
            state => Ok(state),
            cancellationToken);

    /// <summary>Takes the caller's heart back. Idempotent: {liked: false, likeCount}.</summary>
    [HttpDelete("{id:long}/items/{itemId:long}/comments/{commentId:long}/like")]
    public Task<IActionResult> UnlikeCommentAsync(
        long id,
        long itemId,
        long commentId,
        [FromServices] Juple.Application.Collections.Comments.ICollectionItemCommentService commentService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => commentService.SetLikeAsync(userId, id, itemId, commentId, false, unlockToken, cancellationToken),
            state => Ok(state),
            cancellationToken);

    /// <summary>
    /// Edits the words of the caller's OWN comment (same 1..1000 rule); answers it as stored now, replies and hearts intact.
    /// 403 for somebody else's comment (the Owner included), 404 for a missing or deleted one. Never notifies anybody.
    /// </summary>
    [HttpPut("{id:long}/items/{itemId:long}/comments/{commentId:long}")]
    public Task<IActionResult> EditCommentAsync(
        long id,
        long itemId,
        long commentId,
        EditCommentRequest request,
        [FromServices] Juple.Application.Collections.Comments.ICollectionItemCommentService commentService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => commentService.EditAsync(userId, id, itemId, commentId, request?.Body, unlockToken, cancellationToken),
            comment => Ok(comment),
            cancellationToken);

    /// <summary>Deletes a comment: its author, or the Collection's Owner for any. 403 for another member; one that is gone already is a success (204).</summary>
    [HttpDelete("{id:long}/items/{itemId:long}/comments/{commentId:long}")]
    public Task<IActionResult> DeleteCommentAsync(
        long id,
        long itemId,
        long commentId,
        [FromServices] Juple.Application.Collections.Comments.ICollectionItemCommentService commentService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => commentService.DeleteAsync(userId, id, itemId, commentId, unlockToken, cancellationToken),
            cancellationToken);

    /// <summary>The Owner's 승인 대기 list, oldest first (cursor = the last row's submissionId). Owner only.</summary>
    [HttpGet("{id:long}/submissions")]
    public Task<IActionResult> ListSubmissionsAsync(
        long id,
        [FromQuery] long? cursor,
        [FromQuery] int? limit,
        [FromServices] ICollectionLinkSubmissionService submissionService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => submissionService.ListAsync(userId, id, cursor, limit ?? CollectionLinkSubmissionService.MaxPageSize, unlockToken, cancellationToken),
            page => Ok(page),
            cancellationToken);

    /// <summary>
    /// How many of the caller's OWN proposed links still wait for approval across their shared
    /// Collections - one number for the 공유 컬렉션 tab (the Owner's own approval queue is a different
    /// number and is never part of it).
    /// </summary>
    [HttpGet("my-pending-submissions/count")]
    public Task<IActionResult> CountMyPendingSubmissionsAsync(
        [FromServices] ICollectionLinkSubmissionService submissionService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => submissionService.CountMineInSharedCollectionsAsync(userId, cancellationToken),
            count => Ok(new MyPendingSubmissionCountResponse(count)),
            cancellationToken);

    public sealed record MyPendingSubmissionCountResponse(int MyPendingSubmissionCount);

    /// <summary>
    /// The caller cancels (withdraws) THEIR OWN still-waiting proposal. The owner of the request is the
    /// authenticated caller - never a client-supplied user id. 204; 404 (non-disclosing) for anything that
    /// is not the caller's own waiting proposal (someone else's, already approved/rejected, unknown).
    /// </summary>
    [HttpDelete("submissions/mine/{submissionId:long}")]
    public Task<IActionResult> CancelMySubmissionAsync(
        long submissionId,
        [FromServices] ICollectionLinkSubmissionService submissionService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => submissionService.CancelMineAsync(userId, submissionId, null, cancellationToken),
            cancellationToken);

    /// <summary>
    /// The caller's OWN links still waiting for approval across the Collections they are a member of,
    /// newest first (cursor = the last row's submissionId), each with its Collection's id and name.
    /// There is no userId parameter: the caller is always the filter.
    /// </summary>
    [HttpGet("submissions/mine")]
    public Task<IActionResult> ListMySubmissionsAcrossCollectionsAsync(
        [FromQuery] long? cursor,
        [FromQuery] int? limit,
        [FromServices] ICollectionLinkSubmissionService submissionService,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => submissionService.ListMineAcrossCollectionsAsync(userId, cursor, limit ?? CollectionLinkSubmissionService.MaxPageSize, cancellationToken),
            page => Ok(page),
            cancellationToken);

    /// <summary>
    /// The caller's OWN links still waiting for approval (a 승인 후 추가 member), newest first (cursor = the
    /// last row's submissionId). Never anyone else's; the Owner uses the list above instead (403 here).
    /// </summary>
    [HttpGet("{id:long}/submissions/mine")]
    public Task<IActionResult> ListMySubmissionsAsync(
        long id,
        [FromQuery] long? cursor,
        [FromQuery] int? limit,
        [FromServices] ICollectionLinkSubmissionService submissionService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => submissionService.ListMineAsync(userId, id, cursor, limit ?? CollectionLinkSubmissionService.MaxPageSize, unlockToken, cancellationToken),
            page => Ok(page),
            cancellationToken);

    /// <summary>
    /// Owner only: the proposal becomes a link of the Collection (the proposer's own Item). 404 when it
    /// is no longer waiting (so a second approve adds nothing); 409 linkAlreadyInCollection /
    /// submissionUnavailable when it cannot be added any more - it is cleared then.
    /// </summary>
    [HttpPost("{id:long}/submissions/{submissionId:long}/approve")]
    public Task<IActionResult> ApproveSubmissionAsync(
        long id,
        long submissionId,
        [FromServices] ICollectionLinkSubmissionService submissionService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => submissionService.ApproveAsync(userId, id, submissionId, unlockToken, cancellationToken),
            cancellationToken);

    /// <summary>Owner only: rejects (deletes) the proposal - nothing is added. Idempotent: 204 also when it was no longer waiting.</summary>
    [HttpDelete("{id:long}/submissions/{submissionId:long}")]
    public Task<IActionResult> RejectSubmissionAsync(
        long id,
        long submissionId,
        [FromServices] ICollectionLinkSubmissionService submissionService,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => submissionService.RejectAsync(userId, id, submissionId, unlockToken, cancellationToken),
            cancellationToken);

    /// <summary>
    /// 컬렉션에서 제거 (the link only, never the Item). The Owner: any link; a member: only links whose
    /// Item is their own (403 otherwise) - see RemoveItemFromCollectionService. Idempotent - resolves
    /// on 204 whether or not the link was actually in the Collection.
    /// </summary>
    [HttpDelete("{id:long}/items/{itemId:long}")]
    [CollectionPermission(CollectionPermission.View)]
    public Task<IActionResult> RemoveItemAsync(long id, long itemId, CancellationToken cancellationToken, [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => removeItemFromCollectionService.RemoveAsync(userId, id, itemId, unlockToken, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Moves itemId to immediately after AfterItemId's current position (null = move to the very
    /// front) - a single atomic move, not a full reordered-list replace, since a Collection's Item
    /// list is unbounded/cursor-paginated (see GetItemsAsync) and the client may not have every
    /// Item's id loaded. Only the Collection's owner may reorder.
    /// </summary>
    [HttpPut("{id:long}/items/{itemId:long}/position")]
    [CollectionPermission(CollectionPermission.Reorganize)]
    public Task<IActionResult> MoveItemAsync(
        long id, long itemId, MoveCollectionItemRequest request, CancellationToken cancellationToken, [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => moveCollectionItemService.MoveAsync(userId, id, itemId, request.AfterItemId, unlockToken, cancellationToken),
            cancellationToken);

    [HttpPost("{id:long}/restore")]
    public Task<IActionResult> RestoreAsync(long id, CancellationToken cancellationToken) =>
        ExecuteAsync(userId => restoreCollectionService.RestoreAsync(userId, id, cancellationToken), cancellationToken);

    /// <summary>Moves one active Item membership to another owned Collection atomically.</summary>
    [HttpPost("{sourceCollectionId:long}/items/{itemId:long}/move")]
    [CollectionPermission(CollectionPermission.Reorganize, "sourceCollectionId")]
    public Task<IActionResult> TransferItemAsync(
        long sourceCollectionId, long itemId, TransferCollectionItemRequest request, CancellationToken cancellationToken, [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => transferCollectionItemService.TransferAsync(
                userId, sourceCollectionId, itemId, request.TargetCollectionId, unlockToken, cancellationToken),
            result => Ok(new TransferCollectionItemResponse(result.TargetMembershipCreated)),
            cancellationToken);

    /// <summary>Restores the membership state from a just-completed item move atomically.</summary>
    [HttpPost("{sourceCollectionId:long}/items/{itemId:long}/move/undo")]
    [CollectionPermission(CollectionPermission.Reorganize, "sourceCollectionId")]
    public Task<IActionResult> UndoTransferItemAsync(
        long sourceCollectionId, long itemId, UndoTransferCollectionItemRequest request, CancellationToken cancellationToken, [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => undoTransferCollectionItemService.UndoAsync(
                userId, sourceCollectionId, itemId, request.TargetCollectionId,
                request.TargetMembershipCreated, unlockToken, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Merges all memberships into the target, then soft-deletes the owned source Collection
    /// atomically. The returned undoOperationId (null only for the source-equals-target no-op) can
    /// be replayed against the dedicated Undo endpoint below to reverse exactly this merge.
    /// </summary>
    [HttpPost("{sourceCollectionId:long}/merge")]
    [CollectionPermission(CollectionPermission.Reorganize, "sourceCollectionId")]
    public Task<IActionResult> MergeAsync(
        long sourceCollectionId, MergeCollectionsRequest request, CancellationToken cancellationToken, [FromHeader(Name = UnlockTokenHeader)] string? unlockToken = null) =>
        ExecuteAsync(
            userId => mergeCollectionsService.MergeAsync(
                userId, sourceCollectionId, request.TargetCollectionId, unlockToken, cancellationToken),
            result => Ok(new MergeCollectionsResponse(result.UndoOperationId)),
            cancellationToken);

    /// <summary>
    /// Reverses a single Merge atomically: restores the source Collection and removes only the
    /// Target memberships that merge itself created (never a plain source-ItemIds-minus-target
    /// pass - see CollectionStore.UndoMergeAsync). Idempotent - undoing an already-undone operation
    /// is a safe no-op. Ownership is resolved server-side from undoOperationId; no other collection
    /// or membership state is accepted from the client.
    /// </summary>
    [HttpPost("merge/undo")]
    public Task<IActionResult> UndoMergeAsync(
        UndoMergeCollectionsRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => undoMergeCollectionsService.UndoAsync(userId, request.UndoOperationId, cancellationToken),
            cancellationToken);

    private async Task<IActionResult> ExecuteAsync(
        Func<long, Task> action,
        CancellationToken cancellationToken) =>
        await ExecuteAsync(
            async userId =>
            {
                await action(userId);
                return true;
            },
            _ => NoContent(),
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
        catch (CollectionForbiddenException)
        {
            return CollectionProblems.CollectionForbidden();
        }
        catch (CollectionSharePasswordRequiredException)
        {
            return CollectionProblems.SharePasswordRequired();
        }
        catch (CollectionLockedException)
        {
            return CollectionProblems.CollectionLocked();
        }
        catch (CollectionCollaborationConflictException exception)
        {
            return CollectionProblems.Conflict(exception.Code);
        }
        catch (CollectionNotLockedException)
        {
            return CollectionProblems.CollectionNotLocked();
        }
        catch (CollectionSharePasswordNotSetException)
        {
            return CollectionProblems.Create(
                StatusCodes.Status409Conflict, "This Collection has no share password.", CollectionProblems.SharePasswordNotSetCode);
        }
        catch (CollectionSharePasswordUnreadableException)
        {
            return CollectionProblems.Create(
                StatusCodes.Status409Conflict, "The share password cannot be shown - set a new one.", CollectionProblems.SharePasswordUnreadableCode);
        }
        catch (InvalidCollectionPasswordException)
        {
            return CollectionProblems.InvalidCollectionPassword();
        }
        catch (CollectionUnlockThrottledException exception)
        {
            return CollectionProblems.TooManyUnlockAttempts(Response, exception.RetryAfterUtc, TimeProvider.System.GetUtcNow());
        }
        catch (JupleIdNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionInvitationNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionLinkSubmissionNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionCollaboratorNotFoundException)
        {
            return NotFound();
        }
    }

    public sealed record SetCollectionLockRequest(string? Password, string? CurrentPassword);

    public sealed record RemoveCollectionLockRequest(string? CurrentPassword);

    public sealed record UnlockCollectionRequest(string? Password);

    public sealed record UnlockCollectionResponse(string UnlockToken, DateTimeOffset ExpiresAtUtc);

    /// <summary>Role: "contributor" (default when absent) or "viewer".</summary>
    public sealed record InviteCollaboratorRequest(string? JupleId, string? Role = null);

    /// <summary>Role: "contributor" (쓰기) or "viewer" (읽기) - required.</summary>
    public sealed record ChangeRoleRequest(string? Role);

    public sealed record CreateCollectionRequest(string? Name, string? Icon, string? Color);

    public sealed record RenameCollectionRequest(string? Name);

    public sealed record SetCollectionFavoriteRequest(bool IsFavorite);

    public sealed record SetCollectionIconRequest(string? Icon);

    public sealed record SetCollectionColorRequest(string? Color);

    public sealed record MoveCollectionItemRequest(long? AfterItemId);

    public sealed record TransferCollectionItemRequest(long TargetCollectionId);

    public sealed record UndoTransferCollectionItemRequest(long TargetCollectionId, bool TargetMembershipCreated);

    public sealed record TransferCollectionItemResponse(bool TargetMembershipCreated);

    public sealed record MergeCollectionsRequest(long TargetCollectionId);

    public sealed record MergeCollectionsResponse(Guid? UndoOperationId);

    public sealed record UndoMergeCollectionsRequest(Guid UndoOperationId);

    public sealed record CollectionsResponse(IReadOnlyList<CollectionDto> Items, string? NextCursor);

    public sealed record CollectionItemsPageResponse(IReadOnlyList<CollectionItemEntryDto> Items, string? NextCursor);

    public sealed record SetSharePasswordRequest(string? Password, string? ConfirmPassword);

    public sealed record RevealSharePasswordResponse(string Password);

    public sealed record CollectionItemSectionsResponse(IReadOnlyList<CollectionItemSectionDto> Sections);

    public sealed record CollectionShareResponse(string PublicId, string ShareUrl, DateTimeOffset CreatedAtUtc, string Permission);

    /// <summary>
    /// "read", "submit" or "write". RaiseLowerRoles (absent = false): the Owner confirmed raising every
    /// member / pending invitation below the permission's minimum role to it, atomically, instead of
    /// the 409 publicSharePermissionMismatch refusal.
    /// </summary>
    public sealed record SetSharePermissionRequest(string? Permission, bool? RaiseLowerRoles = null);

    public sealed record SetReactionRequest(string? ReactionKey);

    /// <summary>ParentCommentId: the comment (or reply) this one answers - optional, additive; the thread root and the answered person are decided server-side.</summary>
    public sealed record EditCommentRequest(string? Body);

    public sealed record PostCommentRequest(string? Body, long? ParentCommentId = null);

    public sealed record CollectionShareStatusResponse(bool IsShared, CollectionShareResponse? Share);

    /// <summary>A member's view of the public link: on/off and its URL - nothing else (see GetShareLinkAsync).</summary>
    public sealed record CollectionShareLinkResponse(bool IsShared, string? ShareUrl);

    /// <summary>202 body of an add that became a proposal (승인 후 추가).</summary>
    public sealed record LinkSubmittedResponse(bool Submitted);

    public sealed record SendShareLinkRequest(IReadOnlyList<string>? JupleIds);

    public sealed record SendShareLinkResponse(IReadOnlyList<string> Sent, IReadOnlyList<string> NotFound);
}
