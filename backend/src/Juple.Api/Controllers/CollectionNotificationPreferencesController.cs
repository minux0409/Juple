using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Application.Collections;
using Juple.Application.Collections.NotificationPreference;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// The signed-in user's own 새 링크 알림 setting for one Collection they own or belong to. There is
/// no target user anywhere in the route or body - it is always the caller's own row. No access is
/// the same 404 as a missing Collection.
/// </summary>
[ApiController]
[Route("api/v1/collections/{id:long}/notification-preference")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class CollectionNotificationPreferencesController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ICollectionNotificationPreferenceService preferenceService) : ControllerBase
{
    public const string InvalidPreferenceCode = "invalidNotificationPreference";

    [HttpGet]
    public Task<IActionResult> GetAsync(long id, CancellationToken cancellationToken) =>
        ExecuteAsync(async userId => Ok(await preferenceService.GetAsync(userId, id, cancellationToken)), cancellationToken);

    /// <summary>Body { newItemNotificationsEnabled: bool } - required; a missing value is 400, never a silent OFF.</summary>
    [HttpPut]
    public Task<IActionResult> SetAsync(long id, SetCollectionNotificationPreferenceRequest request, CancellationToken cancellationToken) =>
        request.NewItemNotificationsEnabled is not { } enabled
            ? Task.FromResult<IActionResult>(CollectionProblems.Create(
                StatusCodes.Status400BadRequest, "newItemNotificationsEnabled is required.", InvalidPreferenceCode))
            : ExecuteAsync(async userId => Ok(await preferenceService.SetAsync(userId, id, enabled, cancellationToken)), cancellationToken);

    private async Task<IActionResult> ExecuteAsync(Func<long, Task<IActionResult>> action, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return await action(currentUser.UserId);
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
        catch (CollectionForbiddenException)
        {
            return CollectionProblems.CollectionForbidden();
        }
    }

    public sealed record SetCollectionNotificationPreferenceRequest(bool? NewItemNotificationsEnabled);
}
