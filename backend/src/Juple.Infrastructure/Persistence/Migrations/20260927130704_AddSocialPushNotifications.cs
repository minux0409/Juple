using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSocialPushNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.AddColumn<long>(
                name: "ActorUserId",
                schema: "notifications",
                table: "Notifications",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "CollectionId",
                schema: "notifications",
                table: "Notifications",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DedupKey",
                schema: "notifications",
                table: "Notifications",
                type: "varchar(120)",
                unicode: false,
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DispatchedAtUtc",
                schema: "notifications",
                table: "Notifications",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "SubjectId",
                schema: "notifications",
                table: "Notifications",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_ActorUserId",
                schema: "notifications",
                table: "Notifications",
                column: "ActorUserId",
                filter: "[ActorUserId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_PendingDispatch",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "CreatedAtUtc", "Id" },
                filter: "[DispatchedAtUtc] IS NULL AND [DedupKey] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UX_Notifications_DedupKey",
                schema: "notifications",
                table: "Notifications",
                column: "DedupKey",
                unique: true,
                filter: "[DedupKey] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Notifications_ActorUserId",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_PendingDispatch",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropIndex(
                name: "UX_Notifications_DedupKey",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropColumn(
                name: "ActorUserId",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropColumn(
                name: "CollectionId",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropColumn(
                name: "DedupKey",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropColumn(
                name: "DispatchedAtUtc",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropColumn(
                name: "SubjectId",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0)");
        }
    }
}
