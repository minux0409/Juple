using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeletedAtUtc",
                schema: "collections",
                table: "Collections",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Collections_UserId_DeletedAtUtc_Id",
                schema: "collections",
                table: "Collections",
                columns: new[] { "UserId", "DeletedAtUtc", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Collections_UserId_DeletedAtUtc_Id",
                schema: "collections",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "DeletedAtUtc",
                schema: "collections",
                table: "Collections");
        }
    }
}
