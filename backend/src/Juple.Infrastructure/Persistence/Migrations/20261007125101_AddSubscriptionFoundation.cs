using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSubscriptionFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "billing");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "TrialEndsAtUtc",
                schema: "users",
                table: "Users",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "TrialStartedAtUtc",
                schema: "users",
                table: "Users",
                type: "datetimeoffset",
                nullable: true);

            // CollectionItems.VisibleSinceUtc (when a membership became visible content of its Collection). The ORDER matters:
            //   1. add the column NULLABLE;
            //   2. backfill every existing row from its AddedAtUtc - the best historical approximation there is (never the
            //      time this migration runs, the current time or Item.CreatedAtUtc);
            //   3. make it NOT NULL;
            //   4. only then add the named rolling-compatibility default (see below).
            // The default must come last: added first, it would stamp every historic row with "now" and corrupt the freeze.
            //
            // The EF model deliberately has NO default for this column: current code assigns it explicitly from the
            // authoritative operation time (approval, move, copy ...), and nothing may come to rely on a database-generated value.
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "VisibleSinceUtc",
                schema: "collections",
                table: "CollectionItems",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.Sql("UPDATE [collections].[CollectionItems] SET [VisibleSinceUtc] = [AddedAtUtc] WHERE [VisibleSinceUtc] IS NULL;");

            migrationBuilder.AlterColumn<DateTimeOffset>(
                name: "VisibleSinceUtc",
                schema: "collections",
                table: "CollectionItems",
                type: "datetimeoffset",
                nullable: false,
                oldClrType: typeof(DateTimeOffset),
                oldType: "datetimeoffset",
                oldNullable: true);

            // TEMPORARY rolling-deployment compatibility, a deployment artifact only (not part of the EF model): while the
            // PREVIOUS API revision can still take traffic it does not know this column and its INSERTs omit it, which a bare
            // NOT NULL would reject. For exactly those inserts the row's visibility instant is its insert instant, in
            // explicit UTC. An explicit value (every current code path) is never overridden. A later contract migration
            // (RemoveVisibleSinceUtcRollingCompatDefault), created once no previous revision can exist, drops ONLY this
            // constraint; the column stays NOT NULL.
            migrationBuilder.Sql(
                "ALTER TABLE [collections].[CollectionItems] ADD CONSTRAINT [DF_CollectionItems_VisibleSinceUtc_RollingCompat] DEFAULT (TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00')) FOR [VisibleSinceUtc];");

            migrationBuilder.CreateTable(
                name: "TrialLedger",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    IdentityHash = table.Column<byte[]>(type: "binary(32)", nullable: false),
                    TrialStartedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    TrialEndsAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrialLedger", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "UX_TrialLedger_IdentityHash",
                schema: "billing",
                table: "TrialLedger",
                column: "IdentityHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TrialLedger",
                schema: "billing");

            migrationBuilder.DropColumn(
                name: "TrialEndsAtUtc",
                schema: "users",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TrialStartedAtUtc",
                schema: "users",
                table: "Users");

            // The named compatibility default first: a column cannot be dropped while a constraint depends on it.
            migrationBuilder.Sql(
                "IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE [name] = 'DF_CollectionItems_VisibleSinceUtc_RollingCompat' AND [parent_object_id] = OBJECT_ID('[collections].[CollectionItems]')) ALTER TABLE [collections].[CollectionItems] DROP CONSTRAINT [DF_CollectionItems_VisibleSinceUtc_RollingCompat];");

            migrationBuilder.DropColumn(
                name: "VisibleSinceUtc",
                schema: "collections",
                table: "CollectionItems");
        }
    }
}
