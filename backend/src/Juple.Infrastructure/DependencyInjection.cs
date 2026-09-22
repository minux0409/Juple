using System.Net;
using System.Net.Sockets;
using Azure.Storage.Blobs;
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Juple.Application.Images;
using Juple.Application.Images.BlobCleanup;
using Juple.Application.Inbox;
using Juple.Application.Items;
using Juple.Application.Items.InstagramMetadataRetry;
using Juple.Application.Push;
using Juple.Application.UrlMetadata;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Application.Users.DeleteAccount;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Images;
using Juple.Infrastructure.Images.BlobCleanup;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.Storage;
using Juple.Infrastructure.UrlMetadata;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Juple.Infrastructure.Users.CurrentUser;
using Juple.Infrastructure.Users.DeleteAccount;

namespace Juple.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("JupleDatabase");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "ConnectionStrings:JupleDatabase is required to configure JupleDbContext.");
        }

        services.AddDbContext<JupleDbContext>(options =>
            options.UseSqlServer(connectionString));
        services.AddScoped<ICurrentUserProvisioningStore, CurrentUserProvisioningStore>();
        services.AddScoped<ICurrentJupleUserAccessor, CurrentJupleUserAccessor>();
        services.AddScoped<IAccountDeletionStore, AccountDeletionStore>();
        services.AddScoped<IAccountDeletionBlobCleanupStore, AccountDeletionBlobCleanupStore>();
        services.AddScoped<IBlobCleanupService, BlobCleanupService>();
        services.AddScoped<IInboxEntryStore, ItemStore>();
        services.AddScoped<IItemLifecycleStore, ItemStore>();
        services.AddScoped<IItemDetailsStore, ItemStore>();
        services.AddScoped<IItemDetailQueryStore, ItemStore>();
        services.AddScoped<IItemHistoryQueryStore, ItemStore>();
        services.AddScoped<IItemTrashQueryStore, ItemStore>();
        services.AddScoped<IInstagramMetadataRetryStore, InstagramMetadataRetryStore>();
        services.AddScoped<IInstagramMetadataRetryService, InstagramMetadataRetryService>();
        services.AddScoped<IRecentlyOpenedItemStore, RecentlyOpenedItemStore>();
        services.AddScoped<ICollectionStore, CollectionStore>();
        services.AddScoped<ICollectionItemStore, CollectionStore>();
        services.AddScoped<ICollectionManagementStore, CollectionStore>();
        services.AddScoped<ICollectionShareStore, CollectionShareStore>();
        services.AddScoped<IPublicCollectionShareStore, PublicCollectionStore>();
        services.AddScoped<IPushDeviceRegistrationStore, PushDeviceRegistrationStore>();
        AddPushSender(services, configuration);
        services.AddScoped<IItemImageStore, ItemImageStore>();
        services.AddScoped<IItemImageStorage, ItemImageStore>();

        // Construction itself makes no network call, so this does not require a live Blob
        // endpoint at app startup - only whichever caller first resolves
        // BlobServiceClient/BlobContainerClient needs BlobStorage configured.
        services.AddSingleton(_ => BlobServiceClientFactory.Create(configuration));
        services.AddSingleton(serviceProvider =>
        {
            var containerName = configuration["BlobStorage:ContainerName"]
                ?? throw new InvalidOperationException("BlobStorage:ContainerName is required.");
            return serviceProvider.GetRequiredService<BlobServiceClient>()
                .GetBlobContainerClient(containerName);
        });
        // Caches the Production User Delegation Key across requests - must be a Singleton (not
        // Scoped, like ItemImageStore itself) so the key is actually reused instead of being
        // re-fetched from Azure AD/Storage on every request.
        services.AddSingleton<UserDelegationKeyCache>();

        AddUrlMetadataResolver(services);

        return services;
    }

    /// <summary>
    /// The SSRF-critical part is ConfigurePrimaryHttpMessageHandler's ConnectCallback: it resolves
    /// and validates the target host itself (UrlMetadataConnectGuard) and connects directly to
    /// that validated IP, rather than letting SocketsHttpHandler resolve DNS again on its own at
    /// connect time - the latter would leave a DNS-rebinding gap between "we checked this host is
    /// public" and "the socket actually connects". AllowAutoRedirect is off so UrlMetadataResolver
    /// can count/cap redirects and let each hop re-run this same ConnectCallback instead of
    /// following redirects blindly; UseCookies is off so no state leaks between requests to
    /// different users' URLs. See UrlMetadataResolver's own remarks for the request-level policy
    /// (byte/time budget, content-type gate) this handler does not itself express.
    /// </summary>
    private static void AddUrlMetadataResolver(IServiceCollection services)
    {
        services.AddSingleton<IDnsResolver, SystemDnsResolver>();
        services.AddMemoryCache(options => options.SizeLimit = 500);

        services.AddHttpClient<IUrlMetadataResolver, UrlMetadataResolver>(client =>
            {
                // No domain in the UA string - the production domain is not yet decided (see
                // README's Universal Links section) and must not be guessed here either.
                client.DefaultRequestHeaders.UserAgent.ParseAdd("JupleBot/1.0 (URL metadata preview fetch)");
            })
            // AddHttpClient's default LoggingHttpMessageHandlerBuilderFilter otherwise adds a
            // LogicalHandler/ClientHandler pair that logs "Start/Sending/End processing HTTP
            // request {Method} {Uri}" at Information level for every request - including every
            // manually-followed redirect hop (see AllowAutoRedirect below) - and .NET's built-in
            // header/query redaction does NOT extend to the request path, so a user-saved URL's
            // path (which can itself carry sensitive/identifying content) would otherwise leak
            // into Production logs verbatim. RemoveAllLoggers() (Microsoft.Extensions.Http,
            // confirmed present in this exact package version) strips those two handlers from
            // *only* this named/typed client's pipeline and no global Logging:LogLevel setting is touched - leaving
            // UrlMetadataResolver's own hostname-only LogOutcome as the sole log output for this
            // feature.
            .RemoveAllLoggers()
            .ConfigurePrimaryHttpMessageHandler(serviceProvider =>
            {
                var dnsResolver = serviceProvider.GetRequiredService<IDnsResolver>();
                return new SocketsHttpHandler
                {
                    AllowAutoRedirect = false,
                    // Every hop resolves afresh and connects only to a checked address, never a proxy.
                    UseProxy = false,
                    PooledConnectionLifetime = TimeSpan.Zero,
                    UseCookies = false,
                    ConnectTimeout = TimeSpan.FromSeconds(5),
                    ConnectCallback = (context, cancellationToken) =>
                        UrlMetadataConnectGuard.ConnectAsync(dnsResolver, context.DnsEndPoint, async (endpoint, token) =>
                    {
                        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                        try
                        {
                            await socket.ConnectAsync(endpoint, token);
                            return new NetworkStream(socket, ownsSocket: true);
                        }
                        catch
                        {
                            socket.Dispose();
                            throw;
                        }
                    }, cancellationToken),
                };
            });
    }

    /// <summary>
    /// Firebase:ServiceAccountKeyJson is a Firebase project's FCM v1 server credential (see
    /// FirebaseCloudMessagingSender) - entirely separate from Mobile's google-services.json (a
    /// client-side app config, not a secret) and never stored in this repo. Sourced from
    /// dotnet user-secrets locally, a Container Apps secret env var in Azure - see README.
    ///
    /// A genuinely absent credential registers NotConfiguredPushSender - an explicit, honest choice
    /// for "no Push transport configured in this environment" (every send is still recorded as a
    /// real Failed delivery; see that class's own remarks), never a silent behavior change. A
    /// *present but malformed* credential is different: GoogleCredential.FromJson below throws, and
    /// that exception is deliberately left to propagate and fail Backend startup outright - mirrors
    /// PublicCollectionCursor:EncryptionKey's own fail-fast convention - rather than silently
    /// degrading to NotConfiguredPushSender because of what would actually be a configuration bug.
    /// </summary>
    private static void AddPushSender(IServiceCollection services, IConfiguration configuration)
    {
        var serviceAccountKeyJson = configuration["Firebase:ServiceAccountKeyJson"];
        if (string.IsNullOrWhiteSpace(serviceAccountKeyJson))
        {
            services.AddScoped<IPushSender, NotConfiguredPushSender>();
            return;
        }

        const string FirebaseAppName = "juple-push-sender";
        var firebaseApp = FirebaseApp.GetInstance(FirebaseAppName) ?? FirebaseApp.Create(
            new AppOptions { Credential = GoogleCredential.FromJson(serviceAccountKeyJson) },
            FirebaseAppName);
        services.AddSingleton(firebaseApp);
        services.AddScoped<IPushSender, FirebaseCloudMessagingSender>();
    }
}
