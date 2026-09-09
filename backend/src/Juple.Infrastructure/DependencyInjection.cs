using Azure.Storage.Blobs;
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Juple.Application.Images;
using Juple.Application.Images.BlobCleanup;
using Juple.Application.Inbox;
using Juple.Application.Items;
using Juple.Application.Push;
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

        return services;
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
