using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionItemSortOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CollectionItems_CollectionId_AddedAtUtc_ItemId",
                schema: "collections",
                table: "CollectionItems");

            // SortOrder: added nullable first, backfilled for existing rows, then tightened to NOT
            // NULL (mirrors this project's own ConvertInboxEntriesToItems migration's
            // StateChangedAtUtc backfill). The backfill preserves each existing row's current
            // visible order exactly (AddedAtUtc DESC, Id DESC - the same ordering GetItemsAsync used
            // before this migration), spaced by 4096 (matches CollectionStore.SortOrderGap) so a
            // manual reorder or a new prepend can slot in between existing values without touching
            // every row.
            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                schema: "collections",
                table: "CollectionItems",
                type: "int",
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE ci
                SET ci.SortOrder = ranked.RowNumber
                FROM [collections].[CollectionItems] AS ci
                INNER JOIN (
                    SELECT
                        Id,
                        (ROW_NUMBER() OVER (PARTITION BY CollectionId ORDER BY AddedAtUtc DESC, Id DESC) - 1) * 4096 AS RowNumber
                    FROM [collections].[CollectionItems]
                ) AS ranked ON ranked.Id = ci.Id
                WHERE ci.SortOrder IS NULL;
                """);

            migrationBuilder.AlterColumn<int>(
                name: "SortOrder",
                schema: "collections",
                table: "CollectionItems",
                type: "int",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItems_CollectionId_SortOrder_Id",
                schema: "collections",
                table: "CollectionItems",
                columns: new[] { "CollectionId", "SortOrder", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CollectionItems_CollectionId_SortOrder_Id",
                schema: "collections",
                table: "CollectionItems");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                schema: "collections",
                table: "CollectionItems");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItems_CollectionId_AddedAtUtc_ItemId",
                schema: "collections",
                table: "CollectionItems",
                columns: new[] { "CollectionId", "AddedAtUtc", "ItemId" });
        }
    }
}
