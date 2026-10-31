using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSharedContentModeration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_ContentReports_OpenPerReporterTarget",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ContentReports_Status_Valid",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.AddColumn<long>(
                name: "ReviewedByAdminUserId",
                schema: "safety",
                table: "ContentReports",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SnapshotTitle",
                schema: "safety",
                table: "ContentReports",
                type: "nvarchar(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SnapshotUrl",
                schema: "safety",
                table: "ContentReports",
                type: "nvarchar(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                schema: "safety",
                table: "ContentReports",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "User");

            migrationBuilder.CreateTable(
                name: "ShareRestrictions",
                schema: "safety",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    ItemId = table.Column<long>(type: "bigint", nullable: true),
                    ReportId = table.Column<long>(type: "bigint", nullable: true),
                    RestrictedByAdminUserId = table.Column<long>(type: "bigint", nullable: false),
                    RestrictedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    LiftedByAdminUserId = table.Column<long>(type: "bigint", nullable: true),
                    LiftedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShareRestrictions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ContentReports_Target",
                schema: "safety",
                table: "ContentReports",
                columns: new[] { "TargetType", "TargetId", "Id" });

            migrationBuilder.CreateIndex(
                name: "UX_ContentReports_OpenPerReporterTarget",
                schema: "safety",
                table: "ContentReports",
                columns: new[] { "ReporterUserId", "TargetType", "TargetId" },
                unique: true,
                filter: "[Status] IN ('Pending', 'InReview') AND [ReporterUserId] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ContentReports_Source_Valid",
                schema: "safety",
                table: "ContentReports",
                sql: "[Source] IN ('User', 'AutoFilter')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ContentReports_Status_Valid",
                schema: "safety",
                table: "ContentReports",
                sql: "[Status] IN ('Pending', 'InReview', 'Reviewed', 'Dismissed', 'Actioned')");

            migrationBuilder.CreateIndex(
                name: "UX_ShareRestrictions_ActiveCollection",
                schema: "safety",
                table: "ShareRestrictions",
                column: "CollectionId",
                unique: true,
                filter: "[LiftedAtUtc] IS NULL AND [ItemId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "UX_ShareRestrictions_ActiveItem",
                schema: "safety",
                table: "ShareRestrictions",
                columns: new[] { "CollectionId", "ItemId" },
                unique: true,
                filter: "[LiftedAtUtc] IS NULL AND [ItemId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ShareRestrictions",
                schema: "safety");

            migrationBuilder.DropIndex(
                name: "IX_ContentReports_Target",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.DropIndex(
                name: "UX_ContentReports_OpenPerReporterTarget",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ContentReports_Source_Valid",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ContentReports_Status_Valid",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.DropColumn(
                name: "ReviewedByAdminUserId",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.DropColumn(
                name: "SnapshotTitle",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.DropColumn(
                name: "SnapshotUrl",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.DropColumn(
                name: "Source",
                schema: "safety",
                table: "ContentReports");

            migrationBuilder.CreateIndex(
                name: "UX_ContentReports_OpenPerReporterTarget",
                schema: "safety",
                table: "ContentReports",
                columns: new[] { "ReporterUserId", "TargetType", "TargetId" },
                unique: true,
                filter: "[Status] = 'Pending' AND [ReporterUserId] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ContentReports_Status_Valid",
                schema: "safety",
                table: "ContentReports",
                sql: "[Status] IN ('Pending', 'Reviewed', 'Dismissed', 'Actioned')");
        }
    }
}
