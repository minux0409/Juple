using System.Text.RegularExpressions;
using Juple.Api.Configuration;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

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

    /// <summary>
    /// The origins Production is deployed with (infra/azure/app/prod.bicepparam): the user Web and the Admin Web, https only, no
    /// local or Dev origin - read from the file itself so a careless edit fails here instead of at deployment.
    /// </summary>
    [Fact]
    public void ProductionParameterFile_AllowsExactlyTheUserWebAndTheAdminWeb()
    {
        var origins = AuthenticatedWebCors.NormalizeOrigins(ProductionAllowedOrigins());

        Assert.Equal(["https://juple.co.kr", "https://admin.juple.co.kr"], origins);
        Assert.All(origins, origin =>
        {
            Assert.StartsWith("https://", origin, StringComparison.Ordinal);
            Assert.DoesNotContain("localhost", origin, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("dev.", origin, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Theory]
    [InlineData("https://juple.co.kr", "GET", true)]
    [InlineData("https://admin.juple.co.kr", "PUT", true)]
    [InlineData("https://admin.juple.co.kr", "GET", true)]
    [InlineData("https://evil.example", "GET", false)]
    [InlineData("http://admin.juple.co.kr", "GET", false)]
    [InlineData("https://admin.juple.co.kr.evil.example", "GET", false)]
    public void ProductionPreflight_AllowsTheBearerCallsOfTheTwoWebApps_AndNobodyElse(string origin, string method, bool allowed)
    {
        var policy = AuthenticatedWebCors.BuildPolicy(AuthenticatedWebCors.NormalizeOrigins(ProductionAllowedOrigins()));
        var context = new DefaultHttpContext();
        context.Request.Method = "OPTIONS";
        context.Request.Headers.Origin = origin;
        context.Request.Headers.AccessControlRequestMethod = method;
        context.Request.Headers.AccessControlRequestHeaders = "authorization,content-type";

        var result = new CorsService(Options.Create(new CorsOptions()), NullLoggerFactory.Instance).EvaluatePolicy(context, policy);

        Assert.True(result.IsPreflightRequest);
        Assert.Equal(allowed, result.IsOriginAllowed);
        Assert.False(result.SupportsCredentials);
        if (allowed)
        {
            Assert.Equal(origin, result.AllowedOrigin);
            Assert.Contains(method, result.AllowedMethods);
            Assert.Contains("authorization", result.AllowedHeaders, StringComparer.OrdinalIgnoreCase);
        }
    }

    private static string[] ProductionAllowedOrigins()
    {
        var text = File.ReadAllText(RepositoryFile("infra", "azure", "app", "prod.bicepparam"));
        var line = Regex.Match(text, @"^param authenticatedWebAllowedOrigins = \[(?<list>[^\]]*)\]", RegexOptions.Multiline);
        Assert.True(line.Success, "infra/azure/app/prod.bicepparam must assign authenticatedWebAllowedOrigins as a one-line list.");
        return [.. Regex.Matches(line.Groups["list"].Value, "'(?<origin>[^']*)'").Select(match => match.Groups["origin"].Value)];
    }

    private static string RepositoryFile(params string[] parts)
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine([directory.FullName, .. parts]);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException($"{string.Join('/', parts)} was not found above {AppContext.BaseDirectory}.");
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
