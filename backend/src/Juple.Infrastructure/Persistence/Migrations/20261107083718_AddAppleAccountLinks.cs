using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAppleAccountLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AppleAccountLinks",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    AppAccountToken = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppleAccountLinks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "UX_AppleAccountLinks_AppAccountToken",
                schema: "billing",
                table: "AppleAccountLinks",
                column: "AppAccountToken",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_AppleAccountLinks_UserId",
                schema: "billing",
                table: "AppleAccountLinks",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AppleAccountLinks",
                schema: "billing");
        }
    }
}
