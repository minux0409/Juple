using Microsoft.Data.SqlClient;

namespace Juple.IntegrationTests.TestSupport;

internal static class LocalRetentionEnvironment
{
    public static string RequireConnectionString()
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("Run infra/local/Test-Retention.ps1 to configure the local test services.");
        var target = new SqlConnectionStringBuilder(connection);
        if (target.DataSource != "localhost,14333" || target.InitialCatalog != "JupleRetTests"
            || Environment.GetEnvironmentVariable("ConnectionStrings__BlobStorage") != "UseDevelopmentStorage=true")
            throw new InvalidOperationException("RET tests require localhost,14333/JupleRetTests and Azurite. Remote/development databases are refused.");
        return connection;
    }
}
