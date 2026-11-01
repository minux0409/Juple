using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddModerationNoticesAndUsageRestriction : Migration
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

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UsageRestrictedAtUtc",
                schema: "users",
                table: "Users",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ModerationNotices",
                schema: "safety",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RecipientUserId = table.Column<long>(type: "bigint", nullable: false),
                    Kind = table.Column<byte>(type: "tinyint", nullable: false),
                    ReportId = table.Column<long>(type: "bigint", nullable: true),
                    Reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    Guidance = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    CreatedByAdminUserId = table.Column<long>(type: "bigint", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    AcknowledgedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ModerationNotices", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Id" },
                filter: "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21)");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Type", "CollectionId" },
                filter: "[ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21)")
                .Annotation("SqlServer:Include", new[] { "ReadAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21)");

            migrationBuilder.CreateIndex(
                name: "IX_ModerationNotices_RecipientUserId",
                schema: "safety",
                table: "ModerationNotices",
                column: "RecipientUserId");

            migrationBuilder.CreateIndex(
                name: "UX_ModerationNotices_Report_Recipient_Kind",
                schema: "safety",
                table: "ModerationNotices",
                columns: new[] { "ReportId", "RecipientUserId", "Kind" },
                unique: true,
                filter: "[ReportId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ModerationNotices",
                schema: "safety");

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

            migrationBuilder.DropColumn(
                name: "UsageRestrictedAtUtc",
                schema: "users",
                table: "Users");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Id" },
                filter: "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Type", "CollectionId" },
                filter: "[ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)")
                .Annotation("SqlServer:Include", new[] { "ReadAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)");
        }
    }
}
