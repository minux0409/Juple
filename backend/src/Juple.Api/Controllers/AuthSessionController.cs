using Juple.Api.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/auth/session")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class AuthSessionController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => NoContent();
}