using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddItemSaveRequestLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1) Create the ledger table first so the backfill below has somewhere to write.
            migrationBuilder.CreateTable(
                name: "ItemSaveRequests",
                schema: "items",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ItemId = table.Column<long>(type: "bigint", nullable: false),
                    Url = table.Column<string>(type: "nvarchar(max)", maxLength: 4096, nullable: false),
                    SavedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ItemSaveRequests", x => x.Id);
                    table.CheckConstraint("CK_ItemSaveRequests_Url_MaxLength", "DATALENGTH([Url]) <= 8192");
                    table.ForeignKey(
                        name: "FK_ItemSaveRequests_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "UX_ItemSaveRequests_UserId_ClientRequestId",
                schema: "items",
                table: "ItemSaveRequests",
                columns: new[] { "UserId", "ClientRequestId" },
                unique: true);

            // 2) Backfill one ledger row per existing Item that carries a ClientRequestId - this is
            // exactly the row set the old UX_Items_UserId_ClientRequestId unique index protected.
            // ItemId is copied from Items.Id but is intentionally not a foreign key (see
            // ItemSaveRequestConfiguration): the ledger must keep working even if that Item is
            // later hard-deleted.
            migrationBuilder.Sql(
                "INSERT INTO [items].[ItemSaveRequests] ([UserId], [ClientRequestId], [ItemId], [Url], [SavedAtUtc]) " +
                "SELECT [UserId], [ClientRequestId], [Id], [Url], [SavedAtUtc] " +
                "FROM [items].[Items] " +
                "WHERE [ClientRequestId] IS NOT NULL;");

            // 3) Only now is it safe to remove the old idempotency key from Items - the ledger
            // already holds every row it protected.
            migrationBuilder.DropIndex(
                name: "UX_Items_UserId_ClientRequestId",
                schema: "items",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "ClientRequestId",
                schema: "items",
                table: "Items");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ClientRequestId",
                schema: "items",
                table: "Items",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.Sql(
                "UPDATE i SET i.[ClientRequestId] = r.[ClientRequestId] " +
                "FROM [items].[Items] AS i " +
                "INNER JOIN [items].[ItemSaveRequests] AS r ON r.[ItemId] = i.[Id];");

            migrationBuilder.CreateIndex(
                name: "UX_Items_UserId_ClientRequestId",
                schema: "items",
                table: "Items",
                columns: new[] { "UserId", "ClientRequestId" },
                unique: true,
                filter: "[ClientRequestId] IS NOT NULL");

            migrationBuilder.DropTable(
                name: "ItemSaveRequests",
                schema: "items");
        }
    }
}
