using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionItemReactions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_CollectionItems_CollectionId_ItemId",
                schema: "collections",
                table: "CollectionItems");

            migrationBuilder.AddUniqueConstraint(
                name: "UX_CollectionItems_CollectionId_ItemId",
                schema: "collections",
                table: "CollectionItems",
                columns: new[] { "CollectionId", "ItemId" });

            migrationBuilder.CreateTable(
                name: "CollectionItemReactions",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    ItemId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    ReactionKey = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionItemReactions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionItemReactions_CollectionItems_CollectionId_ItemId",
                        columns: x => new { x.CollectionId, x.ItemId },
                        principalSchema: "collections",
                        principalTable: "CollectionItems",
                        principalColumns: new[] { "CollectionId", "ItemId" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionItemReactions_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItemReactions_UserId_CollectionId",
                schema: "collections",
                table: "CollectionItemReactions",
                columns: new[] { "UserId", "CollectionId" });

            migrationBuilder.CreateIndex(
                name: "UX_CollectionItemReactions_CollectionId_ItemId_UserId",
                schema: "collections",
                table: "CollectionItemReactions",
                columns: new[] { "CollectionId", "ItemId", "UserId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollectionItemReactions",
                schema: "collections");

            migrationBuilder.DropUniqueConstraint(
                name: "UX_CollectionItems_CollectionId_ItemId",
                schema: "collections",
                table: "CollectionItems");

            migrationBuilder.CreateIndex(
                name: "UX_CollectionItems_CollectionId_ItemId",
                schema: "collections",
                table: "CollectionItems",
                columns: new[] { "CollectionId", "ItemId" },
                unique: true);
        }
    }
}
