using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AllowCollectionLinkSharedNotification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6)");
        }
    }
}
