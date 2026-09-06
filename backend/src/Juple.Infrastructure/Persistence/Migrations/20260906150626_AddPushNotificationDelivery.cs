using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPushNotificationDelivery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "push");

            migrationBuilder.CreateTable(
                name: "PushDeviceRegistrations",
                schema: "push",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    Platform = table.Column<byte>(type: "tinyint", nullable: false),
                    InstallationId = table.Column<string>(type: "varchar(100)", unicode: false, nullable: false),
                    PushToken = table.Column<string>(type: "varchar(1024)", unicode: false, nullable: false),
                    Locale = table.Column<string>(type: "varchar(35)", unicode: false, nullable: false),
                    IsEnabled = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    LastSeenAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PushDeviceRegistrations", x => x.Id);
                    table.CheckConstraint("CK_PushDeviceRegistrations_Platform_Valid", "[Platform] IN (0, 1)");
                    table.ForeignKey(
                        name: "FK_PushDeviceRegistrations_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "NotificationDeliveries",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    NotificationId = table.Column<long>(type: "bigint", nullable: false),
                    PushDeviceRegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<byte>(type: "tinyint", nullable: false),
                    AttemptCount = table.Column<int>(type: "int", nullable: false),
                    AttemptedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProviderMessageId = table.Column<string>(type: "varchar(200)", unicode: false, nullable: true),
                    FailureCode = table.Column<string>(type: "varchar(100)", unicode: false, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationDeliveries", x => x.Id);
                    table.CheckConstraint("CK_NotificationDeliveries_Status_Valid", "[Status] IN (0, 1, 2)");
                    table.ForeignKey(
                        name: "FK_NotificationDeliveries_Notifications_NotificationId",
                        column: x => x.NotificationId,
                        principalSchema: "notifications",
                        principalTable: "Notifications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NotificationDeliveries_PushDeviceRegistrations_PushDeviceRegistrationId",
                        column: x => x.PushDeviceRegistrationId,
                        principalSchema: "push",
                        principalTable: "PushDeviceRegistrations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationDeliveries_PushDeviceRegistrationId",
                schema: "notifications",
                table: "NotificationDeliveries",
                column: "PushDeviceRegistrationId");

            migrationBuilder.CreateIndex(
                name: "UX_NotificationDeliveries_NotificationId_PushDeviceRegistrationId",
                schema: "notifications",
                table: "NotificationDeliveries",
                columns: new[] { "NotificationId", "PushDeviceRegistrationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PushDeviceRegistrations_UserId_IsEnabled",
                schema: "push",
                table: "PushDeviceRegistrations",
                columns: new[] { "UserId", "IsEnabled" });

            migrationBuilder.CreateIndex(
                name: "UX_PushDeviceRegistrations_Platform_InstallationId",
                schema: "push",
                table: "PushDeviceRegistrations",
                columns: new[] { "Platform", "InstallationId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NotificationDeliveries",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "PushDeviceRegistrations",
                schema: "push");
        }
    }
}
