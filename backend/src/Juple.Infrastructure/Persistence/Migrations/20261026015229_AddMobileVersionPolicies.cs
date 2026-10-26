using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMobileVersionPolicies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MobileVersionPolicies",
                schema: "admin",
                columns: table => new
                {
                    Platform = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    LatestBuild = table.Column<int>(type: "int", nullable: false),
                    MinimumSupportedBuild = table.Column<int>(type: "int", nullable: false),
                    UpdatedByAdminUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MobileVersionPolicies", x => x.Platform);
                    table.CheckConstraint("CK_MobileVersionPolicies_Builds_Valid", "[LatestBuild] >= 1 AND [MinimumSupportedBuild] >= 1 AND [MinimumSupportedBuild] <= [LatestBuild]");
                    table.CheckConstraint("CK_MobileVersionPolicies_Platform_Valid", "[Platform] IN ('android', 'ios')");
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MobileVersionPolicies",
                schema: "admin");
        }
    }
}
