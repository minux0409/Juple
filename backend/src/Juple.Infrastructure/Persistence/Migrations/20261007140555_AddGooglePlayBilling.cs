using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGooglePlayBilling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GoogleAccountLinks",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    AccountKey = table.Column<string>(type: "varchar(64)", unicode: false, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleAccountLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GoogleAccountLinks_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "StoreEvents",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Source = table.Column<string>(type: "varchar(32)", nullable: false),
                    ExternalEventId = table.Column<string>(type: "varchar(200)", nullable: false),
                    EventType = table.Column<string>(type: "varchar(64)", nullable: false),
                    TokenHash = table.Column<byte[]>(type: "binary(32)", nullable: true),
                    EncryptedToken = table.Column<byte[]>(type: "varbinary(2048)", nullable: true),
                    ReceivedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DispatchedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ProcessedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AttemptCount = table.Column<int>(type: "int", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Result = table.Column<string>(type: "varchar(32)", nullable: false),
                    LastErrorCode = table.Column<string>(type: "varchar(64)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StorePurchases",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: true),
                    Source = table.Column<string>(type: "varchar(32)", nullable: false),
                    ProductId = table.Column<string>(type: "varchar(200)", nullable: false),
                    BasePlanId = table.Column<string>(type: "varchar(200)", nullable: true),
                    ExternalKeyHash = table.Column<byte[]>(type: "binary(32)", nullable: false),
                    VerificationHandleEncrypted = table.Column<byte[]>(type: "varbinary(2048)", nullable: false),
                    State = table.Column<string>(type: "varchar(32)", nullable: false),
                    Reason = table.Column<string>(type: "varchar(32)", nullable: false),
                    CurrentPeriodStartUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AccessEndsAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AutoRenews = table.Column<bool>(type: "bit", nullable: true),
                    AcknowledgementPending = table.Column<bool>(type: "bit", nullable: false),
                    AcknowledgedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    LatestVerifiedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    NextReconcileAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    FirstLinkedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DetachedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StorePurchases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StorePurchases_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "UX_GoogleAccountLinks_AccountKey",
                schema: "billing",
                table: "GoogleAccountLinks",
                column: "AccountKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_GoogleAccountLinks_UserId",
                schema: "billing",
                table: "GoogleAccountLinks",
                column: "UserId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoreEvents_Unprocessed_NextAttemptAtUtc",
                schema: "billing",
                table: "StoreEvents",
                column: "NextAttemptAtUtc",
                filter: "[ProcessedAtUtc] IS NULL");

            migrationBuilder.CreateIndex(
                name: "UX_StoreEvents_Source_ExternalEventId",
                schema: "billing",
                table: "StoreEvents",
                columns: new[] { "Source", "ExternalEventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StorePurchases_NextReconcileAtUtc",
                schema: "billing",
                table: "StorePurchases",
                column: "NextReconcileAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_StorePurchases_UserId",
                schema: "billing",
                table: "StorePurchases",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "UX_StorePurchases_Source_ExternalKeyHash",
                schema: "billing",
                table: "StorePurchases",
                columns: new[] { "Source", "ExternalKeyHash" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GoogleAccountLinks",
                schema: "billing");

            migrationBuilder.DropTable(
                name: "StoreEvents",
                schema: "billing");

            migrationBuilder.DropTable(
                name: "StorePurchases",
                schema: "billing");
        }
    }
}
