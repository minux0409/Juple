using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDataRetentionSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<byte[]>(
                name: "VerificationHandleEncrypted",
                schema: "billing",
                table: "StorePurchases",
                type: "varbinary(2048)",
                nullable: true,
                oldClrType: typeof(byte[]),
                oldType: "varbinary(2048)");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "VerificationHandlePurgedAtUtc",
                schema: "billing",
                table: "StorePurchases",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoreEvents_ProcessedAtUtc",
                schema: "billing",
                table: "StoreEvents",
                column: "ProcessedAtUtc",
                filter: "[ProcessedAtUtc] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_CreatedAtUtc",
                schema: "notifications",
                table: "Notifications",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_Items_DeletedAtUtc_Id",
                schema: "items",
                table: "Items",
                columns: new[] { "DeletedAtUtc", "Id" },
                filter: "[DeletedAtUtc] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Collections_DeletedAtUtc_Id",
                schema: "collections",
                table: "Collections",
                columns: new[] { "DeletedAtUtc", "Id" },
                filter: "[DeletedAtUtc] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_StoreEvents_ProcessedAtUtc",
                schema: "billing",
                table: "StoreEvents");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_CreatedAtUtc",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropIndex(
                name: "IX_Items_DeletedAtUtc_Id",
                schema: "items",
                table: "Items");

            migrationBuilder.DropIndex(
                name: "IX_Collections_DeletedAtUtc_Id",
                schema: "collections",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "VerificationHandlePurgedAtUtc",
                schema: "billing",
                table: "StorePurchases");

            migrationBuilder.AlterColumn<byte[]>(
                name: "VerificationHandleEncrypted",
                schema: "billing",
                table: "StorePurchases",
                type: "varbinary(2048)",
                nullable: false,
                defaultValue: new byte[0],
                oldClrType: typeof(byte[]),
                oldType: "varbinary(2048)",
                oldNullable: true);
        }
    }
}
