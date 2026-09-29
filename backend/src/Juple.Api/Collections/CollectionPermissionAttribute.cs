using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Juple.Api.Collections;

/// <summary>
/// Declares the CollectionPermission an endpoint requires; enforced once, centrally, by
/// CollectionPermissionFilter through ICollectionAccessService (the single place the Owner /
/// Contributor policy lives). No access → 404 (indistinguishable from a non-existent id); access
/// without this permission → 403. The underlying stores additionally keep their own owner-only
/// filters, so a Owner-only endpoint missing this attribute still fails closed (404).
///
/// requireUnlock: for a locked Collection, the operation additionally needs a valid unlock grant
/// for this user (the X-Juple-Collection-Unlock header, same grants as content access) - otherwise
/// 403 collectionLocked. Used for managing the Collection itself (rename/icon/color/delete, public
/// share and collaboration management): the lock protects those too, not only the content. Checked
/// after the permission, so a Contributor still gets 403 forbidden (and a stranger 404) with or
/// without a grant.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class CollectionPermissionAttribute : TypeFilterAttribute
{
    public CollectionPermissionAttribute(CollectionPermission permission, string routeKey = "id", bool requireUnlock = false)
        : base(typeof(CollectionPermissionFilter))
    {
        Arguments = [permission, routeKey, requireUnlock];
    }
}

public sealed class CollectionPermissionFilter(
    CollectionPermission permission,
    string routeKey,
    bool requireUnlock,
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ICollectionAccessService accessService) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!context.RouteData.Values.TryGetValue(routeKey, out var rawId)
            || !long.TryParse(rawId?.ToString(), out var collectionId))
        {
            context.Result = new NotFoundResult();
            return;
        }

        var cancellationToken = context.HttpContext.RequestAborted;
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            if (requireUnlock)
            {
                var unlockToken = context.HttpContext.Request.Headers[Controllers.CollectionsController.UnlockTokenHeader].ToString();
                await accessService.RequireUnlockedAsync(
                    currentUser.UserId, collectionId, permission, unlockToken, cancellationToken);
            }
            else
            {
                await accessService.RequireAsync(currentUser.UserId, collectionId, permission, cancellationToken);
            }
        }
        catch (CurrentJupleUserNotFoundException)
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status409Conflict,
                Title = "Juple user bootstrap is required.",
            })
            { StatusCode = StatusCodes.Status409Conflict };
            return;
        }
        catch (CollectionNotFoundException)
        {
            context.Result = new NotFoundResult();
            return;
        }
        catch (CollectionForbiddenException)
        {
            context.Result = CollectionProblems.CollectionForbidden();
            return;
        }
        catch (CollectionSharePasswordRequiredException)
        {
            context.Result = CollectionProblems.SharePasswordRequired();
            return;
        }
        catch (CollectionLockedException)
        {
            context.Result = CollectionProblems.CollectionLocked();
            return;
        }

        await next();
    }
}
