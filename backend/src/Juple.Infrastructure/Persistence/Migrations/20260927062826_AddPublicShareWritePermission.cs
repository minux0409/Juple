using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPublicShareWritePermission : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Permission",
                schema: "collections",
                table: "CollectionShares",
                type: "varchar(10)",
                nullable: false,
                defaultValue: "Read");

            migrationBuilder.AddColumn<bool>(
                name: "AddedViaPublicShare",
                schema: "collections",
                table: "CollectionItems",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Permission",
                schema: "collections",
                table: "CollectionShares");

            migrationBuilder.DropColumn(
                name: "AddedViaPublicShare",
                schema: "collections",
                table: "CollectionItems");
        }
    }
}
