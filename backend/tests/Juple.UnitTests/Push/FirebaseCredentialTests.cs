using System.Security.Cryptography;
using System.Text.Json;
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using Juple.Application.Push;
using Juple.Infrastructure;
using Juple.Infrastructure.Push;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Juple.UnitTests.Push;

/// <summary>
/// The FCM sender's credential is built with CredentialFactory.FromJson&lt;ServiceAccountCredential&gt; (the replacement for the
/// deprecated GoogleCredential.FromJson): a service-account key works exactly as before, anything else - another credential type or a
/// malformed key - fails Backend startup instead of degrading silently. FirebaseApp keeps a process-wide named instance, so each test
/// removes it before and after.
/// </summary>
public sealed class FirebaseCredentialTests : IDisposable
{
    private const string AppName = "juple-push-sender";

    public FirebaseCredentialTests() => FirebaseApp.GetInstance(AppName)?.Delete();

    public void Dispose() => FirebaseApp.GetInstance(AppName)?.Delete();

    [Fact]
    public void AServiceAccountKey_RegistersTheFcmSender_WithAServiceAccountCredential()
    {
        using var provider = Build(ServiceAccountJson()).BuildServiceProvider();

        Assert.IsType<FirebaseCloudMessagingSender>(provider.GetRequiredService<IPushSender>());
        var credential = provider.GetRequiredService<FirebaseApp>().Options.Credential.UnderlyingCredential;
        var serviceAccount = Assert.IsType<ServiceAccountCredential>(credential);
        Assert.Equal("push-test@juple-test.iam.gserviceaccount.com", serviceAccount.Id);
    }

    [Fact]
    public void AnotherCredentialType_IsRefusedAtStartup()
    {
        // An end-user (authorized_user) credential: the deprecated factory accepted it; a push credential must be a service account.
        var json = JsonSerializer.Serialize(new { type = "authorized_user", client_id = "id", client_secret = "unused", refresh_token = "unused" });

        Assert.ThrowsAny<Exception>(() => Build(json));
        Assert.Null(FirebaseApp.GetInstance(AppName));
    }

    [Fact]
    public void AMalformedKey_StillFailsStartup()
    {
        Assert.ThrowsAny<Exception>(() => Build("{ not json"));
    }

    [Fact]
    public void NoKey_KeepsTheExplicitNotConfiguredSender()
    {
        using var provider = Build(null).BuildServiceProvider();

        Assert.IsType<NotConfiguredPushSender>(provider.GetRequiredService<IPushSender>());
    }

    private static ServiceCollection Build(string? serviceAccountKeyJson)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddInfrastructure(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:JupleDatabase"] = "Server=unused;Database=unused",
            ["Firebase:ServiceAccountKeyJson"] = serviceAccountKeyJson,
        }).Build());
        return services;
    }

    /// <summary>A throwaway key generated for the test - never a real credential.</summary>
    private static string ServiceAccountJson()
    {
        using var rsa = RSA.Create(2048);
        return JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["type"] = "service_account",
            ["project_id"] = "juple-test",
            ["private_key_id"] = "test-key",
            ["private_key"] = rsa.ExportPkcs8PrivateKeyPem(),
            ["client_email"] = "push-test@juple-test.iam.gserviceaccount.com",
            ["client_id"] = "1",
            ["token_uri"] = "https://oauth2.googleapis.com/token",
        });
    }
}
