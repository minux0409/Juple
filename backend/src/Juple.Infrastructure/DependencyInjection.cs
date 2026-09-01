using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Juple.Application.Inbox;
using Juple.Application.Items;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
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

        return services;
    }
}
