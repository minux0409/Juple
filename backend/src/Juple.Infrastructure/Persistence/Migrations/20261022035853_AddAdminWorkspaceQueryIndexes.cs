using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminWorkspaceQueryIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Users_CreatedAtUtc",
                schema: "users",
                table: "Users",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_Items_SavedAtUtc",
                schema: "items",
                table: "Items",
                column: "SavedAtUtc")
                .Annotation("SqlServer:Include", new[] { "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_Expenses_Source_SubscriptionId_OccurredOn",
                schema: "admin",
                table: "Expenses",
                columns: new[] { "Source", "SubscriptionId", "OccurredOn" })
                .Annotation("SqlServer:Include", new[] { "ResourceGroup", "NoLongerReported", "DeletedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Collections_CreatedAtUtc",
                schema: "collections",
                table: "Collections",
                column: "CreatedAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_CreatedAtUtc",
                schema: "users",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Items_SavedAtUtc",
                schema: "items",
                table: "Items");

            migrationBuilder.DropIndex(
                name: "IX_Expenses_Source_SubscriptionId_OccurredOn",
                schema: "admin",
                table: "Expenses");

            migrationBuilder.DropIndex(
                name: "IX_Collections_CreatedAtUtc",
                schema: "collections",
                table: "Collections");
        }
    }
}
