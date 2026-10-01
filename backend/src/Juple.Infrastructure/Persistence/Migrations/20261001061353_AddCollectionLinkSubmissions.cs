using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionLinkSubmissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CollectionLinkSubmissions",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    ItemId = table.Column<long>(type: "bigint", nullable: false),
                    SubmittedByUserId = table.Column<long>(type: "bigint", nullable: false),
                    ViaPublicShare = table.Column<bool>(type: "bit", nullable: false),
                    Url = table.Column<string>(type: "nvarchar(max)", maxLength: 4096, nullable: false),
                    UrlHash = table.Column<byte[]>(type: "binary(32)", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    PreviewImageUrl = table.Column<string>(type: "nvarchar(max)", maxLength: 4096, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionLinkSubmissions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionLinkSubmissions_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionLinkSubmissions_Items_ItemId",
                        column: x => x.ItemId,
                        principalSchema: "items",
                        principalTable: "Items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionLinkSubmissions_Users_SubmittedByUserId",
                        column: x => x.SubmittedByUserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CollectionLinkSubmissions_CollectionId_Id",
                schema: "collections",
                table: "CollectionLinkSubmissions",
                columns: new[] { "CollectionId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_CollectionLinkSubmissions_ItemId",
                schema: "collections",
                table: "CollectionLinkSubmissions",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionLinkSubmissions_SubmittedByUserId",
                schema: "collections",
                table: "CollectionLinkSubmissions",
                column: "SubmittedByUserId");

            migrationBuilder.CreateIndex(
                name: "UX_CollectionLinkSubmissions_CollectionId_UrlHash",
                schema: "collections",
                table: "CollectionLinkSubmissions",
                columns: new[] { "CollectionId", "UrlHash" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollectionLinkSubmissions",
                schema: "collections");
        }
    }
}
