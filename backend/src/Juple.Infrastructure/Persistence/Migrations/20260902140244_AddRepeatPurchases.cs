using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRepeatPurchases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "RepeatPurchaseId",
                schema: "purchases",
                table: "Purchases",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "RepeatPurchases",
                schema: "purchases",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    ItemId = table.Column<long>(type: "bigint", nullable: true),
                    ProductName = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    IntervalValue = table.Column<int>(type: "int", nullable: false),
                    IntervalUnit = table.Column<byte>(type: "tinyint", nullable: false),
                    NextPurchaseDate = table.Column<DateOnly>(type: "date", nullable: false),
                    IsReminderEnabled = table.Column<bool>(type: "bit", nullable: false),
                    ReminderLeadDays = table.Column<int>(type: "int", nullable: false),
                    IsEnabled = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RepeatPurchases", x => x.Id);
                    table.CheckConstraint("CK_RepeatPurchases_IntervalUnit_Valid", "[IntervalUnit] IN (0, 1, 2)");
                    table.CheckConstraint("CK_RepeatPurchases_IntervalValue_Positive", "[IntervalValue] > 0");
                    table.CheckConstraint("CK_RepeatPurchases_ProductName_NotWhitespaceOnly", "PATINDEX('%[^' + CHAR(9) + CHAR(10) + CHAR(13) + ' ]%', [ProductName]) > 0");
                    table.CheckConstraint("CK_RepeatPurchases_ReminderLeadDays_NonNegative", "[ReminderLeadDays] >= 0");
                    table.ForeignKey(
                        name: "FK_RepeatPurchases_Items_ItemId",
                        column: x => x.ItemId,
                        principalSchema: "items",
                        principalTable: "Items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_RepeatPurchases_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_RepeatPurchaseId",
                schema: "purchases",
                table: "Purchases",
                column: "RepeatPurchaseId");

            migrationBuilder.CreateIndex(
                name: "IX_RepeatPurchases_ItemId",
                schema: "purchases",
                table: "RepeatPurchases",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_RepeatPurchases_UserId_IsEnabled_NextPurchaseDate_Id",
                schema: "purchases",
                table: "RepeatPurchases",
                columns: new[] { "UserId", "IsEnabled", "NextPurchaseDate", "Id" });

            migrationBuilder.AddForeignKey(
                name: "FK_Purchases_RepeatPurchases_RepeatPurchaseId",
                schema: "purchases",
                table: "Purchases",
                column: "RepeatPurchaseId",
                principalSchema: "purchases",
                principalTable: "RepeatPurchases",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Purchases_RepeatPurchases_RepeatPurchaseId",
                schema: "purchases",
                table: "Purchases");

            migrationBuilder.DropTable(
                name: "RepeatPurchases",
                schema: "purchases");

            migrationBuilder.DropIndex(
                name: "IX_Purchases_RepeatPurchaseId",
                schema: "purchases",
                table: "Purchases");

            migrationBuilder.DropColumn(
                name: "RepeatPurchaseId",
                schema: "purchases",
                table: "Purchases");
        }
    }
}
