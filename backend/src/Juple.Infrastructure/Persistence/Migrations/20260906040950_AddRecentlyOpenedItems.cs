using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRecentlyOpenedItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecentlyOpenedItems",
                schema: "items",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    ItemId = table.Column<long>(type: "bigint", nullable: false),
                    LastOpenedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecentlyOpenedItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecentlyOpenedItems_Items_ItemId",
                        column: x => x.ItemId,
                        principalSchema: "items",
                        principalTable: "Items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RecentlyOpenedItems_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecentlyOpenedItems_ItemId",
                schema: "items",
                table: "RecentlyOpenedItems",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_RecentlyOpenedItems_UserId_LastOpenedAtUtc_ItemId",
                schema: "items",
                table: "RecentlyOpenedItems",
                columns: new[] { "UserId", "LastOpenedAtUtc", "ItemId" });

            migrationBuilder.CreateIndex(
                name: "UX_RecentlyOpenedItems_UserId_ItemId",
                schema: "items",
                table: "RecentlyOpenedItems",
                columns: new[] { "UserId", "ItemId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecentlyOpenedItems",
                schema: "items");
        }
    }
}
