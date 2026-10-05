using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFriendAnswerNotificationsAndEventItemId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents");

            migrationBuilder.AddColumn<long>(
                name: "ItemId",
                schema: "notifications",
                table: "NotificationEvents",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Id" },
                filter: "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14)");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Type", "CollectionId" },
                filter: "[ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14)")
                .Annotation("SqlServer:Include", new[] { "ReadAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents",
                sql: "[Type] IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Type 13/14 rows are friend-request result notifications (and their outbox events) - removed so
            // the narrower constraint can be restored; their delivery rows go with them (FK cascade).
            migrationBuilder.Sql("DELETE FROM [notifications].[Notifications] WHERE [Type] IN (13, 14);");
            migrationBuilder.Sql("DELETE FROM [notifications].[NotificationEvents] WHERE [Type] IN (13, 14);");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents");

            migrationBuilder.DropColumn(
                name: "ItemId",
                schema: "notifications",
                table: "NotificationEvents");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Id" },
                filter: "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12)");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Type", "CollectionId" },
                filter: "[ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12)")
                .Annotation("SqlServer:Include", new[] { "ReadAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents",
                sql: "[Type] IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)");
        }
    }
}
