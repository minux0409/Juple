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
using Juple.Application.Push;
using Juple.Application.UrlMetadata;
using Juple.Application.UrlSafety;
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
using Juple.Infrastructure.UrlSafety;
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
        services.AddScoped<IRecentlyOpenedItemStore, RecentlyOpenedItemStore>();
        services.AddScoped<ICollectionStore, CollectionStore>();
        services.AddScoped<ICollectionItemStore, CollectionStore>();
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
        AddUrlSafetyChecker(services, configuration);

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
            .ConfigurePrimaryHttpMessageHandler(serviceProvider =>
            {
                var dnsResolver = serviceProvider.GetRequiredService<IDnsResolver>();
                return new SocketsHttpHandler
                {
                    AllowAutoRedirect = false,
                    UseCookies = false,
                    ConnectTimeout = TimeSpan.FromSeconds(5),
                    ConnectCallback = async (context, cancellationToken) =>
                    {
                        var validatedIp = await UrlMetadataConnectGuard.ResolveAndValidateAsync(
                            dnsResolver, context.DnsEndPoint.Host, cancellationToken);
                        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                        try
                        {
                            await socket.ConnectAsync(
                                new IPEndPoint(validatedIp, context.DnsEndPoint.Port), cancellationToken);
                            return new NetworkStream(socket, ownsSocket: true);
                        }
                        catch
                        {
                            socket.Dispose();
                            throw;
                        }
                    },
                };
            });
    }

    /// <summary>
    /// Unlike AddUrlMetadataResolver, no ConnectCallback/DNS guard here - WebRiskUrlSafetyChecker
    /// only ever sends the URL string to Google's own fixed BaseAddress below, never connects to
    /// the caller-supplied URL itself, so there is no SSRF surface to defend. MaxConnectionsPerServer
    /// bounds concurrent outbound calls to Web Risk (a paid, rate-limited external API) - matching
    /// this round's "endpoint-level abuse protection, not a new global architecture" scope; the
    /// short Timeout keeps a slow/unavailable provider from holding up a request (URL safety is
    /// never a hard dependency of saving a URL - see IUrlSafetyChecker's own remarks). Reuses the
    /// IMemoryCache already registered by AddUrlMetadataResolver above (same SizeLimit budget,
    /// distinct "UrlSafety:" key prefix - see WebRiskUrlSafetyChecker) rather than registering a
    /// second cache.
    /// </summary>
    private static void AddUrlSafetyChecker(IServiceCollection services, IConfiguration configuration)
    {
        var apiKey = configuration["UrlSafety:WebRisk:ApiKey"];
        services.AddSingleton(new WebRiskOptions(apiKey));

        services.AddHttpClient<IUrlSafetyChecker, WebRiskUrlSafetyChecker>(client =>
            {
                client.BaseAddress = new Uri("https://webrisk.googleapis.com/");
                client.Timeout = TimeSpan.FromSeconds(4);
            })
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
            {
                MaxConnectionsPerServer = 10,
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
