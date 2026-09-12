using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Controllers;
using Juple.Application.UrlSafety;
using Juple.Application.UrlSafety.CheckUrlSafety;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.UnitTests.UrlSafety;

public sealed class UrlSafetyControllerTests
{
    private sealed class FakeCheckUrlSafetyService(UrlSafetyResult result) : ICheckUrlSafetyService
    {
        public Task<UrlSafetyResult> CheckAsync(
            CheckUrlSafetyCommand command, CancellationToken cancellationToken = default) =>
            Task.FromResult(result);
    }

    /// <summary>
    /// Guards the two production-safety properties that only show up as attribute metadata, not as
    /// anything a service-level unit test could otherwise exercise: every request must be
    /// authenticated (JupleUser policy - same as every other Juple endpoint) and must go through
    /// the per-user rate limiter (RateLimiterPolicies.UrlSafetyCheck - see Program.cs), since this
    /// endpoint is the first to call a paid external provider per request.
    /// </summary>
    [Fact]
    public void Controller_RequiresJupleUserAuthorizationPolicy()
    {
        var authorizeAttribute = Assert.Single(
            typeof(UrlSafetyController).GetCustomAttributes(typeof(AuthorizeAttribute), inherit: false)
                .Cast<AuthorizeAttribute>());

        Assert.Equal(AuthorizationPolicies.JupleUser, authorizeAttribute.Policy);
    }

    [Fact]
    public void Controller_EnablesUrlSafetyCheckRateLimiterPolicy()
    {
        var rateLimitAttribute = Assert.Single(
            typeof(UrlSafetyController).GetCustomAttributes(typeof(EnableRateLimitingAttribute), inherit: false)
                .Cast<EnableRateLimitingAttribute>());

        Assert.Equal(RateLimiterPolicies.UrlSafetyCheck, rateLimitAttribute.PolicyName);
    }

    [Theory]
    [InlineData(UrlSafetyStatus.ThreatDetected, "threatDetected")]
    [InlineData(UrlSafetyStatus.NoKnownThreat, "noKnownThreat")]
    [InlineData(UrlSafetyStatus.CheckUnavailable, "checkUnavailable")]
    public async Task CheckAsync_MapsStatusToExplicitCamelCaseWireValue(UrlSafetyStatus status, string expected)
    {
        var controller = new UrlSafetyController();

        var actionResult = await controller.CheckAsync(
            new UrlSafetyController.UrlSafetyCheckRequest("https://example.com/a"),
            new FakeCheckUrlSafetyService(new UrlSafetyResult(status, [])),
            CancellationToken.None);

        var okResult = Assert.IsType<OkObjectResult>(actionResult.Result);
        var response = Assert.IsType<UrlSafetyController.UrlSafetyCheckResponse>(okResult.Value);
        Assert.Equal(expected, response.Status);
    }

    [Fact]
    public async Task CheckAsync_MapsThreatCategoriesToExplicitCamelCaseWireValues()
    {
        var controller = new UrlSafetyController();
        var threats = new[]
        {
            UrlThreatCategory.Malware,
            UrlThreatCategory.SocialEngineering,
            UrlThreatCategory.UnwantedSoftware,
            UrlThreatCategory.Other,
        };

        var actionResult = await controller.CheckAsync(
            new UrlSafetyController.UrlSafetyCheckRequest("https://example.com/a"),
            new FakeCheckUrlSafetyService(new UrlSafetyResult(UrlSafetyStatus.ThreatDetected, threats)),
            CancellationToken.None);

        var okResult = Assert.IsType<OkObjectResult>(actionResult.Result);
        var response = Assert.IsType<UrlSafetyController.UrlSafetyCheckResponse>(okResult.Value);
        Assert.Equal(["malware", "socialEngineering", "unwantedSoftware", "other"], response.Threats);
    }

    [Fact]
    public async Task CheckAsync_WhenUrlIsInvalid_ReturnsBadRequestWithFieldError()
    {
        var controller = new UrlSafetyController();

        var actionResult = await controller.CheckAsync(
            new UrlSafetyController.UrlSafetyCheckRequest("not a url"),
            new ThrowingCheckUrlSafetyService(),
            CancellationToken.None);

        var badRequestResult = Assert.IsType<BadRequestObjectResult>(actionResult.Result);
        var problemDetails = Assert.IsType<ValidationProblemDetails>(badRequestResult.Value);
        Assert.True(problemDetails.Errors.ContainsKey("url"));
    }

    private sealed class ThrowingCheckUrlSafetyService : ICheckUrlSafetyService
    {
        public Task<UrlSafetyResult> CheckAsync(
            CheckUrlSafetyCommand command, CancellationToken cancellationToken = default) =>
            throw new InvalidUrlSafetyRequestException("url", "A valid HTTP or HTTPS URL using its default port is required.");
    }
}
