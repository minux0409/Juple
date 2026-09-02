using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Persistence.SqlServer;

internal static class SqlServerForeignKeyViolationDetector
{
    // SQL Server also raises 547 for CHECK constraint violations, so the constraint name (never
    // localized, unlike the message text around it) is required to tell the two apart - verified
    // against a real SQL Server instance, not assumed.
    private const int ConstraintViolationErrorNumber = 547;

    internal static bool IsForeignKeyViolation(DbUpdateException exception, string constraintName) =>
        exception.InnerException is SqlException sqlException
        && sqlException.Number == ConstraintViolationErrorNumber
        && sqlException.Message.Contains(constraintName, StringComparison.Ordinal);
}
