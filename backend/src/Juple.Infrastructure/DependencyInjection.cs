using Azure.Storage.Blobs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Juple.Application.Images;
using Juple.Application.Inbox;
using Juple.Application.Items;
using Juple.Application.Notifications;
using Juple.Application.Purchases;
using Juple.Application.Push;
using Juple.Application.RepeatPurchases;
using Juple.Application.RepeatPurchases.LogPurchase;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Images;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Purchases;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.RepeatPurchases;
using Juple.Infrastructure.Storage;
using Juple.Infrastructure.Users.BootstrapCurrentUser;
using Juple.Infrastructure.Users.CurrentUser;

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
        services.AddScoped<IPurchaseStore, PurchaseStore>();
        services.AddScoped<IRepeatPurchaseStore, RepeatPurchaseStore>();
        services.AddScoped<ILogPurchaseStore, LogPurchaseStore>();
        services.AddScoped<INotificationStore, NotificationStore>();
        services.AddScoped<INotificationDeliveryStore, NotificationDeliveryStore>();
        services.AddScoped<IPushDeviceRegistrationStore, PushDeviceRegistrationStore>();
        // No Azure Notification Hub exists yet (see this feature's own design notes) - swap for a
        // real Hub-backed IPushSender once one is provisioned; no other code depends on which one is
        // registered here.
        services.AddScoped<IPushSender, NotConfiguredPushSender>();
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
}
