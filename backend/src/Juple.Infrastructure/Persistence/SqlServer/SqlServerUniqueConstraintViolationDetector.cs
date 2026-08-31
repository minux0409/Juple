using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Persistence.SqlServer;

internal static class SqlServerUniqueConstraintViolationDetector
{
    internal static bool IsUniqueConstraintViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException sqlException
        && IsUniqueConstraintViolation(sqlException.Number);

    internal static bool IsUniqueConstraintViolation(int errorNumber) =>
        errorNumber is 2601 or 2627;
}
