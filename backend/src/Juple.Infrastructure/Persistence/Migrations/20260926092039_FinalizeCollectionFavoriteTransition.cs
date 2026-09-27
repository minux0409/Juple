using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Juple.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// CONTRACT half of the favorites transition (expand: AddCollectionFavoritesAndUserDisplayName).
    /// Apply only once no previous API revision serves traffic anymore. Until then that revision
    /// could change Collections.IsFavorite without touching CollectionFavorites, so the Owners' rows
    /// there may have drifted (the legacy column was authoritative for Owners the whole time, and is
    /// what the current revision reads). This rebuilds exactly those Owner rows from the legacy
    /// column - no guessing: it is the one value both revisions always wrote. Contributors' rows are
    /// never touched. From here on the current revision keeps both in step (dual write), so
    /// CollectionFavorites is complete for everyone. No trigger exists to remove (see the expand
    /// migration for why none was used); the legacy column is kept for a later cleanup round.
    /// </summary>
    public partial class FinalizeCollectionFavoriteTransition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DELETE f
                FROM [collections].[CollectionFavorites] AS f
                INNER JOIN [collections].[Collections] AS c ON c.[Id] = f.[CollectionId]
                WHERE f.[UserId] = c.[UserId] AND c.[IsFavorite] = 0;

                INSERT INTO [collections].[CollectionFavorites] ([UserId], [CollectionId], [CreatedAtUtc])
                SELECT c.[UserId], c.[Id], TODATETIMEOFFSET(SYSUTCDATETIME(), '+00:00')
                FROM [collections].[Collections] AS c
                WHERE c.[IsFavorite] = 1
                    AND NOT EXISTS (
                        SELECT 1 FROM [collections].[CollectionFavorites] AS f
                        WHERE f.[UserId] = c.[UserId] AND f.[CollectionId] = c.[Id]);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Nothing to undo: no schema change, and the reconciliation only made the Owners' rows
            // agree with the legacy column, which stays authoritative for Owners either way.
        }
    }
}
