using Azure.Storage.Blobs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Juple.Application.Categories;
using Juple.Application.Images;
using Juple.Application.Inbox;
using Juple.Application.Items;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Infrastructure.Categories;
using Juple.Infrastructure.Images;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
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
        services.AddScoped<IItemQueryStore, ItemStore>();
        services.AddScoped<IItemDetailsStore, ItemStore>();
        services.AddScoped<IItemDetailQueryStore, ItemStore>();
        services.AddScoped<IItemCategoryStore, ItemStore>();
        services.AddScoped<ICategoryStore, CategoryStore>();
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
