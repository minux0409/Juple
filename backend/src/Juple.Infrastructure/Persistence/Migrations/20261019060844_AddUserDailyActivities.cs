using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserDailyActivities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "analytics");

            migrationBuilder.CreateTable(
                name: "UserDailyActivities",
                schema: "analytics",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    ActivityDateUtc = table.Column<DateOnly>(type: "date", nullable: false),
                    Platform = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    AppBuild = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    FirstSeenAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    LastSeenAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserDailyActivities", x => x.Id);
                    table.CheckConstraint("CK_UserDailyActivities_Platform_Valid", "[Platform] IN ('Unknown', 'Android', 'Ios', 'Web')");
                    table.CheckConstraint("CK_UserDailyActivities_SeenOrder", "[LastSeenAtUtc] >= [FirstSeenAtUtc]");
                    table.ForeignKey(
                        name: "FK_UserDailyActivities_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserDailyActivities_ActivityDateUtc",
                schema: "analytics",
                table: "UserDailyActivities",
                column: "ActivityDateUtc")
                .Annotation("SqlServer:Include", new[] { "UserId", "Platform" });

            migrationBuilder.CreateIndex(
                name: "UX_UserDailyActivities_User_Date_Platform",
                schema: "analytics",
                table: "UserDailyActivities",
                columns: new[] { "UserId", "ActivityDateUtc", "Platform" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserDailyActivities",
                schema: "analytics");
        }
    }
}
