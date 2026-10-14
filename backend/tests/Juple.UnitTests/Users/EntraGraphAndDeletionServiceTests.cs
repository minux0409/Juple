using System.Net;
using System.Text;
using Azure.Core;
using Juple.Application.Identity;
using Juple.Application.Users.DeleteAccount;
using Juple.Domain.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.Extensions.Logging.Abstractions;
using static Juple.UnitTests.Users.EntraTestDoubles;

namespace Juple.UnitTests.Users;

public sealed class EntraGraphIdentityDirectoryTests
{
    private static readonly ExternalIdentityPrincipal Person = new(CustomerTenant, Guid.Parse("11111111-2222-3333-4444-555555555555"));

    private sealed class StubCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) => new("graph-token", DateTimeOffset.UtcNow.AddHours(1));

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) => new(GetToken(requestContext, cancellationToken));
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(HttpMethod Method, string Url, string? Authorization)> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add((request.Method, request.RequestUri!.ToString(), request.Headers.Authorization?.ToString()));
            return Task.FromResult(respond(request));
        }
    }

    private static (EntraGraphIdentityDirectory Directory, StubHandler Handler) Create(Func<HttpRequestMessage, HttpResponseMessage> respond, EntraAccountDeletionOptions? options = null)
    {
        var handler = new StubHandler(respond);
        return (new EntraGraphIdentityDirectory(new HttpClient(handler), options ?? EnabledOptions(), new StubCredential()), handler);
    }

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static string UserJson(Guid id, string? mail, string identities) =>
        "{\"id\":\"" + id.ToString("D") + "\",\"mail\":" + (mail is null ? "null" : "\"" + mail + "\"") + ",\"identities\":" + identities + "}";

    [Fact]
    public async Task DeleteUserAsync_DeletesExactlyTheGivenUserWithTheGraphToken()
    {
        var (directory, handler) = Create(_ => new HttpResponseMessage(HttpStatusCode.NoContent));

        var outcome = await directory.DeleteUserAsync(Person);

        Assert.Equal(EntraIdentityDeletionOutcome.Deleted, outcome);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Delete, request.Method);
        Assert.Equal($"https://graph.microsoft.com/v1.0/users/{Person.ObjectId:D}", request.Url);
        Assert.Equal("Bearer graph-token", request.Authorization);
    }

    [Fact]
    public async Task DeleteUserAsync_AnAlreadyDeletedUser_IsSuccess()
    {
        var (directory, _) = Create(_ => new HttpResponseMessage(HttpStatusCode.NotFound));

        Assert.Equal(EntraIdentityDeletionOutcome.AlreadyGone, await directory.DeleteUserAsync(Person));
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "http_403")]
    [InlineData(HttpStatusCode.TooManyRequests, "http_429")]
    [InlineData(HttpStatusCode.InternalServerError, "http_500")]
    public async Task DeleteUserAsync_AnyOtherFailure_ThrowsASanitizedCode(HttpStatusCode status, string code)
    {
        var (directory, _) = Create(_ => new HttpResponseMessage(status) { Content = new StringContent("secret directory detail") });

        var exception = await Assert.ThrowsAsync<EntraDirectoryException>(() => directory.DeleteUserAsync(Person));

        Assert.Equal(code, exception.Code);
        Assert.DoesNotContain("secret", exception.Message);
    }

    [Fact]
    public async Task DeleteUserAsync_AUserOfAnotherTenant_IsNeverSentToGraph()
    {
        var (directory, handler) = Create(_ => new HttpResponseMessage(HttpStatusCode.NoContent));

        await Assert.ThrowsAsync<EntraDirectoryException>(() => directory.DeleteUserAsync(new ExternalIdentityPrincipal(Guid.NewGuid(), Person.ObjectId)));

        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task DeleteUserAsync_WhenDisabled_NeverCallsGraph()
    {
        var (directory, handler) = Create(_ => new HttpResponseMessage(HttpStatusCode.NoContent), new EntraAccountDeletionOptions());

        await Assert.ThrowsAsync<EntraDirectoryException>(() => directory.DeleteUserAsync(Person));

        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task GetSignInEmailAsync_ReadsTheEmailSignInIdentity()
    {
        var identities = "[{\"signInType\":\"userName\",\"issuerAssignedId\":\"someone\"},{\"signInType\":\"emailAddress\",\"issuerAssignedId\":\"Person@Example.com\"}]";
        var (directory, handler) = Create(_ => Json(UserJson(Person.ObjectId, null, identities)));

        Assert.Equal("Person@Example.com", await directory.GetSignInEmailAsync(Person));
        Assert.Equal($"https://graph.microsoft.com/v1.0/users/{Person.ObjectId:D}?$select=id,mail,identities", handler.Requests[0].Url);
    }

    [Fact]
    public async Task GetSignInEmailAsync_FallsBackToMail()
    {
        var (directory, _) = Create(_ => Json(UserJson(Person.ObjectId, "m@example.com", "[]")));

        Assert.Equal("m@example.com", await directory.GetSignInEmailAsync(Person));
    }

    [Fact]
    public async Task GetSignInEmailAsync_AnAnswerAboutAnotherUser_OrAnError_IsNull()
    {
        var (other, _) = Create(_ => Json(UserJson(Guid.NewGuid(), "x@example.com", "[]")));
        Assert.Null(await other.GetSignInEmailAsync(Person));

        var (failing, _) = Create(_ => new HttpResponseMessage(HttpStatusCode.Forbidden));
        Assert.Null(await failing.GetSignInEmailAsync(Person));
    }
}

public sealed class EntraIdentityDeletionServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 14, 0, 0, 0, TimeSpan.Zero);
    private static readonly Guid ObjectId = Guid.Parse("11111111-2222-3333-4444-555555555555");

    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static (EntraIdentityDeletionService Service, FakeEntraStore Store, FakeDirectory Directory) Create()
    {
        var store = new FakeEntraStore();
        store.Add(1, new PendingEntraIdentityDeletion(CustomerTenant, ObjectId, Now.AddMinutes(-5)));
        var directory = new FakeDirectory();
        return (new EntraIdentityDeletionService(store, directory, new FixedTime(), NullLogger<EntraIdentityDeletionService>.Instance), store, directory);
    }

    [Fact]
    public async Task TryCompleteAsync_OnSuccess_DeletesTheEntraUserAndRemovesTheTask()
    {
        var (service, store, directory) = Create();

        Assert.True(await service.TryCompleteAsync(1));

        Assert.Equal(new ExternalIdentityPrincipal(CustomerTenant, ObjectId), Assert.Single(directory.Deleted));
        Assert.Empty(store.Tasks);
    }

    [Fact]
    public async Task TryCompleteAsync_AlreadyGone_CountsAsDone_Idempotent()
    {
        var (service, store, directory) = Create();
        directory.Outcome = EntraIdentityDeletionOutcome.AlreadyGone;

        Assert.True(await service.TryCompleteAsync(1));
        Assert.True(await service.TryCompleteAsync(1)); // the task is gone now: still not an error

        Assert.Empty(store.Tasks);
    }

    [Fact]
    public async Task TryCompleteAsync_OnFailure_KeepsTheTaskForRetry_RecordsOnlyACode_AndNeverThrows()
    {
        var (service, store, directory) = Create();
        directory.DeleteFailure = new EntraDirectoryException("http_503");

        Assert.False(await service.TryCompleteAsync(1));

        var task = store.Tasks[1];
        Assert.Equal(1, task.AttemptCount);
        Assert.Equal("http_503", task.LastErrorCode);
        Assert.Equal(Now, task.LastAttemptAtUtc);
    }

    [Fact]
    public async Task RunPendingAsync_RetriesEveryPendingTask_AndReportsTheOnesStillFailing()
    {
        var (service, store, directory) = Create();
        store.Add(2, new PendingEntraIdentityDeletion(CustomerTenant, Guid.NewGuid(), Now));
        directory.DeleteFailure = new EntraDirectoryException("http_429");

        var failing = await service.RunPendingAsync();
        Assert.Equal(new EntraDeletionRunResult(2, 0, 2), failing);

        directory.DeleteFailure = null;
        var recovered = await service.RunPendingAsync();
        Assert.Equal(new EntraDeletionRunResult(2, 2, 0), recovered);
        Assert.Empty(store.Tasks);
    }

    [Fact]
    public async Task IsStillPendingAsync_FinishesAPendingDeletionFirst_SoOnlyARealFailureBlocks()
    {
        var (service, store, directory) = Create();
        var identity = new ExternalIdentityPrincipal(CustomerTenant, ObjectId);

        Assert.False(await service.IsStillPendingAsync(identity)); // completes it now
        Assert.Empty(store.Tasks);

        store.Add(3, new PendingEntraIdentityDeletion(CustomerTenant, ObjectId, Now));
        directory.DeleteFailure = new EntraDirectoryException("http_500");
        Assert.True(await service.IsStillPendingAsync(identity)); // still failing: refuse

        Assert.False(await service.IsStillPendingAsync(new ExternalIdentityPrincipal(CustomerTenant, Guid.NewGuid()))); // nobody else is affected
    }
}

public sealed class TrialEmailHashTests
{
    [Fact]
    public void HashEmail_IsCaseInsensitiveAndTrimmed_AndDifferentFromTheObjectIdHash()
    {
        var hasher = Hasher();
        Assert.Equal(hasher.HashEmail("a@example.com"), hasher.HashEmail("  A@Example.COM "));
        Assert.NotEqual(hasher.HashEmail("a@example.com"), hasher.HashEmail("b@example.com"));
        Assert.Equal(32, hasher.HashEmail("a@example.com")!.Length);
        Assert.NotEqual(hasher.Hash(new ExternalIdentityPrincipal(CustomerTenant, Guid.Empty)), hasher.HashEmail("a@example.com"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void HashEmail_WithoutAnAddress_IsNull(string? email) => Assert.Null(Hasher().HashEmail(email));

    [Fact]
    public void HashEmail_WithoutAConfiguredKey_IsNull_NeverThrows() => Assert.Null(HasherWithoutKey().HashEmail("a@example.com"));
}

public sealed class EntraAccountDeletionOptionsTests
{
    [Fact]
    public void Disabled_NeedsNothing() => Assert.Null(new EntraAccountDeletionOptions().Validate());

    [Fact]
    public void Enabled_NeedsTheTenantTheAppAndACredential()
    {
        Assert.NotNull(new EntraAccountDeletionOptions { Enabled = true }.Validate());
        Assert.NotNull(new EntraAccountDeletionOptions { Enabled = true, TenantId = EntraTestDoubles.CustomerTenant }.Validate());
        Assert.NotNull(new EntraAccountDeletionOptions { Enabled = true, TenantId = EntraTestDoubles.CustomerTenant, ClientId = "app" }.Validate());
        Assert.Null(new EntraAccountDeletionOptions { Enabled = true, TenantId = EntraTestDoubles.CustomerTenant, ClientId = "app", ClientSecret = "s" }.Validate());
        Assert.Null(new EntraAccountDeletionOptions { Enabled = true, TenantId = EntraTestDoubles.CustomerTenant, ClientId = "app", ManagedIdentityClientId = "mi" }.Validate());
    }

    [Fact]
    public void TheSecretNeverAppearsInAnErrorOrCode()
    {
        var code = Juple.Infrastructure.Users.DeleteAccount.EntraGraphIdentityDirectory.SanitizedCodeOf(
            new Azure.Identity.AuthenticationFailedException("AADSTS7000215: Invalid client secret provided. Secret=abc123"));
        Assert.Equal("AuthenticationFailedException_AADSTS7000215", code);
        Assert.DoesNotContain("abc123", code);
    }
}
