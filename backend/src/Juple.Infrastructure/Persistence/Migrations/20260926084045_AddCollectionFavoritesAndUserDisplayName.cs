using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// EXPAND half of the favorites transition (contract: FinalizeCollectionFavoriteTransition):
    /// per-user Collection favorites and the optional user display name. Purely additive - a
    /// previous API revision keeps working unchanged against it. No trigger bridge: Collections has
    /// a rowversion, so EF writes it with UPDATE ... OUTPUT, which SQL Server refuses on a table with
    /// a trigger - it would break every Collections write of that previous revision. Instead the
    /// legacy IsFavorite column stays authoritative for OWNERS during the transition (the current
    /// revision reads it and writes it together with CollectionFavorites), so nothing the previous
    /// revision writes is ever missed.
    /// </summary>
    public partial class AddCollectionFavoritesAndUserDisplayName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DisplayName",
                schema: "users",
                table: "Users",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CollectionFavorites",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionFavorites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionFavorites_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionFavorites_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CollectionFavorites_CollectionId",
                schema: "collections",
                table: "CollectionFavorites",
                column: "CollectionId");

            migrationBuilder.CreateIndex(
                name: "UX_CollectionFavorites_UserId_CollectionId",
                schema: "collections",
                table: "CollectionFavorites",
                columns: new[] { "UserId", "CollectionId" },
                unique: true);

            // Every existing favorite was the Owner's own (the only person who could set it), so it
            // becomes exactly that Owner's mark - including on soft-deleted Collections, so a later
            // restore keeps it. Owner rows may drift from the legacy column while a previous revision
            // still writes it; that is harmless (Owners are read from the legacy column) and
            // FinalizeCollectionFavoriteTransition rebuilds them from it.
            migrationBuilder.Sql(
                """
                INSERT INTO [collections].[CollectionFavorites] ([UserId], [CollectionId], [CreatedAtUtc])
                SELECT c.[UserId], c.[Id], TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00')
                FROM [collections].[Collections] AS c
                WHERE c.[IsFavorite] = 1
                    AND NOT EXISTS (
                        SELECT 1 FROM [collections].[CollectionFavorites] AS f
                        WHERE f.[UserId] = c.[UserId] AND f.[CollectionId] = c.[Id]);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Owners' marks are already in the legacy column (authoritative for them throughout the
            // transition), so nothing is copied back; Contributors' marks have no legacy equivalent
            // and go with the table.
            migrationBuilder.DropTable(
                name: "CollectionFavorites",
                schema: "collections");

            migrationBuilder.DropColumn(
                name: "DisplayName",
                schema: "users",
                table: "Users");
        }
    }
}
