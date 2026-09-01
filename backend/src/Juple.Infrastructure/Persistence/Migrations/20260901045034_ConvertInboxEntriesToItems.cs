using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ConvertInboxEntriesToItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Move and rename the existing table in place; this preserves all rows, their Ids,
            // and the identity seed. It is deliberately NOT a DropTable/CreateTable pair.
            migrationBuilder.EnsureSchema(
                name: "items");

            migrationBuilder.RenameTable(
                name: "InboxEntries",
                schema: "inbox",
                newName: "Items",
                newSchema: "items");

            // Rename constraint/index metadata to match the new table name. These are
            // metadata-only operations; no rows are touched.
            migrationBuilder.DropPrimaryKey(
                name: "PK_InboxEntries",
                schema: "items",
                table: "Items");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Items",
                schema: "items",
                table: "Items",
                column: "Id");

            migrationBuilder.DropCheckConstraint(
                name: "CK_InboxEntries_Url_MaxLength",
                schema: "items",
                table: "Items");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Items_Url_MaxLength",
                schema: "items",
                table: "Items",
                sql: "DATALENGTH([Url]) <= 8192");

            migrationBuilder.DropForeignKey(
                name: "FK_InboxEntries_Users_UserId",
                schema: "items",
                table: "Items");

            migrationBuilder.AddForeignKey(
                name: "FK_Items_Users_UserId",
                schema: "items",
                table: "Items",
                column: "UserId",
                principalSchema: "users",
                principalTable: "Users",
                principalColumn: "Id");

            migrationBuilder.RenameIndex(
                schema: "items",
                table: "Items",
                name: "IX_InboxEntries_UserId_SavedAtUtc_Id",
                newName: "IX_Items_UserId_SavedAtUtc_Id");

            migrationBuilder.RenameIndex(
                schema: "items",
                table: "Items",
                name: "UX_InboxEntries_UserId_ClientRequestId",
                newName: "UX_Items_UserId_ClientRequestId");

            // State: every existing row was, by definition, an inbox item (State=Inbox=0).
            migrationBuilder.AddColumn<byte>(
                name: "State",
                schema: "items",
                table: "Items",
                type: "tinyint",
                nullable: false,
                defaultValue: (byte)0);

            // StateChangedAtUtc: added nullable first, backfilled from SavedAtUtc for existing
            // rows (their state - Inbox - was set at save time), then tightened to NOT NULL.
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "StateChangedAtUtc",
                schema: "items",
                table: "Items",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.Sql(
                "UPDATE [items].[Items] SET [StateChangedAtUtc] = [SavedAtUtc] WHERE [StateChangedAtUtc] IS NULL;");

            migrationBuilder.AlterColumn<DateTimeOffset>(
                name: "StateChangedAtUtc",
                schema: "items",
                table: "Items",
                type: "datetimeoffset",
                nullable: false,
                oldClrType: typeof(DateTimeOffset),
                oldType: "datetimeoffset",
                oldNullable: true);

            // RowVersion: SQL Server generates an initial value for existing rows automatically.
            migrationBuilder.AddColumn<byte[]>(
                name: "RowVersion",
                schema: "items",
                table: "Items",
                type: "rowversion",
                rowVersion: true,
                nullable: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RowVersion",
                schema: "items",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "StateChangedAtUtc",
                schema: "items",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "State",
                schema: "items",
                table: "Items");

            migrationBuilder.RenameIndex(
                schema: "items",
                table: "Items",
                name: "UX_Items_UserId_ClientRequestId",
                newName: "UX_InboxEntries_UserId_ClientRequestId");

            migrationBuilder.RenameIndex(
                schema: "items",
                table: "Items",
                name: "IX_Items_UserId_SavedAtUtc_Id",
                newName: "IX_InboxEntries_UserId_SavedAtUtc_Id");

            migrationBuilder.DropForeignKey(
                name: "FK_Items_Users_UserId",
                schema: "items",
                table: "Items");

            migrationBuilder.AddForeignKey(
                name: "FK_InboxEntries_Users_UserId",
                schema: "items",
                table: "Items",
                column: "UserId",
                principalSchema: "users",
                principalTable: "Users",
                principalColumn: "Id");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Items_Url_MaxLength",
                schema: "items",
                table: "Items");

            migrationBuilder.AddCheckConstraint(
                name: "CK_InboxEntries_Url_MaxLength",
                schema: "items",
                table: "Items",
                sql: "DATALENGTH([Url]) <= 8192");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Items",
                schema: "items",
                table: "Items");

            migrationBuilder.AddPrimaryKey(
                name: "PK_InboxEntries",
                schema: "items",
                table: "Items",
                column: "Id");

            migrationBuilder.EnsureSchema(
                name: "inbox");

            migrationBuilder.RenameTable(
                name: "Items",
                schema: "items",
                newName: "InboxEntries",
                newSchema: "inbox");
        }
    }
}
