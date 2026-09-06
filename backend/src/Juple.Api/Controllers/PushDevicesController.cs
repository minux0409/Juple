using Juple.Api.Authentication;
using Juple.Api.Push;
using Juple.Application.Identity;
using Juple.Application.Push;
using Juple.Application.Push.RegisterPushDevice;
using Juple.Application.Push.UnregisterPushDevice;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/push/devices")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class PushDevicesController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IRegisterPushDeviceService registerPushDeviceService,
    IUnregisterPushDeviceService unregisterPushDeviceService) : ControllerBase
{
    /// <summary>Idempotent register/re-register - see IPushDeviceRegistrationStore.RegisterAsync. Called after login/bootstrap and whenever Mobile's FCM/APNs token or in-app language changes.</summary>
    [HttpPut]
    public async Task<IActionResult> RegisterAsync(
        RegisterPushDeviceRequest request, CancellationToken cancellationToken)
    {
        if (!PushPlatformWireFormat.TryParse(request.Platform, out var platform))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["platform"] = ["platform must be 'android' or 'ios'."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var registered = await registerPushDeviceService.RegisterAsync(
                currentUser.UserId,
                new RegisterPushDeviceCommand(platform, request.InstallationId, request.PushToken, request.Locale),
                cancellationToken);

            return Ok(ToResponse(registered));
        }
        catch (InvalidPushDeviceRegistrationException exception)
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
    }

    /// <summary>Called on logout - disables (never deletes) this installation's registration for the current user. Idempotent; 404 only for an installationId that was never registered by this user.</summary>
    [HttpDelete("{installationId}")]
    public async Task<IActionResult> UnregisterAsync(string installationId, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await unregisterPushDeviceService.UnregisterAsync(currentUser.UserId, installationId, cancellationToken);
            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (PushDeviceRegistrationNotFoundException)
        {
            return NotFound();
        }
    }

    private static PushDeviceRegistrationResponse ToResponse(PushDeviceRegistrationDto registration) => new(
        registration.Id,
        PushPlatformWireFormat.ToWireValue(registration.Platform),
        registration.InstallationId,
        registration.IsEnabled,
        registration.UpdatedAtUtc);

    // No pushToken field - see PushDeviceRegistration's own remarks on treating it as a secret,
    // never echoed back via any API response.
    public sealed record PushDeviceRegistrationResponse(
        long Id, string Platform, string InstallationId, bool IsEnabled, DateTimeOffset UpdatedAtUtc);

    public sealed record RegisterPushDeviceRequest(
        string? Platform, string? InstallationId, string? PushToken, string? Locale);
}
