using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// CONTRACT step of the join-model correction. Removes only the obsolete CollectionShares.JoinMode column (and, with it, its
    /// 'None' default constraint - SQL Server's EF provider drops that constraint before the column). Nothing else changes.
    ///
    /// DO NOT APPLY until every runtime that maps JoinMode is gone: the new API revision is active and healthy, the previous API
    /// revision no longer receives traffic, the new notification worker is active and the old worker revision cannot process
    /// messages, and the push-dispatch Job template is the new image. The previous (JoinMode) revision against a database
    /// contracted by this migration would fail on every CollectionShares query, which is why that combination is forbidden.
    /// The model snapshot already omits JoinMode (the expand migration AddCollectionShareIsPublic carries the final model), so this
    /// migration has no model change of its own.
    /// </summary>
    public partial class DropCollectionShareJoinMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "JoinMode",
                schema: "collections",
                table: "CollectionShares");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "JoinMode",
                schema: "collections",
                table: "CollectionShares",
                type: "varchar(20)",
                nullable: false,
                defaultValue: "None");
        }
    }
}