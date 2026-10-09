using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionJoinRequestsAndShareJoinMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents");

            migrationBuilder.AddColumn<string>(
                name: "JoinMode",
                schema: "collections",
                table: "CollectionShares",
                type: "varchar(20)",
                nullable: false,
                defaultValue: "None");

            migrationBuilder.CreateTable(
                name: "CollectionJoinRequests",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CollectionId = table.Column<long>(type: "bigint", nullable: false),
                    RequesterUserId = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "varchar(10)", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ResolvedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ResolvedByUserId = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionJoinRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionJoinRequests_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalSchema: "collections",
                        principalTable: "Collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionJoinRequests_Users_RequesterUserId",
                        column: x => x.RequesterUserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Id" },
                filter: "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Type", "CollectionId" },
                filter: "[ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)")
                .Annotation("SqlServer:Include", new[] { "ReadAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents",
                sql: "[Type] IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionJoinRequests_CollectionId_Id_Pending",
                schema: "collections",
                table: "CollectionJoinRequests",
                columns: new[] { "CollectionId", "Id" },
                filter: "[Status] = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionJoinRequests_RequesterUserId",
                schema: "collections",
                table: "CollectionJoinRequests",
                column: "RequesterUserId");

            migrationBuilder.CreateIndex(
                name: "UX_CollectionJoinRequests_CollectionId_RequesterUserId_Pending",
                schema: "collections",
                table: "CollectionJoinRequests",
                columns: new[] { "CollectionId", "RequesterUserId" },
                unique: true,
                filter: "[Status] = 'Pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollectionJoinRequests",
                schema: "collections");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents");

            migrationBuilder.DropColumn(
                name: "JoinMode",
                schema: "collections",
                table: "CollectionShares");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Id" },
                filter: "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Type", "CollectionId" },
                filter: "[ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)")
                .Annotation("SqlServer:Include", new[] { "ReadAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents",
                sql: "[Type] IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)");
        }
    }
}
