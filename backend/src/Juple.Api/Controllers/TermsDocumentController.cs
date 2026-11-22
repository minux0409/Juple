using Juple.Application.Safety;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/terms/document")]
public sealed class TermsDocumentController(TermsOptions options) : ControllerBase
{
    [AllowAnonymous]
    [HttpGet]
    public IActionResult Get([FromQuery] string version, [FromQuery] string? language = null)
    {
        Response.Headers.CacheControl = "no-store";
        if (version != options.CurrentVersion) return Conflict(new { code = "termsVersionChanged" });
        var document = PublishedTerms.GetDocument(version, language);
        return document is null
            ? StatusCode(StatusCodes.Status503ServiceUnavailable, new { code = "termsDocumentUnavailable" })
            : Ok(document);
    }
}
