using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCommentRepliesAndLikes : Migration
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

            migrationBuilder.AlterColumn<long>(
                name: "UserId",
                schema: "collections",
                table: "CollectionItemComments",
                type: "bigint",
                nullable: true,
                oldClrType: typeof(long),
                oldType: "bigint");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeletedAtUtc",
                schema: "collections",
                table: "CollectionItemComments",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ParentCommentId",
                schema: "collections",
                table: "CollectionItemComments",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ReplyToUserId",
                schema: "collections",
                table: "CollectionItemComments",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "RootCommentId",
                schema: "collections",
                table: "CollectionItemComments",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CollectionItemCommentLikes",
                schema: "collections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CommentId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionItemCommentLikes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CollectionItemCommentLikes_CollectionItemComments_CommentId",
                        column: x => x.CommentId,
                        principalSchema: "collections",
                        principalTable: "CollectionItemComments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CollectionItemCommentLikes_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

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

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItemComments_ParentCommentId",
                schema: "collections",
                table: "CollectionItemComments",
                column: "ParentCommentId",
                filter: "[ParentCommentId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItemComments_ReplyToUserId",
                schema: "collections",
                table: "CollectionItemComments",
                column: "ReplyToUserId",
                filter: "[ReplyToUserId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItemComments_RootCommentId_Id",
                schema: "collections",
                table: "CollectionItemComments",
                columns: new[] { "RootCommentId", "Id" },
                filter: "[RootCommentId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionItemCommentLikes_UserId",
                schema: "collections",
                table: "CollectionItemCommentLikes",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "UX_CollectionItemCommentLikes_CommentId_UserId",
                schema: "collections",
                table: "CollectionItemCommentLikes",
                columns: new[] { "CommentId", "UserId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_CollectionItemComments_CollectionItemComments_ParentCommentId",
                schema: "collections",
                table: "CollectionItemComments",
                column: "ParentCommentId",
                principalSchema: "collections",
                principalTable: "CollectionItemComments",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_CollectionItemComments_CollectionItemComments_RootCommentId",
                schema: "collections",
                table: "CollectionItemComments",
                column: "RootCommentId",
                principalSchema: "collections",
                principalTable: "CollectionItemComments",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_CollectionItemComments_Users_ReplyToUserId",
                schema: "collections",
                table: "CollectionItemComments",
                column: "ReplyToUserId",
                principalSchema: "users",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CollectionItemComments_CollectionItemComments_ParentCommentId",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropForeignKey(
                name: "FK_CollectionItemComments_CollectionItemComments_RootCommentId",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropForeignKey(
                name: "FK_CollectionItemComments_Users_ReplyToUserId",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropTable(
                name: "CollectionItemCommentLikes",
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

            migrationBuilder.DropIndex(
                name: "IX_CollectionItemComments_ParentCommentId",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropIndex(
                name: "IX_CollectionItemComments_ReplyToUserId",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropIndex(
                name: "IX_CollectionItemComments_RootCommentId_Id",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropColumn(
                name: "DeletedAtUtc",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropColumn(
                name: "ParentCommentId",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropColumn(
                name: "ReplyToUserId",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.DropColumn(
                name: "RootCommentId",
                schema: "collections",
                table: "CollectionItemComments");

            migrationBuilder.AlterColumn<long>(
                name: "UserId",
                schema: "collections",
                table: "CollectionItemComments",
                type: "bigint",
                nullable: false,
                defaultValue: 0L,
                oldClrType: typeof(long),
                oldType: "bigint",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Inbox",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Id" },
                filter: "[Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14)");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "UserId", "Type", "CollectionId" },
                filter: "[ReadAtUtc] IS NULL AND [Type] IN (1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14)")
                .Annotation("SqlServer:Include", new[] { "ReadAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Notifications_Type_Valid",
                schema: "notifications",
                table: "Notifications",
                sql: "[Type] IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationEvents_Type_Valid",
                schema: "notifications",
                table: "NotificationEvents",
                sql: "[Type] IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)");
        }
    }
}
