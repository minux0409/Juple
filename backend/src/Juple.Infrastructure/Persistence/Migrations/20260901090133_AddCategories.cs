using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "categories");

            migrationBuilder.AddColumn<long>(
                name: "CategoryId",
                schema: "items",
                table: "Items",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Categories",
                schema: "categories",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
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

            migrationBuilder.DropColumn(
                name: "CategoryId",
                schema: "items",
                table: "Items");
        }
    }
}
