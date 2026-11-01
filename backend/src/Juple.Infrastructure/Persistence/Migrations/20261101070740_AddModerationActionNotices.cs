using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddModerationActionNotices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_ModerationNotices_Report_Recipient_Kind",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.AddColumn<byte>(
                name: "ActionType",
                schema: "safety",
                table: "ModerationNotices",
                type: "tinyint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContentTitle",
                schema: "safety",
                table: "ModerationNotices",
                type: "nvarchar(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContentType",
                schema: "safety",
                table: "ModerationNotices",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DedupKey",
                schema: "safety",
                table: "ModerationNotices",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReasonCode",
                schema: "safety",
                table: "ModerationNotices",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "UX_ModerationNotices_DedupKey",
                schema: "safety",
                table: "ModerationNotices",
                column: "DedupKey",
                unique: true,
                filter: "[DedupKey] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UX_ModerationNotices_Report_Recipient_Kind",
                schema: "safety",
                table: "ModerationNotices",
                columns: new[] { "ReportId", "RecipientUserId", "Kind" },
                unique: true,
                filter: "[ReportId] IS NOT NULL AND [Kind] IN (1, 2)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_ModerationNotices_DedupKey",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.DropIndex(
                name: "UX_ModerationNotices_Report_Recipient_Kind",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.DropColumn(
                name: "ActionType",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.DropColumn(
                name: "ContentTitle",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.DropColumn(
                name: "ContentType",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.DropColumn(
                name: "DedupKey",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.DropColumn(
                name: "ReasonCode",
                schema: "safety",
                table: "ModerationNotices");

            migrationBuilder.CreateIndex(
                name: "UX_ModerationNotices_Report_Recipient_Kind",
                schema: "safety",
                table: "ModerationNotices",
                columns: new[] { "ReportId", "RecipientUserId", "Kind" },
                unique: true,
                filter: "[ReportId] IS NOT NULL");
        }
    }
}
