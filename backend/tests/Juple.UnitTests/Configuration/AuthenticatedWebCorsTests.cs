using Juple.Api.Configuration;

namespace Juple.UnitTests.Configuration;

/// <summary>The signed-in Web app's CORS: only configured origins, the API's methods and headers, never any origin or credentials.</summary>
public sealed class AuthenticatedWebCorsTests
{
    [Fact]
    public void ConfiguredOrigins_AreNormalized_AndDeduplicated()
    {
        var origins = AuthenticatedWebCors.NormalizeOrigins(["http://localhost:3000/", "https://dev.juple.co.kr", " https://DEV.juple.co.kr/ ", null, ""]);

        Assert.Equal(["http://localhost:3000", "https://dev.juple.co.kr"], origins);
    }

    [Theory]
    [InlineData("*")]
    [InlineData("https://*.juple.co.kr")]
    [InlineData("dev.juple.co.kr")]
    [InlineData("/relative")]
    [InlineData("https://dev.juple.co.kr/app")]
    [InlineData("https://dev.juple.co.kr/?x=1")]
    [InlineData("ftp://dev.juple.co.kr")]
    [InlineData("https://user@dev.juple.co.kr")]
    public void AnythingButAPlainOrigin_StopsStartup_NamingTheValue(string configured)
    {
        var exception = Assert.Throws<InvalidOperationException>(() => AuthenticatedWebCors.NormalizeOrigins([configured]));

        Assert.Contains(AuthenticatedWebCors.AllowedOriginsSection, exception.Message, StringComparison.Ordinal);
        Assert.Contains(configured.Trim(), exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Policy_AllowsOnlyTheConfiguredOrigins_TheApiMethods_AndTheBearerHeaders_WithoutCredentials()
    {
        var policy = AuthenticatedWebCors.BuildPolicy(["http://localhost:3000", "https://dev.juple.co.kr"]);

        Assert.False(policy.AllowAnyOrigin);
        Assert.False(policy.SupportsCredentials);
        Assert.False(policy.AllowAnyMethod);
        Assert.False(policy.AllowAnyHeader);
        Assert.Equal(["http://localhost:3000", "https://dev.juple.co.kr"], policy.Origins);
        Assert.Equal(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], policy.Methods);
        Assert.Equal(["Authorization", "Content-Type", "X-Juple-Collection-Unlock"], policy.Headers);
        Assert.True(policy.IsOriginAllowed("http://localhost:3000"));
        Assert.False(policy.IsOriginAllowed("https://evil.example"));
        Assert.Equal(AuthenticatedWebCors.PreflightMaxAge, policy.PreflightMaxAge);
    }

    [Fact]
    public void NothingConfigured_AllowsNoCrossOriginRequest()
    {
        var policy = AuthenticatedWebCors.BuildPolicy(AuthenticatedWebCors.NormalizeOrigins([]));

        Assert.Empty(policy.Origins);
        Assert.False(policy.AllowAnyOrigin);
        Assert.False(policy.IsOriginAllowed("http://localhost:3000"));
    }
}
