using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/users/me")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class CurrentUserBootstrapController : ControllerBase
{
    [HttpPost("bootstrap")]
    public async Task<IActionResult> BootstrapAsync(
        BootstrapCurrentUserRequest request,
        [FromServices] IExternalIdentityAccessor externalIdentityAccessor,
        [FromServices] ICurrentUserBootstrapService bootstrapService,
        CancellationToken cancellationToken)
    {
        try
        {
            await bootstrapService.BootstrapAsync(
                externalIdentityAccessor.GetRequired(),
                new BootstrapCurrentUserCommand(request.PreferredLocale, request.TimeZoneId),
                cancellationToken);
            return NoContent();
        }
        catch (InvalidCurrentUserBootstrapRequestException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    public sealed record BootstrapCurrentUserRequest(string? PreferredLocale, string? TimeZoneId);
}