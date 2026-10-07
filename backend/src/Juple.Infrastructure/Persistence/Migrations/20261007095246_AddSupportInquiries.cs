using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSupportInquiries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "support");

            migrationBuilder.CreateTable(
                name: "SupportInquiries",
                schema: "support",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<long>(type: "bigint", nullable: false),
                    ClientRequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Type = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Content = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Answer = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    AnsweredAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AppVersion = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    BuildNumber = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    Platform = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    OsVersion = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    DeviceModel = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    Locale = table.Column<string>(type: "nvarchar(35)", maxLength: 35, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupportInquiries", x => x.Id);
                    table.CheckConstraint("CK_SupportInquiries_Answer_Consistent", "([Status] = 'Pending' AND [Answer] IS NULL AND [AnsweredAtUtc] IS NULL) OR ([Status] = 'Answered' AND [Answer] IS NOT NULL AND [AnsweredAtUtc] IS NOT NULL)");
                    table.CheckConstraint("CK_SupportInquiries_Status_Valid", "[Status] IN ('Pending', 'Answered')");
                    table.CheckConstraint("CK_SupportInquiries_Type_Valid", "[Type] IN ('Account', 'Subscription', 'LinkSaving', 'CollectionSharing', 'Bug', 'FeatureRequest', 'Other')");
                    table.ForeignKey(
                        name: "FK_SupportInquiries_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "users",
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_SupportInquiries_UserId_Id",
                schema: "support",
                table: "SupportInquiries",
                columns: new[] { "UserId", "Id" });

            migrationBuilder.CreateIndex(
                name: "UX_SupportInquiries_UserId_ClientRequestId",
                schema: "support",
                table: "SupportInquiries",
                columns: new[] { "UserId", "ClientRequestId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SupportInquiries",
                schema: "support");
        }
    }
}
