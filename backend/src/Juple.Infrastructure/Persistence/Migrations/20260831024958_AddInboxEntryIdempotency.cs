using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddInboxEntryIdempotency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ClientRequestId",
                schema: "inbox",
                table: "InboxEntries",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "UX_InboxEntries_UserId_ClientRequestId",
                schema: "inbox",
                table: "InboxEntries",
                columns: new[] { "UserId", "ClientRequestId" },
                unique: true,
                filter: "[ClientRequestId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_InboxEntries_UserId_ClientRequestId",
                schema: "inbox",
                table: "InboxEntries");

            migrationBuilder.DropColumn(
                name: "ClientRequestId",
                schema: "inbox",
                table: "InboxEntries");
        }
    }
}
