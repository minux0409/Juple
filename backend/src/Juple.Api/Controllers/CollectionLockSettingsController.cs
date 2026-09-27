using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Locking;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// Settings > 컬렉션 잠금: the signed-in user's one Collection lock password, which opens every
/// Collection they lock. Always the current user's own setting - there is no target user in any
/// route or body. Never returns the hash or the password.
/// </summary>
[ApiController]
[Route("api/v1/users/me/collection-lock")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class CollectionLockSettingsController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ICollectionLockPasswordService lockPasswordService,
    TimeProvider timeProvider) : ControllerBase
{
    [HttpGet]
    public Task<IActionResult> GetAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(async userId => Ok(await lockPasswordService.GetStatusAsync(userId, cancellationToken)), cancellationToken);

    /// <summary>Changes the lock password; the current one is verified server-side (throttled).</summary>
    [HttpPut]
    [EnableRateLimiting(RateLimitPolicies.CollectionLockPassword)]
    public Task<IActionResult> ChangeAsync(ChangeCollectionLockPasswordRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            async userId =>
            {
                await lockPasswordService.ChangeAsync(
                    userId, request.CurrentPassword, request.NewPassword, request.ConfirmPassword, cancellationToken);
                return NoContent();
            },
            cancellationToken);

    /// <summary>
    /// First setup and "forgot password": sets the lock password without the current one. Only
    /// within minutes of a real sign-in - judged solely from the validated access token's auth_time,
    /// never from anything in the request.
    /// </summary>
    [HttpPost("reset")]
    [EnableRateLimiting(RateLimitPolicies.CollectionLockPassword)]
    public Task<IActionResult> ResetAsync(ResetCollectionLockPasswordRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            async userId =>
            {
                await lockPasswordService.ResetAsync(
                    userId, request.NewPassword, request.ConfirmPassword, AuthenticationTimeClaim.Read(User), cancellationToken);
                return NoContent();
            },
            cancellationToken);

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
        catch (InvalidCollectionException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
        catch (RecentAuthenticationRequiredException)
        {
            return CollectionProblems.RecentAuthenticationRequired();
        }
        catch (CollectionLockPasswordNotConfiguredException)
        {
            return CollectionProblems.LockPasswordNotConfigured();
        }
        catch (InvalidCollectionPasswordException)
        {
            return CollectionProblems.InvalidCollectionPassword();
        }
        catch (CollectionUnlockThrottledException exception)
        {
            return CollectionProblems.TooManyUnlockAttempts(Response, exception.RetryAfterUtc, timeProvider.GetUtcNow());
        }
        catch (CollectionConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The lock password was changed concurrently.");
        }
    }

    public sealed record ChangeCollectionLockPasswordRequest(string? CurrentPassword, string? NewPassword, string? ConfirmPassword);

    public sealed record ResetCollectionLockPasswordRequest(string? NewPassword, string? ConfirmPassword);
}
