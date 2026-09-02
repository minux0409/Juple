using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "purchases");

            migrationBuilder.CreateTable(
                name: "Purchases",
                schema: "purchases",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    ItemId = table.Column<long>(type: "bigint", nullable: true),
                    PurchaseDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ProductName = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(19,4)", nullable: true),
                    CurrencyCode = table.Column<string>(type: "char(3)", unicode: false, nullable: true),
                    Store = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Variant = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Quantity = table.Column<decimal>(type: "decimal(18,3)", nullable: true),
                    Memo = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Purchases", x => x.Id);
                    table.CheckConstraint("CK_Purchases_Amount_CurrencyCode_Together", "([Amount] IS NULL AND [CurrencyCode] IS NULL) OR ([Amount] IS NOT NULL AND [CurrencyCode] IS NOT NULL)");
                    table.CheckConstraint("CK_Purchases_Amount_NonNegative", "[Amount] >= 0");
                    table.CheckConstraint("CK_Purchases_ProductName_NotWhitespaceOnly", "PATINDEX('%[^' + CHAR(9) + CHAR(10) + CHAR(13) + ' ]%', [ProductName]) > 0");
                    table.CheckConstraint("CK_Purchases_Quantity_Positive", "[Quantity] > 0");
                    table.ForeignKey(
                        name: "FK_Purchases_Items_ItemId",
                        column: x => x.ItemId,
                        principalSchema: "items",
                        principalTable: "Items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Purchases_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_ItemId",
                schema: "purchases",
                table: "Purchases",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_UserId_PurchaseDate_Id",
                schema: "purchases",
                table: "Purchases",
                columns: new[] { "UserId", "PurchaseDate", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Purchases",
                schema: "purchases");
        }
    }
}
