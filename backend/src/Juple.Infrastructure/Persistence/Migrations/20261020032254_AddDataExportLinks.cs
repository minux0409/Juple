using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDataExportLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DataExportLinks",
                schema: "users",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    TokenHash = table.Column<byte[]>(type: "binary(32)", nullable: false),
                    Part = table.Column<byte>(type: "tinyint", nullable: false),
                    ImagePartNumber = table.Column<int>(type: "int", nullable: true),
                    FromImageId = table.Column<long>(type: "bigint", nullable: true),
                    ThroughImageId = table.Column<long>(type: "bigint", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UseCount = table.Column<int>(type: "int", nullable: false),
                    LastUsedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DataExportLinks", x => x.Id);
                    table.CheckConstraint("CK_DataExportLinks_Expiry", "[ExpiresAtUtc] > [CreatedAtUtc]");
                    table.CheckConstraint("CK_DataExportLinks_ImageRange", "([Part] = 1 AND [ImagePartNumber] IS NULL AND [FromImageId] IS NULL AND [ThroughImageId] IS NULL) OR ([Part] = 2 AND [ImagePartNumber] >= 1 AND [FromImageId] IS NOT NULL AND [ThroughImageId] >= [FromImageId])");
                    table.CheckConstraint("CK_DataExportLinks_Part_Valid", "[Part] IN (1, 2)");
                    table.CheckConstraint("CK_DataExportLinks_UseCount", "[UseCount] >= 0");
                    table.ForeignKey(
                        name: "FK_DataExportLinks_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DataExportLinks_User_CreatedAtUtc",
                schema: "users",
                table: "DataExportLinks",
                columns: new[] { "UserId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "UX_DataExportLinks_TokenHash",
                schema: "users",
                table: "DataExportLinks",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DataExportLinks",
                schema: "users");
        }
    }
}
