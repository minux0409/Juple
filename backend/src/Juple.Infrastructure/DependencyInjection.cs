using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Juple.Infrastructure.Persistence;

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

        return services;
    }
}
