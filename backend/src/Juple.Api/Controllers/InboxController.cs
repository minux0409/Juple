using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Application.Collections;
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
[Juple.Api.Billing.RequireWriteAccess]
[Juple.Api.Billing.CollectionOwnedWrite(RequestProperties = new[] { "CollectionIds" })]
public sealed class InboxController : ControllerBase
{
    /// <summary>
    /// Saves a link. Optional collectionIds (the 링크 저장 screen): the Collections the new link goes into, written
    /// together with it (see SaveInboxEntryToCollectionsService) - [] is an explicit "no Collection"; omitted keeps the
    /// original contract (just the link, the plain entry body). unlockTokens: collectionId → grant, one per locked
    /// destination. With collectionIds the body also carries what happened in the Collections.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> SaveAsync(
        SaveInboxEntryRequest request,
        [FromServices] IExternalIdentityAccessor externalIdentityAccessor,
        [FromServices] ICurrentJupleUserAccessor currentUserAccessor,
        [FromServices] IInboxEntrySaveService inboxEntrySaveService,
        [FromServices] ISaveInboxEntryToCollectionsService saveToCollectionsService,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var command = new SaveInboxEntryCommand(request.Url, request.ClientRequestId);
            if (request.CollectionIds is { } collectionIds)
            {
                var withCollections = await saveToCollectionsService.SaveAsync(
                    currentUser.UserId, command, collectionIds, request.UnlockTokens, cancellationToken);
                var entry = withCollections.Save.Entry;
                var body = new SaveInboxEntryWithCollectionsResponse(
                    entry.Id,
                    entry.Url,
                    entry.SavedAtUtc,
                    withCollections.Collections.Added,
                    withCollections.Collections.Submitted,
                    withCollections.Collections.AlreadyInCollection,
                    withCollections.Collections.AlreadyPending);
                return withCollections.Save.Created ? Created($"/api/v1/inbox/{entry.Id}", body) : Ok(body);
            }

            var result = await inboxEntrySaveService.SaveAsync(currentUser.UserId, command, cancellationToken);

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
        catch (CollectionNotFoundException)
        {
            return NotFound();
        }
        catch (Juple.Application.Items.ItemNotFoundException)
        {
            return NotFound();
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
    }

    public sealed record SaveInboxEntryRequest(
        string? Url,
        Guid? ClientRequestId,
        IReadOnlyList<long>? CollectionIds = null,
        IReadOnlyDictionary<long, string>? UnlockTokens = null);

    /// <summary>The saved entry plus, per outcome, how many of the chosen Collections ended that way.</summary>
    public sealed record SaveInboxEntryWithCollectionsResponse(
        long Id,
        string Url,
        DateTimeOffset SavedAtUtc,
        int AddedCount,
        int SubmittedCount,
        int AlreadyInCollectionCount,
        int AlreadyPendingCount);
}
