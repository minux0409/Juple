using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// EXPAND step of the join-model correction (public/private link). Purely additive: CollectionShares.JoinMode (added by
    /// AddCollectionJoinRequestsAndShareJoinMode, already on DEV) is deliberately KEPT, so the previous API/worker revision keeps working
    /// against this schema while the new revision (which maps IsPublic and ignores JoinMode) rolls out. JoinMode is dropped by the later
    /// CONTRACT migration DropCollectionShareJoinMode - never before every old runtime is gone.
    /// </summary>
    public partial class AddCollectionShareIsPublic : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Every link existing now is public (IsPublic defaults to true, which is also what an older revision's INSERT, that omits the
            // column, gets). A join request made under the abandoned join-mode idea cannot be trusted under the public/private model:
            // mark it Obsolete once (administrative - no notification of any kind is produced, memberships already created stay).
            migrationBuilder.AddColumn<bool>(
                name: "IsPublic",
                schema: "collections",
                table: "CollectionShares",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.Sql(
                "UPDATE [collections].[CollectionJoinRequests] SET [Status] = 'Obsolete', [ResolvedAtUtc] = SYSDATETIMEOFFSET() WHERE [Status] = 'Pending';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsPublic",
                schema: "collections",
                table: "CollectionShares");
        }
    }
}