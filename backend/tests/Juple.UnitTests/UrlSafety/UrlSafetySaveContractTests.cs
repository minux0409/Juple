using Juple.Api.Controllers;
using Juple.Application.Identity;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.Inbox;
using Juple.Application.UrlMetadata.ResolveUrlMetadata;
using Juple.Application.UrlMetadata;
using Juple.Application.UrlSafety;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Mvc;

namespace Juple.UnitTests.UrlSafety;

public sealed class UrlSafetySaveContractTests
{
    [Theory]
    [InlineData(UrlSafetyStatus.ThreatDetected, "unsafe_url")]
    [InlineData(UrlSafetyStatus.CheckUnavailable, "url_safety_check_unavailable")]
    public async Task SaveAndMetadata_ReturnMachineReadableProblem(UrlSafetyStatus status, string code)
    {
        var checker = new FakeUrlSafetyChecker(status);
        var store = new NeverSaveStore();
        var result = await new InboxController().SaveAsync(
            new InboxController.SaveInboxEntryRequest("https://example.com/", null),
            new IdentityAccessor(), new UserAccessor(),
            new InboxEntrySaveService(store, TimeProvider.System, checker, new NeverFetchResolver()), CancellationToken.None);
        AssertProblem(result.Result, code);

        var metadata = await new UrlMetadataController().ResolveAsync(
            new UrlMetadataController.ResolveUrlMetadataRequest("https://example.com/"),
            new ResolveUrlMetadataService(new NeverFetchResolver(), checker), CancellationToken.None);
        AssertProblem(metadata.Result, code);
    }

    private static void AssertProblem(ActionResult? result, string code)
    {
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        var problem = Assert.IsType<ProblemDetails>(badRequest.Value);
        Assert.Equal(400, problem.Status);
        Assert.Equal(code, problem.Extensions["code"]);
    }

    private sealed class IdentityAccessor : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.Empty, Guid.Empty);
    }

    private sealed class UserAccessor : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal identity,
            CancellationToken cancellationToken = default) => Task.FromResult(new CurrentJupleUser(1, "UTC", default));
    }

    private sealed class NeverSaveStore : IInboxEntryStore
    {
        public Task<InboxEntrySaveResult> SaveAsync(long userId, string url, Guid? clientRequestId,
            DateTimeOffset savedAtUtc, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Unsafe saves must not reach persistence.");
    }

    private sealed class NeverFetchResolver : IUrlMetadataResolver
    {
        public Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Unsafe URLs must not reach metadata HTTP.");
    }
}
