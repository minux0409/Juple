using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Removes the legacy ItemState (Inbox/Wishlist/Archived) and Category subsystems, translating
    /// their meaning into Collections (this product's remaining organization mechanism) first:
    /// Wishlist-state Items move into a per-user "Wishlist" Collection, Archived-state Items into a
    /// per-user "Archive" Collection, and every Category (Category is user-created data, so this
    /// includes Categories with zero Items - they become an empty Collection rather than being
    /// silently dropped) becomes a per-user Collection named after it, with Category-assigned Items
    /// added as members. An Item that was both Wishlist/Archived and Category-assigned ends up in
    /// both Collections. A Collection whose normalized name (CollectionNameNormalizer: trim +
    /// ToUpperInvariant) already matches is reused rather than duplicated - so a user who already
    /// has a Collection named "Wishlist" or the same name as one of their Categories never gets a
    /// second one.
    ///
    /// This is a genuine one-way data transform, not an idempotent script: Down() restores the
    /// dropped schema (columns/index/FK/table) but cannot restore the original State/CategoryId
    /// values, since that information no longer has a lossless inverse once merged into Collections
    /// (and further diverges the moment a user edits the resulting Collection afterward). Restored
    /// Items get State=Inbox(0)/CategoryId=NULL - a safe, honestly-labeled structural rollback, not
    /// a semantic one.
    /// </summary>
    public partial class RemoveItemStateAndCategory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Data preservation: before the ItemState/Category schema below is dropped, translate
            // its meaning into Collections (this product's remaining organization mechanism) so no
            // user-visible grouping is silently lost. See the design notes at the bottom of this
            // file for the merge/timestamp rules this implements.
            migrationBuilder.Sql(
                """
                SET QUOTED_IDENTIFIER ON;
                DECLARE @MigrationTimeUtc datetimeoffset = SYSDATETIMEOFFSET();

                -- 1) Wishlist Collection per user with >=1 Wishlist-state (State=1) Item. Reuses an
                --    existing same-normalized-name Collection instead of creating a duplicate (e.g.
                --    a Category literally named "Wishlist" already produced one below/above it,
                --    depending on statement order - Wishlist runs first so it always wins the name).
                INSERT INTO collections.Collections (UserId, Name, NameNormalized, CreatedAtUtc, UpdatedAtUtc, IsFavorite)
                SELECT DISTINCT i.UserId, N'Wishlist', N'WISHLIST', @MigrationTimeUtc, @MigrationTimeUtc, 0
                FROM items.Items i
                WHERE i.State = 1
                  AND NOT EXISTS (
                      SELECT 1 FROM collections.Collections c
                      WHERE c.UserId = i.UserId AND c.NameNormalized = N'WISHLIST');

                -- 2) Archive Collection per user with >=1 Archived-state (State=2) Item - same merge rule.
                INSERT INTO collections.Collections (UserId, Name, NameNormalized, CreatedAtUtc, UpdatedAtUtc, IsFavorite)
                SELECT DISTINCT i.UserId, N'Archive', N'ARCHIVE', @MigrationTimeUtc, @MigrationTimeUtc, 0
                FROM items.Items i
                WHERE i.State = 2
                  AND NOT EXISTS (
                      SELECT 1 FROM collections.Collections c
                      WHERE c.UserId = i.UserId AND c.NameNormalized = N'ARCHIVE');

                -- 3) One Collection per Category row, regardless of how many Items reference it
                --    (Category is user-created data - an unused/empty Category is still preserved,
                --    as an empty Collection, not silently dropped). Reuses an existing same-
                --    normalized-name Collection, including the Wishlist/Archive ones just created
                --    above - a Category literally named "Wishlist" or "Archive" merges into that
                --    Collection rather than duplicating it.
                INSERT INTO collections.Collections (UserId, Name, NameNormalized, CreatedAtUtc, UpdatedAtUtc, IsFavorite)
                SELECT DISTINCT cat.UserId, cat.Name, UPPER(LTRIM(RTRIM(cat.Name))), @MigrationTimeUtc, @MigrationTimeUtc, 0
                FROM categories.Categories cat
                WHERE NOT EXISTS (
                      SELECT 1 FROM collections.Collections c
                      WHERE c.UserId = cat.UserId AND c.NameNormalized = UPPER(LTRIM(RTRIM(cat.Name))));

                -- 4) Wishlist-state Items -> membership in that user's Wishlist Collection.
                --    AddedAtUtc reuses Item.StateChangedAtUtc (the real moment the Item became
                --    Wishlist) rather than the migration time, since that value already exists and
                --    is not fabricated.
                INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedAtUtc)
                SELECT c.Id, i.Id, i.StateChangedAtUtc
                FROM items.Items i
                JOIN collections.Collections c ON c.UserId = i.UserId AND c.NameNormalized = N'WISHLIST'
                WHERE i.State = 1
                  AND NOT EXISTS (
                      SELECT 1 FROM collections.CollectionItems ci WHERE ci.CollectionId = c.Id AND ci.ItemId = i.Id);

                -- 5) Archived-state Items -> membership in that user's Archive Collection, same
                --    AddedAtUtc rule as (4).
                INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedAtUtc)
                SELECT c.Id, i.Id, i.StateChangedAtUtc
                FROM items.Items i
                JOIN collections.Collections c ON c.UserId = i.UserId AND c.NameNormalized = N'ARCHIVE'
                WHERE i.State = 2
                  AND NOT EXISTS (
                      SELECT 1 FROM collections.CollectionItems ci WHERE ci.CollectionId = c.Id AND ci.ItemId = i.Id);

                -- 6) Category-assigned Items -> membership in the matching Collection. AddedAtUtc
                --    uses the migration time here (not SavedAtUtc) because Juple never recorded when
                --    a Category was assigned to an Item - there is no real historical timestamp to
                --    preserve, so migration time is the honest choice rather than a fabricated one.
                --    An Item that is both Wishlist/Archived AND Category-assigned gets both
                --    memberships, since this INSERT and (4)/(5) above target independent Collections.
                INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedAtUtc)
                SELECT c.Id, i.Id, @MigrationTimeUtc
                FROM items.Items i
                JOIN categories.Categories cat ON cat.Id = i.CategoryId
                JOIN collections.Collections c ON c.UserId = i.UserId AND c.NameNormalized = UPPER(LTRIM(RTRIM(cat.Name)))
                WHERE i.CategoryId IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM collections.CollectionItems ci WHERE ci.CollectionId = c.Id AND ci.ItemId = i.Id);
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Items_Categories_CategoryId",
                schema: "items",
                table: "Items");

            migrationBuilder.DropTable(
                name: "Categories",
                schema: "categories");

            migrationBuilder.DropIndex(
                name: "IX_Items_CategoryId",
                schema: "items",
                table: "Items");

            migrationBuilder.DropIndex(
                name: "IX_Items_UserId_State_StateChangedAtUtc_Id",
                schema: "items",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "CategoryId",
                schema: "items",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "State",
                schema: "items",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "StateChangedAtUtc",
                schema: "items",
                table: "Items");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "categories");

            migrationBuilder.AddColumn<long>(
                name: "CategoryId",
                schema: "items",
                table: "Items",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<byte>(
                name: "State",
                schema: "items",
                table: "Items",
                type: "tinyint",
                nullable: false,
                defaultValue: (byte)0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "StateChangedAtUtc",
                schema: "items",
                table: "Items",
                type: "datetimeoffset",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.CreateTable(
                name: "Categories",
                schema: "categories",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Categories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Categories_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Items_CategoryId",
                schema: "items",
                table: "Items",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Items_UserId_State_StateChangedAtUtc_Id",
                schema: "items",
                table: "Items",
                columns: new[] { "UserId", "State", "StateChangedAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Categories_UserId_SortOrder_Id",
                schema: "categories",
                table: "Categories",
                columns: new[] { "UserId", "SortOrder", "Id" });

            migrationBuilder.CreateIndex(
                name: "UX_Categories_UserId_Name",
                schema: "categories",
                table: "Categories",
                columns: new[] { "UserId", "Name" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Items_Categories_CategoryId",
                schema: "items",
                table: "Items",
                column: "CategoryId",
                principalSchema: "categories",
                principalTable: "Categories",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
