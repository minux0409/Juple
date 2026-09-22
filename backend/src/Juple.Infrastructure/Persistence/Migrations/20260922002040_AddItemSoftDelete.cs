using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddItemSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeletedAtUtc",
                schema: "items",
                table: "Items",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Items_UserId_DeletedAtUtc_Id",
                schema: "items",
                table: "Items",
                columns: new[] { "UserId", "DeletedAtUtc", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Items_UserId_DeletedAtUtc_Id",
                schema: "items",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "DeletedAtUtc",
                schema: "items",
                table: "Items");
        }
    }
}
