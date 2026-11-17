using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminMembershipGrants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MembershipGrants",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    GrantedByUserId = table.Column<long>(type: "bigint", nullable: false),
                    GrantedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    StartsAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    EndsAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Reason = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: false),
                    RevokedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RevokedByUserId = table.Column<long>(type: "bigint", nullable: true),
                    RevokeReason = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MembershipGrants", x => x.Id);
                    table.CheckConstraint("CK_MembershipGrants_Revocation", "([RevokedAtUtc] IS NULL AND [RevokedByUserId] IS NULL AND [RevokeReason] IS NULL) OR ([RevokedAtUtc] IS NOT NULL AND [RevokedByUserId] IS NOT NULL AND [RevokeReason] IS NOT NULL)");
                    table.CheckConstraint("CK_MembershipGrants_Window", "([Kind] = 'Preview' AND [EndsAtUtc] IS NULL) OR ([Kind] = 'Complimentary' AND [EndsAtUtc] > [StartsAtUtc] AND [EndsAtUtc] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_MembershipGrants_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MembershipGrants_UserId_Kind_StartsAtUtc",
                schema: "billing",
                table: "MembershipGrants",
                columns: new[] { "UserId", "Kind", "StartsAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MembershipGrants",
                schema: "billing");
        }
    }
}
