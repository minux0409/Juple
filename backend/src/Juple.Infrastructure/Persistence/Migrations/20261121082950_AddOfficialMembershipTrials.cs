using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOfficialMembershipTrials : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "MembershipTrialEndsAtUtc",
                schema: "users",
                table: "Users",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "MembershipTrialStartedAtUtc",
                schema: "users",
                table: "Users",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "MembershipTrialLedger",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    IdentityHash = table.Column<byte[]>(type: "binary(32)", nullable: false),
                    TrialStartedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    TrialEndsAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MembershipTrialLedger", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "UX_MembershipTrialLedger_IdentityHash",
                schema: "billing",
                table: "MembershipTrialLedger",
                column: "IdentityHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MembershipTrialLedger",
                schema: "billing");

            migrationBuilder.DropColumn(
                name: "MembershipTrialEndsAtUtc",
                schema: "users",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "MembershipTrialStartedAtUtc",
                schema: "users",
                table: "Users");
        }
    }
}
