using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddApnsDeviceSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<byte>(
                name: "ApnsEnvironment",
                schema: "push",
                table: "PushDeviceRegistrations",
                type: "tinyint",
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "PushTokenHash",
                schema: "push",
                table: "PushDeviceRegistrations",
                type: "binary(32)",
                nullable: false,
                computedColumnSql: "CONVERT(binary(32), HASHBYTES('SHA2_256', [PushToken]))",
                stored: true);

            migrationBuilder.CreateIndex(
                name: "IX_PushDeviceRegistrations_Platform_PushTokenHash_Enabled",
                schema: "push",
                table: "PushDeviceRegistrations",
                columns: new[] { "Platform", "PushTokenHash" },
                filter: "[IsEnabled] = 1");

            // Before the constraint: an iOS row registered before this migration (none are expected - the iOS app never registered
            // until APNs existed) is a production-gateway token. Android rows keep NULL; no other row changes.
            // EXEC: in an idempotent script this runs in the same batch as the ADD COLUMN above, so it must be compiled only when it runs.
            migrationBuilder.Sql(
                "EXEC(N'UPDATE [push].[PushDeviceRegistrations] SET [ApnsEnvironment] = 0 WHERE [Platform] = 1 AND [ApnsEnvironment] IS NULL');");

            migrationBuilder.AddCheckConstraint(
                name: "CK_PushDeviceRegistrations_ApnsEnvironment",
                schema: "push",
                table: "PushDeviceRegistrations",
                sql: "([Platform] = 1 AND [ApnsEnvironment] IN (0, 1)) OR ([Platform] <> 1 AND [ApnsEnvironment] IS NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PushDeviceRegistrations_Platform_PushTokenHash_Enabled",
                schema: "push",
                table: "PushDeviceRegistrations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_PushDeviceRegistrations_ApnsEnvironment",
                schema: "push",
                table: "PushDeviceRegistrations");

            migrationBuilder.DropColumn(
                name: "PushTokenHash",
                schema: "push",
                table: "PushDeviceRegistrations");

            migrationBuilder.DropColumn(
                name: "ApnsEnvironment",
                schema: "push",
                table: "PushDeviceRegistrations");
        }
    }
}
