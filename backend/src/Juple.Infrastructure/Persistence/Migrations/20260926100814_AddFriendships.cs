using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Friends (Round 3): users.Friendships (one canonical row per pair, pending or accepted) and
    /// users.FriendshipNotes (each user's private note about a friend). Purely additive - no
    /// backfill, no change to any existing table - so a previous API revision, which never touches
    /// these tables, keeps working unchanged during a rolling deployment.
    /// </summary>
    public partial class AddFriendships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Friendships",
                schema: "users",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserLowId = table.Column<long>(type: "bigint", nullable: false),
                    UserHighId = table.Column<long>(type: "bigint", nullable: false),
                    RequestedByUserId = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "varchar(20)", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    AcceptedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Friendships", x => x.Id);
                    table.CheckConstraint("CK_Friendships_CanonicalPair", "[UserLowId] < [UserHighId]");
                    table.ForeignKey(
                        name: "FK_Friendships_Users_RequestedByUserId",
                        column: x => x.RequestedByUserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Friendships_Users_UserHighId",
                        column: x => x.UserHighId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Friendships_Users_UserLowId",
                        column: x => x.UserLowId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "FriendshipNotes",
                schema: "users",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    FriendshipId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    Note = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FriendshipNotes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FriendshipNotes_Friendships_FriendshipId",
                        column: x => x.FriendshipId,
                        principalSchema: "users",
                        principalTable: "Friendships",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_FriendshipNotes_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_FriendshipNotes_UserId",
                schema: "users",
                table: "FriendshipNotes",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "UX_FriendshipNotes_FriendshipId_UserId",
                schema: "users",
                table: "FriendshipNotes",
                columns: new[] { "FriendshipId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Friendships_RequestedByUserId",
                schema: "users",
                table: "Friendships",
                column: "RequestedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Friendships_UserHighId",
                schema: "users",
                table: "Friendships",
                column: "UserHighId");

            migrationBuilder.CreateIndex(
                name: "UX_Friendships_UserLowId_UserHighId",
                schema: "users",
                table: "Friendships",
                columns: new[] { "UserLowId", "UserHighId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FriendshipNotes",
                schema: "users");

            migrationBuilder.DropTable(
                name: "Friendships",
                schema: "users");
        }
    }
}
