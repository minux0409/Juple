using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AllowCollaborationNotificationTypes : Migration
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
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Type 8-12 rows are reaction/comment/proposal Push notifications (see SocialNotificationPolicy.
            // VisibleMaxAge) - dropped so the narrower constraint can be restored; their delivery rows go
            // with them (FK cascade). No other Type is touched.
            migrationBuilder.Sql("DELETE FROM [notifications].[Notifications] WHERE [Type] IN (8, 9, 10, 11, 12);");

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
    }
}
