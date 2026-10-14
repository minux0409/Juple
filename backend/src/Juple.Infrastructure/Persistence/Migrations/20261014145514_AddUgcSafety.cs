using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUgcSafety : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "safety");

            migrationBuilder.AddColumn<string>(
                name: "AcceptedTermsVersion",
                schema: "users",
                table: "Users",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "TermsAcceptedAtUtc",
                schema: "users",
                table: "Users",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ContentReports",
                schema: "safety",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReporterUserId = table.Column<long>(type: "bigint", nullable: true),
                    TargetType = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    TargetId = table.Column<long>(type: "bigint", nullable: false),
                    TargetUserId = table.Column<long>(type: "bigint", nullable: true),
                    CollectionId = table.Column<long>(type: "bigint", nullable: true),
                    Reason = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Details = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ReviewedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Resolution = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContentReports", x => x.Id);
                    table.CheckConstraint("CK_ContentReports_Reason_Valid", "[Reason] IN ('Spam', 'Harassment', 'HateOrAbuse', 'SexualOrInappropriate', 'Illegal', 'ScamOrMaliciousLink', 'IntellectualProperty', 'Other')");
                    table.CheckConstraint("CK_ContentReports_Review_Consistent", "([Status] = 'Pending' AND [ReviewedAtUtc] IS NULL) OR ([Status] <> 'Pending' AND [ReviewedAtUtc] IS NOT NULL)");
                    table.CheckConstraint("CK_ContentReports_Status_Valid", "[Status] IN ('Pending', 'Reviewed', 'Dismissed', 'Actioned')");
                    table.CheckConstraint("CK_ContentReports_TargetType_Valid", "[TargetType] IN ('User', 'Collection', 'Item', 'Comment')");
                });

            migrationBuilder.CreateTable(
                name: "UserBlocks",
                schema: "safety",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    BlockerUserId = table.Column<long>(type: "bigint", nullable: false),
                    BlockedUserId = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserBlocks", x => x.Id);
                    table.CheckConstraint("CK_UserBlocks_NotSelf", "[BlockerUserId] <> [BlockedUserId]");
                    table.ForeignKey(
                        name: "FK_UserBlocks_Users_BlockedUserId",
                        column: x => x.BlockedUserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_UserBlocks_Users_BlockerUserId",
                        column: x => x.BlockerUserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ContentReports_ReporterUserId",
                schema: "safety",
                table: "ContentReports",
                column: "ReporterUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ContentReports_Status_Id",
                schema: "safety",
                table: "ContentReports",
                columns: new[] { "Status", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_ContentReports_TargetUserId",
                schema: "safety",
                table: "ContentReports",
                column: "TargetUserId");

            migrationBuilder.CreateIndex(
                name: "UX_ContentReports_OpenPerReporterTarget",
                schema: "safety",
                table: "ContentReports",
                columns: new[] { "ReporterUserId", "TargetType", "TargetId" },
                unique: true,
                filter: "[Status] = 'Pending' AND [ReporterUserId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_UserBlocks_Blocked_Blocker",
                schema: "safety",
                table: "UserBlocks",
                columns: new[] { "BlockedUserId", "BlockerUserId" });

            migrationBuilder.CreateIndex(
                name: "UX_UserBlocks_Blocker_Blocked",
                schema: "safety",
                table: "UserBlocks",
                columns: new[] { "BlockerUserId", "BlockedUserId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ContentReports",
                schema: "safety");

            migrationBuilder.DropTable(
                name: "UserBlocks",
                schema: "safety");

            migrationBuilder.DropColumn(
                name: "AcceptedTermsVersion",
                schema: "users",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TermsAcceptedAtUtc",
                schema: "users",
                table: "Users");
        }
    }
}
