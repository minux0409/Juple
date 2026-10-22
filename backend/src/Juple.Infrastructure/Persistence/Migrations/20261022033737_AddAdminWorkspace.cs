using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Expenses_Status",
                schema: "admin",
                table: "Expenses");

            migrationBuilder.AddColumn<string>(
                name: "CustomCategory",
                schema: "admin",
                table: "Expenses",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExchangeRateSource",
                schema: "admin",
                table: "Expenses",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PeriodFrom",
                schema: "admin",
                table: "Expenses",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PeriodThrough",
                schema: "admin",
                table: "Expenses",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "UserDailyActivitiesKst",
                schema: "analytics",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Platform = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    LastSeenAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserDailyActivitiesKst", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserDailyActivitiesKst_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Expenses_Status",
                schema: "admin",
                table: "Expenses",
                sql: "[Status] IN ('Estimated','Paid','Cancelled','Provisional')");

            migrationBuilder.CreateIndex(
                name: "IX_UserDailyActivitiesKst_Date",
                schema: "analytics",
                table: "UserDailyActivitiesKst",
                column: "Date")
                .Annotation("SqlServer:Include", new[] { "UserId", "Platform" });

            migrationBuilder.CreateIndex(
                name: "IX_UserDailyActivitiesKst_UserId_Date_Platform",
                schema: "analytics",
                table: "UserDailyActivitiesKst",
                columns: new[] { "UserId", "Date", "Platform" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserDailyActivitiesKst",
                schema: "analytics");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Expenses_Status",
                schema: "admin",
                table: "Expenses");

            migrationBuilder.DropColumn(
                name: "CustomCategory",
                schema: "admin",
                table: "Expenses");

            migrationBuilder.DropColumn(
                name: "ExchangeRateSource",
                schema: "admin",
                table: "Expenses");

            migrationBuilder.DropColumn(
                name: "PeriodFrom",
                schema: "admin",
                table: "Expenses");

            migrationBuilder.DropColumn(
                name: "PeriodThrough",
                schema: "admin",
                table: "Expenses");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Expenses_Status",
                schema: "admin",
                table: "Expenses",
                sql: "[Status] IN ('Estimated','Paid','Cancelled')");
        }
    }
}
