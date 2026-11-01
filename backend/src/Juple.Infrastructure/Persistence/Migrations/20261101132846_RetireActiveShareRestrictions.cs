using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RetireActiveShareRestrictions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 공유 제한 was retired as a product policy: nothing reads these rows for access any more. Rows still "in force" are closed so no
            // surface keeps showing a restriction that no longer exists. Data only - no row is deleted, the report, who set it and when stay as
            // history, and LiftedByAdminUserId stays NULL (= ended by the retirement, not by an operator).
            migrationBuilder.Sql(
                "UPDATE [safety].[ShareRestrictions] SET [LiftedAtUtc] = TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00') WHERE [LiftedAtUtc] IS NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Intentionally empty: which rows were in force when this ran is not recoverable, and the restriction is no longer a supported feature.
        }
    }
}
