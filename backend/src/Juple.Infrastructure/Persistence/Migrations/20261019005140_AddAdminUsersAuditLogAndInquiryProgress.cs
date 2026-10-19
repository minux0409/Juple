using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminUsersAuditLogAndInquiryProgress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SupportInquiries_Answer_Consistent",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SupportInquiries_Status_Valid",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.EnsureSchema(
                name: "admin");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UpdatedAtUtc",
                schema: "support",
                table: "SupportInquiries",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AdminAuditLogs",
                schema: "admin",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AdminUserId = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    TargetType = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TargetId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Detail = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AdminAuditLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AdminUsers",
                schema: "admin",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    Role = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    GrantedByUserId = table.Column<long>(type: "bigint", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AdminUsers", x => x.Id);
                    table.CheckConstraint("CK_AdminUsers_Role_Valid", "[Role] IN ('Owner', 'Admin')");
                    table.ForeignKey(
                        name: "FK_AdminUsers_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_SupportInquiries_Answer_Consistent",
                schema: "support",
                table: "SupportInquiries",
                sql: "([Status] IN ('Pending', 'InProgress') AND [Answer] IS NULL AND [AnsweredAtUtc] IS NULL) OR ([Status] = 'Answered' AND [Answer] IS NOT NULL AND [AnsweredAtUtc] IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SupportInquiries_Status_Valid",
                schema: "support",
                table: "SupportInquiries",
                sql: "[Status] IN ('Pending', 'InProgress', 'Answered')");

            migrationBuilder.CreateIndex(
                name: "IX_AdminAuditLogs_Target",
                schema: "admin",
                table: "AdminAuditLogs",
                columns: new[] { "TargetType", "TargetId", "Id" });

            migrationBuilder.CreateIndex(
                name: "UX_AdminUsers_UserId",
                schema: "admin",
                table: "AdminUsers",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AdminAuditLogs",
                schema: "admin");

            migrationBuilder.DropTable(
                name: "AdminUsers",
                schema: "admin");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SupportInquiries_Answer_Consistent",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SupportInquiries_Status_Valid",
                schema: "support",
                table: "SupportInquiries");

            // The older constraints know no 처리중: an in-progress inquiry goes back to 접수 (it is still unanswered) before they return.
            migrationBuilder.Sql("UPDATE [support].[SupportInquiries] SET [Status] = N'Pending' WHERE [Status] = N'InProgress';");

            migrationBuilder.DropColumn(
                name: "UpdatedAtUtc",
                schema: "support",
                table: "SupportInquiries");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SupportInquiries_Answer_Consistent",
                schema: "support",
                table: "SupportInquiries",
                sql: "([Status] = 'Pending' AND [Answer] IS NULL AND [AnsweredAtUtc] IS NULL) OR ([Status] = 'Answered' AND [Answer] IS NOT NULL AND [AnsweredAtUtc] IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SupportInquiries_Status_Valid",
                schema: "support",
                table: "SupportInquiries",
                sql: "[Status] IN ('Pending', 'Answered')");
        }
    }
}
