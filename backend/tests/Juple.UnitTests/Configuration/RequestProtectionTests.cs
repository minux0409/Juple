using System.Net;
using System.Security.Claims;
using Juple.Api.Configuration;
using Juple.Application;
using Juple.Infrastructure.UrlMetadata;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using System.Threading.RateLimiting;

namespace Juple.UnitTests.Configuration;

public sealed class RequestProtectionTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly Guid User = Guid.NewGuid();

    private static DefaultHttpContext Context(string controller = "Items", string action = "List", string method = "GET",
        Guid? user = null, bool anonymous = false, string? namedPolicy = null)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.1");
        context.Request.Method = method;
        context.Response.Body = new MemoryStream();
        if (!anonymous) context.User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim("http://schemas.microsoft.com/identity/claims/tenantid", Tenant.ToString()),
            new Claim("http://schemas.microsoft.com/identity/claims/objectidentifier", (user ?? User).ToString()),
        ], "validated-test-token"));
        var metadata = new List<object> { new ControllerActionDescriptor { ControllerName = controller, ActionName = action } };
        if (controller == "ItemImages") metadata.Add(new Microsoft.AspNetCore.Http.Timeouts.RequestTimeoutAttribute(RequestProtection.ImageTimeoutPolicy));
        if (namedPolicy is not null) metadata.Add(new EnableRateLimitingAttribute(namedPolicy));
        context.SetEndpoint(new Endpoint(_ => Task.CompletedTask, new EndpointMetadataCollection(metadata), "test"));
        return context;
    }

    private static (ServiceProvider Provider, RequestDelegate Pipeline) Pipeline(RequestProtectionOptions settings, RequestDelegate next)
    {
        var services = new ServiceCollection().AddLogging().AddMetrics().AddRouting();
        services.AddRequestTimeouts(options => options.AddPolicy(RequestProtection.ImageTimeoutPolicy, TimeSpan.FromSeconds(settings.ImageRequestTimeoutSeconds)));
        services.AddRateLimiter(options =>
        {
            RequestProtection.Configure(options, settings);
            RateLimitPolicies.ConfigureEndpointPolicies(options);
            options.AddFixedWindowLimiter("existing-strict", limiter =>
            {
                limiter.PermitLimit = 1; limiter.Window = TimeSpan.FromHours(1); limiter.QueueLimit = 0;
            });
        });
        var provider = services.BuildServiceProvider();
        var builder = new ApplicationBuilder(provider);
        builder.UseRequestTimeouts();
        builder.UseRateLimiter();
        builder.Run(next);
        return (provider, builder.Build());
    }

    [Fact]
    public async Task RefusalHasProblemDetailsRetryAfter_AndNeverEntersAuthorizationDatabaseBlobOrHttp()
    {
        var expensiveCalls = 0;
        var (provider, pipeline) = Pipeline(new() { AccountPerMinute = 1 }, _ => { expensiveCalls++; return Task.CompletedTask; });
        await using var cleanup = provider;
        await pipeline(Context());
        var refused = Context();
        await pipeline(refused);
        Assert.Equal(1, expensiveCalls);
        Assert.Equal(429, refused.Response.StatusCode);
        Assert.InRange(int.Parse(refused.Response.Headers.RetryAfter!), 1, 60);
        Assert.StartsWith("application/problem+json", refused.Response.ContentType);
        refused.Response.Body.Position = 0;
        var json = await new StreamReader(refused.Response.Body).ReadToEndAsync();
        Assert.Contains("rateLimited", json);
        Assert.DoesNotContain(User.ToString(), json);
    }

    [Fact]
    public async Task SameValidatedIdentityAcrossPlatformsSharesBudget_OtherAccountDoesNot()
    {
        var (provider, pipeline) = Pipeline(new() { AccountPerMinute = 2 }, _ => Task.CompletedTask);
        await using var cleanup = provider;
        foreach (var platform in new[] { "android", "ios", "web" })
        {
            var context = Context();
            context.Request.Headers["X-Juple-Platform"] = platform;
            await pipeline(context);
            Assert.Equal(platform == "web" ? 429 : 200, context.Response.StatusCode);
        }
        var other = Context(user: Guid.NewGuid());
        await pipeline(other);
        Assert.Equal(200, other.Response.StatusCode);
    }

    [Fact]
    public async Task AnonymousXffForgeryDoesNotMintBuckets_AndMappedAddressesNormalize()
    {
        var (provider, pipeline) = Pipeline(new() { AnonymousIpLimitsEnabled = true, PublicReadPerMinute = 2 }, _ => Task.CompletedTask);
        await using var cleanup = provider;
        for (var index = 0; index < 3; index++)
        {
            var context = Context("PublicCollections", anonymous: true);
            context.Request.Headers["X-Forwarded-For"] = $"198.51.100.{index}";
            if (index == 2) context.Connection.RemoteIpAddress = IPAddress.Parse("::ffff:192.0.2.1");
            await pipeline(context);
            Assert.Equal(index == 2 ? 429 : 200, context.Response.StatusCode);
        }
        var ipv6 = Context(anonymous: true);
        ipv6.Connection.RemoteIpAddress = IPAddress.Parse("2001:db8:1:2::1");
        var key = RateLimitPolicies.IdentityPartitionKey(ipv6);
        ipv6.Connection.RemoteIpAddress = IPAddress.Parse("2001:db8:1:2:abcd::ffff");
        Assert.Equal(key, RateLimitPolicies.IdentityPartitionKey(ipv6));
    }

    [Fact]
    public async Task RotatingAnonymousUnlockAttemptHeadersCannotBypassTheCoarseIpBudget()
    {
        var calls = 0;
        var (provider, pipeline) = Pipeline(new() { AnonymousIpLimitsEnabled = true, AnonymousPerMinute = 2 }, _ => { calls++; return Task.CompletedTask; });
        await using var cleanup = provider;
        for (var index = 0; index < 3; index++)
        {
            var context = Context("PublicCollections", "Unlock", "POST", anonymous: true);
            context.Request.Headers["X-Juple-Unlock-Attempt"] = Guid.NewGuid().ToString("N");
            context.Request.Headers["X-Forwarded-For"] = $"198.51.100.{index}";
            await pipeline(context);
            Assert.Equal(index == 2 ? 429 : 200, context.Response.StatusCode);
        }
        Assert.Equal(2, calls);
    }

    [Fact]
    public void UnauthenticatedOrMalformedClaimsCannotChooseAccountBucket()
    {
        var context = Context();
        context.User = new ClaimsPrincipal(new ClaimsIdentity(context.User.Claims));
        Assert.StartsWith("ip:", RateLimitPolicies.IdentityPartitionKey(context));
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("tid", "not-a-guid"), new Claim("oid", User.ToString())], "test"));
        Assert.StartsWith("ip:", RateLimitPolicies.IdentityPartitionKey(context));
    }

    [Fact]
    public async Task ExistingStricterPolicyStillApplies_AlsoWhenNewLimitsDisabled()
    {
        foreach (var enabled in new[] { true, false })
        {
            var (provider, pipeline) = Pipeline(new() { Enabled = enabled }, _ => Task.CompletedTask);
            await using var cleanup = provider;
            await pipeline(Context(namedPolicy: "existing-strict"));
            var context = Context(namedPolicy: "existing-strict");
            await pipeline(context);
            Assert.Equal(429, context.Response.StatusCode);
        }
    }

    [Theory]
    [InlineData(RateLimitPolicies.BillingGoogle, "BillingGoogle", "Catalog", "GET", 60)]
    [InlineData(RateLimitPolicies.DataExport, "DataExport", "Create", "POST", 10)]
    [InlineData(RateLimitPolicies.CollectionLockPassword, "CollectionLockSettings", "Change", "PUT", 5)]
    [InlineData(RateLimitPolicies.PublicCollectionUnlock, "PublicCollections", "Unlock", "POST", 10)]
    public async Task ProductionEndpointPoliciesKeepTheirOwnLimitsWithOrWithoutGlobalAdmission(
        string policy, string controller, string action, string method, int permits)
    {
        foreach (var enabled in new[] { true, false })
        {
            var calls = 0;
            // Make the new password bucket generous so this proves the EXISTING policy rejects.
            var (provider, pipeline) = Pipeline(new() { Enabled = enabled, PasswordPer15Minutes = 100 },
                _ => { calls++; return Task.CompletedTask; });
            await using var cleanup = provider;
            for (var index = 0; index <= permits; index++)
            {
                var context = Context(controller, action, method, anonymous: controller == "PublicCollections", namedPolicy: policy);
                await pipeline(context);
                Assert.Equal(index == permits ? 429 : 200, context.Response.StatusCode);
            }
            Assert.Equal(permits, calls);
        }
    }

    [Fact]
    public async Task SharedUnverifiedIngressDoesNotThrottlePublicVisitorsByDefault()
    {
        Assert.False(new RequestProtectionOptions().AnonymousIpLimitsEnabled);
        var (provider, pipeline) = Pipeline(new(), _ => Task.CompletedTask);
        await using var cleanup = provider;
        // Distinct visitors can present the same socket peer. XFF is intentionally not trusted.
        for (var index = 0; index < 400; index++)
        {
            var context = Context("PublicCollections", anonymous: true);
            context.Request.Headers["X-Forwarded-For"] = $"198.51.100.{index % 250 + 1}";
            await pipeline(context);
            Assert.Equal(200, context.Response.StatusCode);
        }
    }

    [Fact]
    public async Task ThreePlatformsStartupHistorySearchSocialAndFiveSequentialImagesFitOneAccountBudget()
    {
        var (provider, pipeline) = Pipeline(new(), async _ => await Task.Yield());
        await using var cleanup = provider;
        await Task.WhenAll(new[] { "android", "ios", "web" }.Select(async platform =>
        {
            var plan = new List<(string, string, string)>
            {
                ("CurrentUserBootstrap", "Bootstrap", "POST"), ("AuthSession", "Get", "GET"),
                ("Terms", "Get", "GET"), ("Items", "List", "GET"), ("Items", "Count", "GET"),
                ("Notifications", "Unread", "GET"), ("Friends", "Request", "POST"),
                ("Notifications", "List", "GET"), ("Collections", "AddComment", "POST"),
                ("Collections", "Comments", "GET"),
            };
            plan.AddRange(Enumerable.Repeat(("Items", "GetHistory", "GET"), 20));
            plan.AddRange(Enumerable.Repeat(("Collections", "Search", "GET"), 5));
            foreach (var (controller, action, method) in plan)
            {
                var context = Context(controller, action, method);
                context.Request.Headers["X-Juple-Platform"] = platform;
                await pipeline(context);
                Assert.Equal(200, context.Response.StatusCode);
            }
        }));
        for (var index = 0; index < 5; index++)
        {
            var image = Context("ItemImages", "Upload", "POST");
            await pipeline(image);
            Assert.Equal(200, image.Response.StatusCode);
        }
    }

    [Fact]
    public async Task ConcurrentAdminDashboardReadsAreAllowed()
    {
        var (provider, pipeline) = Pipeline(new(), async _ => await Task.Yield());
        await using var cleanup = provider;
        var contexts = Enumerable.Range(0, 20).Select(_ => Context("AdminAnalytics", "Dashboard")).ToArray();
        await Task.WhenAll(contexts.Select(pipeline.Invoke));
        Assert.All(contexts, context => Assert.Equal(200, context.Response.StatusCode));
    }

    [Fact]
    public async Task ServerConfigurationOverridesAdmissionWithoutAClientContractChange()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["RequestProtection:AccountPerMinute"] = "2",
            ["RequestProtection:ReadPerMinute"] = "1",
            ["RequestProtection:AnonymousIpLimitsEnabled"] = "false",
        }).Build();
        var settings = configuration.GetSection(RequestProtectionOptions.SectionName).Get<RequestProtectionOptions>()!;
        var (provider, pipeline) = Pipeline(settings, _ => Task.CompletedTask);
        await using var cleanup = provider;
        await pipeline(Context());
        var refused = Context();
        await pipeline(refused);
        Assert.Equal(429, refused.Response.StatusCode);
        Assert.Equal(2, settings.AccountPerMinute);
    }

    [Theory]
    [InlineData(RateLimitPolicies.DataExportDownload)]
    [InlineData(RateLimitPolicies.ExpenseFiles)]
    public async Task ExistingStreamingConcurrencyLimitsComposeAndReleaseWithGlobalAdmission(string policy)
    {
        var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var (provider, pipeline) = Pipeline(new(), async _ => await finish.Task);
        await using var cleanup = provider;
        var active = Enumerable.Range(0, 4).Select(_ => pipeline(Context(namedPolicy: policy))).ToArray();
        var refused = Context(namedPolicy: policy);
        await pipeline(refused);
        Assert.Equal(429, refused.Response.StatusCode);
        finish.SetResult();
        await Task.WhenAll(active).WaitAsync(TimeSpan.FromSeconds(5));
        var recovered = Context(namedPolicy: policy);
        await pipeline(recovered);
        Assert.Equal(200, recovered.Response.StatusCode);
    }

    [Fact]
    public async Task ActiveUploadCancellationReleasesItsSlot()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var (provider, pipeline) = Pipeline(new(), async context =>
        {
            if (Interlocked.Increment(ref calls) != 1) return;
            entered.SetResult();
            await Task.Delay(Timeout.Infinite, context.RequestAborted);
        });
        await using var cleanup = provider;
        using var cancellation = new CancellationTokenSource();
        var active = Context("ItemImages", "Upload", "POST");
        active.RequestAborted = cancellation.Token;
        var first = pipeline(active);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        var next = Context("ItemImages", "Upload", "POST");
        await pipeline(next).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(200, next.Response.StatusCode);
    }

    [Fact]
    public async Task NormalStartupTenLinksPreviewScrollSearchImageSequenceAndPushAreAllowed()
    {
        // Minute workload compressed into one loop; default burst is verified separately.
        var (provider, pipeline) = Pipeline(new() { BrowseReadPerFiveSeconds = 1000 }, _ => Task.CompletedTask);
        await using var cleanup = provider;
        var operations = new List<(string, string, string)> { ("CurrentUserBootstrap", "Bootstrap", "POST"), ("AuthSession", "Get", "GET") };
        operations.AddRange(Enumerable.Repeat(("Inbox", "Save", "POST"), 10));
        operations.AddRange(Enumerable.Repeat(("UrlMetadata", "Resolve", "POST"), 10));
        // A reviewed link may also update title/memo + preview, load destinations, then refresh
        // Home's list and count. Count each HTTP call, not just the user-facing Save action.
        operations.AddRange(Enumerable.Repeat(("Items", "UpdateDetails", "PUT"), 10));
        operations.AddRange(Enumerable.Repeat(("Items", "SetPreviewImage", "PUT"), 10));
        operations.AddRange(Enumerable.Repeat(("Collections", "List", "GET"), 10));
        operations.AddRange(Enumerable.Repeat(("Items", "GetHistory", "GET"), 20));
        operations.AddRange(Enumerable.Repeat(("Collections", "GetItems", "GET"), 40));
        operations.AddRange(Enumerable.Repeat(("ItemImages", "Upload", "POST"), 10));
        operations.AddRange(Enumerable.Repeat(("Collections", "Create", "POST"), 10));
        operations.AddRange(Enumerable.Repeat(("Collections", "AddComment", "POST"), 20));
        operations.AddRange(Enumerable.Repeat(("PushDevices", "Register", "PUT"), 4));
        operations.AddRange(Enumerable.Repeat(("Collections", "Unlock", "POST"), 10));
        foreach (var (controller, action, method) in operations)
        {
            var context = Context(controller, action, method);
            await pipeline(context);
            Assert.Equal(200, context.Response.StatusCode);
        }
    }

    [Fact]
    public async Task ImageQueueIsBoundedBeforeTheBodyIsRead_AndCancellationReturnsPermits()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var (provider, pipeline) = Pipeline(new(), async _ => { Interlocked.Increment(ref calls); entered.TrySetResult(); await finish.Task; });
        await using var cleanup = provider;
        var first = pipeline(Context("ItemImages", "Upload", "POST"));
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        using var cancellation = new CancellationTokenSource();
        var queued = Context("ItemImages", "Upload", "POST");
        queued.RequestAborted = cancellation.Token;
        var second = pipeline(queued);
        var third = pipeline(Context("UserProfile", "SetImage", "PUT"));
        var refused = Context("Collections", "SetIconImage", "PUT");
        await pipeline(refused);
        Assert.Equal(429, refused.Response.StatusCode);
        Assert.Equal(1, calls);
        cancellation.Cancel();
        finish.SetResult();
        await Task.WhenAll(first, second, third).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task StalledUploadTimesOut_AndReleasesTheImageSlotForTheNextRequest()
    {
        var calls = 0;
        var (provider, pipeline) = Pipeline(new() { ImageRequestTimeoutSeconds = 1 }, async context =>
        {
            if (Interlocked.Increment(ref calls) == 1) await Task.Delay(Timeout.Infinite, context.RequestAborted);
        });
        await using var cleanup = provider;
        var stalled = Context("ItemImages", "Upload", "POST");
        await pipeline(stalled).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(504, stalled.Response.StatusCode);
        var next = Context("ItemImages", "Upload", "POST");
        await pipeline(next).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(200, next.Response.StatusCode);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task AdminGateRunsBeforeDownstreamAuthorization_AndRtdnHealthAreExempt()
    {
        var calls = 0;
        var (provider, pipeline) = Pipeline(new() { AdminPerMinute = 1 }, _ => { calls++; return Task.CompletedTask; });
        await using var cleanup = provider;
        await pipeline(Context("Admin"));
        var refused = Context("Admin");
        await pipeline(refused);
        Assert.Equal(429, refused.Response.StatusCode);
        Assert.Equal(1, calls);
        for (var index = 0; index < 5; index++) await pipeline(Context("GoogleRtdn", "Receive", "POST", anonymous: true));
        var health = Context(); health.SetEndpoint(null);
        await pipeline(health);
        Assert.Equal(7, calls);
    }

    [Fact]
    public void MetadataOutboundGateRefusesBeforeWork_AndDisposalRestoresCapacity()
    {
        using var gate = new MetadataWorkGate(1);
        using (gate.Enter()) Assert.Throws<RequestCapacityExceededException>(() => gate.Enter());
        using var restored = gate.Enter();
    }

    [Fact]
    public async Task SaturatedMetadataHttpWorkRefusesOtherAccountsBeforeDownstreamWork()
    {
        var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var (provider, pipeline) = Pipeline(new(), async _ => { Interlocked.Increment(ref calls); await finish.Task; });
        await using var cleanup = provider;
        var active = Enumerable.Range(0, 4).Select(_ => pipeline(Context("UrlMetadata", "Resolve", "POST", Guid.NewGuid()))).ToArray();
        var refused = Context("Inbox", "Save", "POST", Guid.NewGuid());
        await pipeline(refused);
        Assert.Equal(429, refused.Response.StatusCode);
        Assert.Equal(4, calls);
        finish.SetResult();
        await Task.WhenAll(active).WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task ResolverCapacityRefusesBeforeAnyOutboundHandlerRuns()
    {
        using var gate = new MetadataWorkGate(1);
        using var held = gate.Enter();
        using var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions { SizeLimit = 500 });
        var handler = new NeverSendHandler();
        using var client = new HttpClient(handler);
        var resolver = new UrlMetadataResolver(client, cache, TimeProvider.System,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<UrlMetadataResolver>.Instance, gate);
        await Assert.ThrowsAsync<RequestCapacityExceededException>(() => resolver.ResolveAsync("https://example.test/metadata"));
        Assert.Equal(0, handler.Calls);
    }

    private sealed class NeverSendHandler : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            throw new InvalidOperationException("Outbound HTTP must not run.");
        }
    }

    [Theory]
    [InlineData("Collections", "AddComment", "social")]
    [InlineData("Collections", "SetReaction", "social")]
    [InlineData("Collections", "Merge", "bulk")]
    [InlineData("Collections", "SetSharePassword", "password")]
    public void CostlyOperationsUseDedicatedBuckets(string controller, string action, string category) =>
        Assert.Equal(category, RequestProtection.Category(Context(controller, action, "POST")));

    [Fact]
    public void PushUnregistrationDoesNotShareTheRegistrationBudget()
    {
        Assert.Equal("push", RequestProtection.Category(Context("PushDevices", "Register", "PUT")));
        Assert.Null(RequestProtection.Category(Context("PushDevices", "Unregister", "DELETE")));
    }

    [Fact]
    public void RealMvcDescriptorsRouteCostlyActionsIntoTheirBudgets()
    {
        var services = new ServiceCollection().AddLogging();
        services.AddControllers().AddApplicationPart(typeof(Juple.Api.Controllers.InboxController).Assembly);
        using var provider = services.BuildServiceProvider();
        var descriptors = provider.GetRequiredService<IActionDescriptorCollectionProvider>().ActionDescriptors.Items.OfType<ControllerActionDescriptor>().ToArray();
        var cases = new[]
        {
            ("Items", "GetHistoryAsync", "browse"), ("Items", "GetDetailAsync", "browse"),
            ("Collections", "ListAsync", "browse"), ("ItemImages", "ListAsync", "browse"),
            ("Inbox", "SaveAsync", "link"), ("UrlMetadata", "ResolveAsync", "metadata"),
            ("ItemImages", "UploadAsync", "image"), ("UserProfile", "SetImageAsync", "image"),
            ("Collections", "SetIconImageAsync", "image"), ("Collections", "CreateAsync", "collection-create"),
            ("Collections", "MergeAsync", "bulk"), ("Collections", "AddCommentAsync", "social"),
            ("Collections", "SetReactionAsync", "social"), ("Collections", "SetSharePasswordAsync", "password"),
            ("Collections", "UnlockAsync", "password-verify"), ("PushDevices", "RegisterAsync", "push"),
        };
        foreach (var (controller, method, category) in cases)
        {
            var descriptor = Assert.Single(descriptors, d => d.ControllerName == controller && d.MethodInfo.Name == method);
            var verb = descriptor.ActionConstraints!.OfType<Microsoft.AspNetCore.Mvc.ActionConstraints.HttpMethodActionConstraint>().Single().HttpMethods.First();
            var context = Context(controller, method, verb);
            context.SetEndpoint(new Endpoint(null, new EndpointMetadataCollection(descriptor), "actual MVC action"));
            Assert.Equal(category, RequestProtection.Category(context));
        }
    }
    [Fact]
    public async Task BrowseMinuteBoundaryIsIndependentOfWriteBudget_AndDiagnosticIdentifiesTheGate()
    {
        var calls = 0;
        var (provider, pipeline) = Pipeline(new() { BrowseReadPerFiveSeconds = 1000 }, _ => { calls++; return Task.CompletedTask; });
        await using var cleanup = provider;
        for (var i = 0; i < 600; i++)
        {
            var context = Context("Items", "GetDetail");
            await pipeline(context);
            Assert.Equal(200, context.Response.StatusCode);
        }
        var refused = Context("Collections", "List");
        await pipeline(refused);
        Assert.Equal(429, refused.Response.StatusCode);
        refused.Response.Body.Position = 0;
        Assert.Contains("\"limiter\":\"browse\"", await new StreamReader(refused.Response.Body).ReadToEndAsync());
        Assert.Equal(600, calls);
        var write = Context("Inbox", "Save", "POST");
        await pipeline(write);
        Assert.Equal(200, write.Response.StatusCode);
        var another = Context("Items", "GetDetail", user: Guid.NewGuid());
        await pipeline(another);
        Assert.Equal(200, another.Response.StatusCode);
    }

    [Fact]
    public async Task BrowseBurstIsSixtyAcrossPlatforms_AndRetainsRetryAfter()
    {
        var (provider, pipeline) = Pipeline(new(), _ => Task.CompletedTask);
        await using var cleanup = provider;
        for (var i = 0; i <= 60; i++)
        {
            var context = Context("Items", "GetHistoryByDate");
            context.Request.Headers["X-Juple-Platform"] = new[] { "android", "ios", "web" }[i % 3];
            await pipeline(context);
            Assert.Equal(i == 60 ? 429 : 200, context.Response.StatusCode);
            if (i == 60)
            {
                Assert.InRange(int.Parse(context.Response.Headers.RetryAfter!), 1, 5);
                context.Response.Body.Position = 0;
                Assert.Contains("browse-burst", await new StreamReader(context.Response.Body).ReadToEndAsync());
            }
        }
    }

    [Fact]
    public async Task BrowseDoesNotExemptOtherReadsOrSensitiveWrites()
    {
        var (provider, pipeline) = Pipeline(new() { AccountPerMinute = 2, ReadPerMinute = 1 }, _ => Task.CompletedTask);
        await using var cleanup = provider;
        await pipeline(Context("Items", "GetHistory"));
        await pipeline(Context("Items", "GetHistory"));
        await pipeline(Context("AuthSession", "Get"));
        var read = Context("Notifications", "List");
        await pipeline(read);
        Assert.Equal(429, read.Response.StatusCode);
        Assert.NotEqual("browse", RequestProtection.Category(Context("Items", "GetDetail", "POST")));
        Assert.Equal("password", RequestProtection.Category(Context("Collections", "SetSharePassword", "PUT")));
        Assert.Equal("social", RequestProtection.Category(Context("Friends", "Accept", "POST")));
    }

    [Fact]
    public async Task TwoDevicesThirtyLinkDetailVisitsAndStartupFitTheMinuteBudget()
    {
        // Compress a whole minute into one loop. The separate default burst test enforces 60/5s.
        var (provider, pipeline) = Pipeline(new() { BrowseReadPerFiveSeconds = 1000 }, _ => Task.CompletedTask);
        await using var cleanup = provider;
        var requests = 0;
        foreach (var platform in new[] { "android", "web" })
        {
            for (var visit = 0; visit < 30; visit++)
            {
                // Current access preflight, contextual preflight, detail popup, images, memberships.
                foreach (var (controller, action) in new[] { ("Collections", "Get"), ("Items", "GetDetail"), ("Items", "GetDetail"), ("ItemImages", "List"), ("Collections", "List") })
                {
                    var context = Context(controller, action);
                    context.Request.Headers["X-Juple-Platform"] = platform;
                    await pipeline(context);
                    Assert.Equal(200, context.Response.StatusCode);
                    requests++;
                }
            }
            // Initial summary + two expanded pages; two later focus refreshes of the same shape.
            for (var refresh = 0; refresh < 3; refresh++)
                foreach (var action in new[] { "GetHistorySections", "GetHistory", "GetHistory" })
                {
                    var context = Context("Items", action);
                    await pipeline(context);
                    Assert.Equal(200, context.Response.StatusCode);
                    requests++;
                }
        }
        Assert.Equal(318, requests);
    }

    [Fact]
    public async Task BurstWindowReplenishesWithoutChangingOtherPolicies()
    {
        var (provider, pipeline) = Pipeline(new() { BrowseReadPerFiveSeconds = 1 }, _ => Task.CompletedTask);
        await using var cleanup = provider;
        await pipeline(Context("Items", "GetHistory"));
        var refused = Context("Items", "GetHistory");
        await pipeline(refused);
        Assert.Equal(429, refused.Response.StatusCode);
        await Task.Delay(TimeSpan.FromSeconds(5.2));
        var recovered = Context("Items", "GetHistory");
        await pipeline(recovered);
        Assert.Equal(200, recovered.Response.StatusCode);
    }

}
