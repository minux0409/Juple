using System.Data;
using System.Security.Cryptography;
using System.Text;
using Juple.Domain.Push;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Push;

/// <summary>Shared by registration and delivery; uses only the original push schema.</summary>
internal static class PushRegistrationSql
{
    internal static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    internal static string TokenLock(PushPlatform platform, string token) => $"push-token:{(byte)platform}:{Hash(token)}";

    internal static IQueryable<PushDeviceRegistration> WithExactToken(this IQueryable<PushDeviceRegistration> query, string token) =>
        query.Where(row => EF.Functions.Collate(row.PushToken, "Latin1_General_100_BIN2") == token
            && EF.Functions.DataLength(row.PushToken) == Encoding.UTF8.GetByteCount(token));

    internal static async Task LockAsync(JupleDbContext db, IEnumerable<string> resources, CancellationToken cancellationToken)
    {
        // Bound command size and acquire in the same order in every process. Only digests
        // appear in lock resources; tokens never appear in SQL text or diagnostic messages.
        foreach (var chunk in resources.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).Chunk(256))
        {
            var sql = new StringBuilder("DECLARE @result int;\n");
            var parameters = new List<object>();
            for (var index = 0; index < chunk.Length; index++)
            {
                var name = "@pushLock" + index;
                parameters.Add(new SqlParameter(name, SqlDbType.NVarChar, 255) { Value = chunk[index] });
                sql.Append("EXEC @result=sp_getapplock @Resource=").Append(name)
                    .Append(", @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=15000; ")
                    .Append("IF @result<0 THROW 51000, 'Push coordination lock unavailable.', 1;\n");
            }
            await db.Database.ExecuteSqlRawAsync(sql.ToString(), parameters, cancellationToken);
        }
    }
}
