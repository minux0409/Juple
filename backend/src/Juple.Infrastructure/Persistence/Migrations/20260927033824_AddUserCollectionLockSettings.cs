using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserCollectionLockSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserCollectionLockSettings",
                schema: "collections",
                columns: table => new
                {
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    PasswordHash = table.Column<string>(type: "varchar(200)", unicode: false, maxLength: 200, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    PasswordChangedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    FailedChangeAttemptCount = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    FailedChangeWindowStartedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserCollectionLockSettings", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_UserCollectionLockSettings_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserCollectionLockSettings",
                schema: "collections");
        }
    }
}
