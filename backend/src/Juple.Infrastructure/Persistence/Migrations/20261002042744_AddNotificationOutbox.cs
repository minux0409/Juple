using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NotificationEvents",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Type = table.Column<byte>(type: "tinyint", nullable: false),
                    ActorUserId = table.Column<long>(type: "bigint", nullable: true),
                    RecipientUserId = table.Column<long>(type: "bigint", nullable: true),
                    CollectionId = table.Column<long>(type: "bigint", nullable: true),
                    SubjectId = table.Column<long>(type: "bigint", nullable: true),
                    ItemCount = table.Column<int>(type: "int", nullable: true),
                    HideActor = table.Column<bool>(type: "bit", nullable: false),
                    SkipUserId = table.Column<long>(type: "bigint", nullable: true),
                    DedupKey = table.Column<string>(type: "varchar(120)", unicode: false, maxLength: 120, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Status = table.Column<byte>(type: "tinyint", nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    LeaseUntilUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    LastAttemptAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AttemptCount = table.Column<int>(type: "int", nullable: false),
                    RequiresAttention = table.Column<bool>(type: "bit", nullable: false),
                    RecipientCursor = table.Column<long>(type: "bigint", nullable: true),
                    LastErrorCode = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationEvents", x => x.Id);
                    table.CheckConstraint("CK_NotificationEvents_Status_Valid", "[Status] IN (0, 1, 2)");
                    table.CheckConstraint("CK_NotificationEvents_Type_Valid", "[Type] IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)");
                });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationEvents_CompletedAtUtc",
                schema: "notifications",
                table: "NotificationEvents",
                column: "CompletedAtUtc",
                filter: "[CompletedAtUtc] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationEvents_FailedPermanent",
                schema: "notifications",
                table: "NotificationEvents",
                column: "CompletedAtUtc",
                filter: "[Status] = 2");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationEvents_Pending",
                schema: "notifications",
                table: "NotificationEvents",
                columns: new[] { "CreatedAtUtc", "Id" },
                filter: "[Status] = 0")
                .Annotation("SqlServer:Include", new[] { "NextAttemptAtUtc", "LeaseUntilUtc" });

            migrationBuilder.CreateIndex(
                name: "UX_NotificationEvents_DedupKey",
                schema: "notifications",
                table: "NotificationEvents",
                column: "DedupKey",
                unique: true,
                filter: "[DedupKey] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NotificationEvents",
                schema: "notifications");
        }
    }
}
