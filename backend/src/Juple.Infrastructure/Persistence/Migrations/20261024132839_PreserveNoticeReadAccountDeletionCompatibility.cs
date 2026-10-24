using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PreserveNoticeReadAccountDeletionCompatibility : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NoticeReads_Users_UserId",
                schema: "notices",
                table: "NoticeReads");

            migrationBuilder.AddForeignKey(
                name: "FK_NoticeReads_Users_UserId",
                schema: "notices",
                table: "NoticeReads",
                column: "UserId",
                principalSchema: "users",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NoticeReads_Users_UserId",
                schema: "notices",
                table: "NoticeReads");

            migrationBuilder.AddForeignKey(
                name: "FK_NoticeReads_Users_UserId",
                schema: "notices",
                table: "NoticeReads",
                column: "UserId",
                principalSchema: "users",
                principalTable: "Users",
                principalColumn: "Id");
        }
    }
}
