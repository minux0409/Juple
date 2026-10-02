using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationInboxIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Notifications_UserId_ReadAtUtc",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Id" },
                filter: "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12)");

            // The Inbox has never been shown before, and nothing ever set ReadAtUtc: every existing
            // notification would otherwise appear as unread history the day the bell ships. They were
            // all delivered (or expired) as Push already, so they start out read - only notifications
            // created from now on are unread. Read state only: no notification's content changes, and
            // the data-only refresh rows (not in the Inbox) are left as they are. Not reversed by Down
            // (there is no earlier read state to restore).
            migrationBuilder.Sql(
                """
                UPDATE [notifications].[Notifications]
                SET [ReadAtUtc] = TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00')
                WHERE [ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12);
                """);

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Type", "CollectionId" },
                filter: "[ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12)")
                .Annotation("SqlServer:Include", new[] { "ReadAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_UserId_ReadAtUtc",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "ReadAtUtc" });
        }
    }
}
