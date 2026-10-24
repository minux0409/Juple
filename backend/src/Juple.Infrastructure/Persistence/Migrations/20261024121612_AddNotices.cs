using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNotices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "notices");

            migrationBuilder.CreateTable(
                name: "Notices",
                schema: "notices",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Status = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    IsImportant = table.Column<bool>(type: "bit", nullable: false),
                    IsPinned = table.Column<bool>(type: "bit", nullable: false),
                    Platforms = table.Column<int>(type: "int", nullable: false),
                    StartsAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    EndsAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    OfficialUrl = table.Column<string>(type: "nvarchar(2048)", maxLength: 2048, nullable: true),
                    ReadVersion = table.Column<int>(type: "int", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DeletedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notices", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "NoticeReads",
                schema: "notices",
                columns: table => new
                {
                    NoticeId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    ReadVersion = table.Column<int>(type: "int", nullable: false),
                    ReadAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoticeReads", x => new { x.UserId, x.NoticeId });
                    table.ForeignKey(
                        name: "FK_NoticeReads_Notices_NoticeId",
                        column: x => x.NoticeId,
                        principalSchema: "notices",
                        principalTable: "Notices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NoticeReads_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "NoticeTranslations",
                schema: "notices",
                columns: table => new
                {
                    NoticeId = table.Column<long>(type: "bigint", nullable: false),
                    Language = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    Title = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Body = table.Column<string>(type: "nvarchar(max)", maxLength: 20000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoticeTranslations", x => new { x.NoticeId, x.Language });
                    table.ForeignKey(
                        name: "FK_NoticeTranslations_Notices_NoticeId",
                        column: x => x.NoticeId,
                        principalSchema: "notices",
                        principalTable: "Notices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NoticeReads_NoticeId",
                schema: "notices",
                table: "NoticeReads",
                column: "NoticeId");

            migrationBuilder.CreateIndex(
                name: "IX_Notices_IsPinned_StartsAtUtc_Id",
                schema: "notices",
                table: "Notices",
                columns: new[] { "IsPinned", "StartsAtUtc", "Id" },
                filter: "[DeletedAtUtc] IS NULL AND [Status] = 'Published'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoticeReads",
                schema: "notices");

            migrationBuilder.DropTable(
                name: "NoticeTranslations",
                schema: "notices");

            migrationBuilder.DropTable(
                name: "Notices",
                schema: "notices");
        }
    }
}
