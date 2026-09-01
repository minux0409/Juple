using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddItemStateQueryIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Items_UserId_State_StateChangedAtUtc_Id",
                schema: "items",
                table: "Items",
                columns: new[] { "UserId", "State", "StateChangedAtUtc", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Items_UserId_State_StateChangedAtUtc_Id",
                schema: "items",
                table: "Items");
        }
    }
}
