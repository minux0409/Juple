using Juple.Application.Collections;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.MergeCollections;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.SetCollectionIconImage;
using Juple.Application.Collections.TransferCollectionItem;
using Juple.Application.Images;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Items;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionStore(
    JupleDbContext dbContext,
    ICollectionIconImageStorage? iconImageStorage = null,
    IUserProfileImageStorage? profileImageStorage = null) : ICollectionContributedLinkStore, ICollectionStore, ICollectionItemStore, ICollectionManagementStore, IPublicCollectionWriteStore
{
    /// <summary>
    /// Spacing between adjacent CollectionItem.SortOrder values - wide enough that a manual move or
    /// a new prepend almost always just writes the moved/added row's own midpoint value (see
    /// MoveItemAsync/AddAsync), never renumbering the whole Collection. Matches the migration's own
    /// backfill spacing (see AddCollectionItemSortOrder).
    /// </summary>
    private const int SortOrderGap = 4096;


    public Task<CollectionPage> ListAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        bool? isFavorite,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var query = AccessibleCollections(userId, CollectionListScope.Owned);

        // Owned rows only here, so the caller is the Owner: their mark is Collection.IsFavorite
        // (authoritative for Owners during the favorites transition - see IsOwnerFavorite).
        if (isFavorite is { } requestedIsFavorite)
        {
            query = query.Where(collection => collection.IsFavorite == requestedIsFavorite);
        }

        return ListPageAsync(userId, query, itemId, excludeItemId, cursor, limit, cancellationToken);
    }

    /// <summary>"공유 컬렉션": shared with the caller, or the caller's own currently-shared ones (see AccessibleCollections).</summary>
    public Task<CollectionPage> ListSharedAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        ListPageAsync(
            userId, AccessibleCollections(userId, CollectionListScope.Shared), itemId, excludeItemId, cursor, limit, cancellationToken);

    public Task<CollectionPage> ListByScopeAsync(
        long userId,
        CollectionListScope scope,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        ListPageAsync(userId, AccessibleCollections(userId, scope), itemId, excludeItemId, cursor, limit, cancellationToken);

    /// <summary>
    /// The caller's active Collections in a scope: owned ones, ones shared with them (as a
    /// Contributor or Viewer) - UNION ALL of both for All/Favorites; an Owner is never a member of
    /// their own Collection, so no row can appear twice - optionally narrowed to their own favorite
    /// marks. Shared ("공유 컬렉션") is every Collection the caller takes part in with someone else:
    /// the ones shared with them plus their own ones that are currently shared - with at least one
    /// member, or with an active 모든 사용자 link. A pending invitation alone shares nothing yet.
    /// The same owned Collection therefore also stays under Owned; each scope is its own list, so
    /// within one scope it is still listed once. Each half is index-backed (Collections by UserId;
    /// CollectionCollaborators by UserId / CollectionId; CollectionShares by CollectionId).
    /// </summary>
    private IQueryable<Collection> AccessibleCollections(long userId, CollectionListScope scope)
    {
        var owned = dbContext.Collections
            .AsNoTracking()
            .Where(collection => collection.UserId == userId && collection.DeletedAtUtc == null);
        var sharedWithMe =
            from collaborator in dbContext.CollectionCollaborators.AsNoTracking()
            where collaborator.UserId == userId
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null)
                on collaborator.CollectionId equals collection.Id
            select collection;

        var query = scope switch
        {
            CollectionListScope.Owned => owned,
            CollectionListScope.Shared => owned
                .Where(collection =>
                    dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collection.Id)
                    || dbContext.CollectionShares.Any(share => share.CollectionId == collection.Id && share.IsActive))
                .Concat(sharedWithMe),
            _ => owned.Concat(sharedWithMe),
        };

        if (scope == CollectionListScope.Favorites)
        {
            query = query.Where(collection =>
                collection.UserId == userId
                    ? collection.IsFavorite
                    : dbContext.CollectionFavorites.Any(
                        favorite => favorite.UserId == userId && favorite.CollectionId == collection.Id));
        }

        return query;
    }

    private async Task<CollectionPage> ListPageAsync(
        long userId,
        IQueryable<Collection> query,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken)
    {
        // A filter on the caller's accessible Collections, not a lookup of the Item itself - a
        // missing/other-user's itemId simply matches no Collections rather than throwing (mirrors
        // GetPurchases' itemId query param).
        if (itemId is { } requestedItemId)
        {
            query = query.Where(collection =>
                dbContext.CollectionItems.Any(
                    membership => membership.CollectionId == collection.Id && membership.ItemId == requestedItemId));
        }

        // The opposite of itemId - a single NOT EXISTS predicate (translated by EF from !Any),
        // not a per-row extra query, so a Collection the Item already belongs to can never
        // resurface as an "add to collection" candidate on any page (unlike filtering client-side
        // against a separately-paginated membership list, which can miss later pages).
        if (excludeItemId is { } excludedItemId)
        {
            query = query.Where(collection =>
                !dbContext.CollectionItems.Any(
                    membership => membership.CollectionId == collection.Id && membership.ItemId == excludedItemId));
        }

        if (cursor is not null)
        {
            query = query.Where(collection =>
                collection.CreatedAtUtc < cursor.CreatedAtUtc
                || (collection.CreatedAtUtc == cursor.CreatedAtUtc && collection.Id < cursor.Id));
        }

        var rows = await ProjectRows(userId, query
                .OrderByDescending(collection => collection.CreatedAtUtc)
                .ThenByDescending(collection => collection.Id))
            .Take(limit + 1)
            .ToListAsync(cancellationToken);

        var hasMore = rows.Count > limit;
        var pageItems = await ToDtosAsync(userId, hasMore ? rows.GetRange(0, limit) : rows, cancellationToken);
        var nextCursor = hasMore
            ? new CollectionPageCursor(pageItems[^1].CreatedAtUtc, pageItems[^1].Id)
            : null;

        return new CollectionPage(pageItems, nextCursor);
    }

    /// <summary>
    /// One SQL statement for the whole page: per-row correlated subqueries (index-backed EXISTS /
    /// COUNT, evaluated by SQL Server in the same round trip - not an N+1). Projects Icon as its raw
    /// (converter-mapped) enum, not .ToString() - EF cannot translate an arbitrary CLR ToString()
    /// inside a SQL projection; the DTO's plain-string Icon is built afterward, in memory.
    /// </summary>
    private IQueryable<CollectionRow> ProjectRows(long userId, IQueryable<Collection> query) =>
        query.Select(collection => new CollectionRow
        {
            Id = collection.Id,
            OwnerUserId = collection.UserId,
            Name = collection.Name,
            // Excludes memberships whose Item is in the trash - matches GetItemsAsync's own join
            // filter, so the displayed count never disagrees with the list it describes.
            ItemCount = dbContext.CollectionItems
                .Where(membership => membership.CollectionId == collection.Id)
                .Count(membership => dbContext.Items.Any(
                    item => item.Id == membership.ItemId && item.DeletedAtUtc == null)),
            CreatedAtUtc = collection.CreatedAtUtc,
            UpdatedAtUtc = collection.UpdatedAtUtc,
            Icon = collection.Icon,
            Color = collection.Color,
            IsLocked = collection.IsLocked,
            SharePasswordMode = dbContext.CollectionSharePasswords
                .Where(sharePassword => sharePassword.CollectionId == collection.Id)
                .Select(sharePassword => (CollectionSharePasswordMode?)sharePassword.Mode)
                .FirstOrDefault(),
            // The caller's own mark: an Owner's is the legacy column (see SetFavoriteAsync), a
            // Contributor's is their CollectionFavorites row.
            IsFavorite = collection.UserId == userId
                ? collection.IsFavorite
                : dbContext.CollectionFavorites.Any(
                    favorite => favorite.UserId == userId && favorite.CollectionId == collection.Id),
            HasCollaborators = dbContext.CollectionCollaborators.Any(
                collaborator => collaborator.CollectionId == collection.Id),
            IsPublicShareActive = dbContext.CollectionShares.Any(
                share => share.CollectionId == collection.Id && share.IsActive),
            // The Owner's 승인 대기 count only (indexed by CollectionId) - never counted for anyone else.
            PendingSubmissionCount = collection.UserId == userId
                ? dbContext.CollectionLinkSubmissions.Count(submission => submission.CollectionId == collection.Id)
                : 0,
            IconImageBlobName = collection.IconImageBlobName,
            // The caller's own membership role when the Collection is shared with them (null for
            // their own Collections).
            CallerRole = dbContext.CollectionCollaborators
                .Where(collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId)
                .Select(collaborator => (CollectionCollaboratorRole?)collaborator.Role)
                .FirstOrDefault(),
        });

    /// <summary>
    /// Builds the caller's view of already-loaded rows with at most two more queries for the whole
    /// set (never one per Collection): the Owners' public identity (Juple ID + display name) and
    /// the Contributors of the collaborative ones. Only public identity leaves this method - the
    /// internal user ids are used for grouping and "is this the caller" only.
    /// </summary>
    private async Task<List<CollectionDto>> ToDtosAsync(
        long userId,
        IReadOnlyList<CollectionRow> rows,
        CancellationToken cancellationToken)
    {
        var collaborativeIds = rows.Where(row => row.HasCollaborators).Select(row => row.Id).ToList();
        var ownerIds = rows
            .Where(row => row.OwnerUserId != userId || row.HasCollaborators)
            .Select(row => row.OwnerUserId)
            .Distinct()
            .ToList();

        var people = ownerIds.Count == 0
            ? []
            : await dbContext.Users
                .AsNoTracking()
                .Where(user => ownerIds.Contains(user.Id))
                .Select(user => new PersonRow(user.Id, user.PublicCode, user.DisplayName))
                .ToListAsync(cancellationToken);
        var peopleById = people.ToDictionary(person => person.UserId);

        var contributorsByCollection = collaborativeIds.Count == 0
            ? new Dictionary<long, List<PersonRow>>()
            : (await (
                    from collaborator in dbContext.CollectionCollaborators.AsNoTracking()
                    where collaborativeIds.Contains(collaborator.CollectionId)
                    join user in dbContext.Users.AsNoTracking() on collaborator.UserId equals user.Id
                    orderby collaborator.CreatedAtUtc, collaborator.Id
                    select new { collaborator.CollectionId, Person = new PersonRow(user.Id, user.PublicCode, user.DisplayName, collaborator.Role) })
                .ToListAsync(cancellationToken))
                .GroupBy(entry => entry.CollectionId)
                .ToDictionary(group => group.Key, group => group.Select(entry => entry.Person).ToList());

        // Icon photos are signed for the Owner's own prefix - access to the row itself (checked by
        // the query that produced it) is what allows seeing its icon. One local SAS per photo.
        var iconImageUrls = new Dictionary<long, string>();
        if (iconImageStorage is not null)
        {
            foreach (var row in rows.Where(row => row.IconImageBlobName is not null))
            {
                var url = await iconImageStorage.CreateCollectionIconReadUrlAsync(row.OwnerUserId, row.IconImageBlobName!, cancellationToken);
                if (url is not null)
                {
                    iconImageUrls[row.Id] = url.ToString();
                }
            }
        }

        return rows.Select(row =>
        {
            var isOwner = row.OwnerUserId == userId;
            peopleById.TryGetValue(row.OwnerUserId, out var owner);

            IReadOnlyList<CollectionParticipantDto>? preview = null;
            var otherParticipantCount = 0;
            if (row.HasCollaborators)
            {
                var others = new List<CollectionParticipantDto>();
                if (!isOwner && owner is not null)
                {
                    others.Add(new CollectionParticipantDto(owner.PublicCode, owner.DisplayName, CollectionDtoAccessRoles.Owner));
                }

                if (contributorsByCollection.TryGetValue(row.Id, out var contributors))
                {
                    others.AddRange(contributors
                        .Where(person => person.UserId != userId)
                        .Select(person => new CollectionParticipantDto(
                            person.PublicCode, person.DisplayName, CollectionDtoAccessRoles.ForCollaborator(person.Role ?? CollectionCollaboratorRole.Contributor))));
                }

                otherParticipantCount = others.Count;
                preview = others.Take(CollectionParticipantSummary.PreviewSize).ToList();
            }

            return new CollectionDto(
                row.Id, row.Name, row.IsFavorite, row.ItemCount, row.CreatedAtUtc, row.UpdatedAtUtc,
                row.Icon.ToString(), row.Color,
                AccessRole: isOwner
                    ? CollectionDtoAccessRoles.Owner
                    : CollectionDtoAccessRoles.ForCollaborator(row.CallerRole ?? CollectionCollaboratorRole.Contributor),
                // The lock is the Owner's own gate; a recipient is only ever asked for it on a legacy
                // Collection (see CollectionSharePasswordMode) - otherwise their gate is the share password.
                IsLocked: isOwner ? row.IsLocked : row.IsLocked && row.SharePasswordMode == CollectionSharePasswordMode.LegacyCommonLock,
                HasCollaborators: isOwner && row.HasCollaborators,
                OwnerJupleId: isOwner ? null : owner?.PublicCode,
                OwnerDisplayName: isOwner ? null : owner?.DisplayName,
                ParticipantPreview: preview,
                OtherParticipantCount: otherParticipantCount,
                IsPublicShareActive: isOwner && row.IsPublicShareActive,
                IconImageUrl: iconImageUrls.GetValueOrDefault(row.Id),
                IconImageVersion: iconImageUrls.ContainsKey(row.Id) ? CollectionIconImageVersion.From(row.IconImageBlobName!) : null,
                IsSharePasswordProtected: row.SharePasswordMode == CollectionSharePasswordMode.PerCollection,
                PendingSubmissionCount: isOwner ? row.PendingSubmissionCount : 0);
        }).ToList();
    }

    private sealed class CollectionRow
    {
        public long Id { get; init; }

        public long OwnerUserId { get; init; }

        public string Name { get; init; } = null!;

        public int ItemCount { get; init; }

        public DateTimeOffset CreatedAtUtc { get; init; }

        public DateTimeOffset UpdatedAtUtc { get; init; }

        public CollectionIcon Icon { get; init; }

        public string? Color { get; init; }

        public bool IsLocked { get; init; }

        public CollectionSharePasswordMode? SharePasswordMode { get; init; }

        public bool IsFavorite { get; init; }

        public bool HasCollaborators { get; init; }

        public bool IsPublicShareActive { get; init; }

        public int PendingSubmissionCount { get; init; }

        public string? IconImageBlobName { get; init; }

        public CollectionCollaboratorRole? CallerRole { get; init; }
    }

    private sealed record PersonRow(long UserId, string PublicCode, string? DisplayName, CollectionCollaboratorRole? Role = null);

    public async Task<CollectionDto> CreateAsync(
        long userId,
        string name,
        string nameNormalized,
        CollectionIcon icon,
        DateTimeOffset createdAtUtc,
        string? color = null,
        CancellationToken cancellationToken = default)
    {
        var collection = new Collection(userId, name, nameNormalized, icon, createdAtUtc, color);
        dbContext.Collections.Add(collection);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            throw new CollectionNameConflictException();
        }

        // A brand-new Collection is nobody's favorite yet.
        return new CollectionDto(
            collection.Id, collection.Name, IsFavorite: false, 0, collection.CreatedAtUtc,
            collection.UpdatedAtUtc, collection.Icon.ToString(), collection.Color);
    }

    public async Task<CollectionDto> GetAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        // Owner, or a Contributor of this exact Collection - anyone else gets the same 404 as a
        // non-existent id.
        var row = await ProjectRows(
                userId,
                AccessibleCollections(userId, CollectionListScope.All).Where(collection => collection.Id == collectionId))
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new CollectionNotFoundException();

        return (await ToDtosAsync(userId, [row], cancellationToken))[0];
    }

    public async Task RenameAsync(
        long userId,
        long collectionId,
        string name,
        string nameNormalized,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.Rename(name, nameNormalized, updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            throw new CollectionNameConflictException();
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }
    }

    public async Task<CollectionDto> SetFavoriteAsync(
        long userId,
        long collectionId,
        bool isFavorite,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        // Fails closed on its own too (like every other store method): no mark on a Collection the
        // caller cannot access, whatever the caller above checked.
        var ownerUserId = await AccessibleCollections(userId, CollectionListScope.All)
                .Where(collection => collection.Id == collectionId)
                .Select(collection => (long?)collection.UserId)
                .FirstOrDefaultAsync(cancellationToken)
            ?? throw new CollectionNotFoundException();

        // Favorites transition (AddCollectionFavoritesAndUserDisplayName → FinalizeCollectionFavoriteTransition):
        // a previous API revision still reads and writes only Collections.IsFavorite, so for an
        // OWNER that column stays authoritative and this writes both it and the CollectionFavorites
        // row, atomically - neither revision can ever miss the other's change. A Contributor's mark
        // exists only in CollectionFavorites. The legacy column is set with a set-based UPDATE of
        // that one column only: UpdatedAtUtc is untouched (a personal mark, not an edit).
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        if (isFavorite)
        {
            try
            {
                await dbContext.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    INSERT INTO [collections].[CollectionFavorites] ([UserId], [CollectionId], [CreatedAtUtc])
                    SELECT {userId}, {collectionId}, {updatedAtUtc}
                    WHERE NOT EXISTS (
                        SELECT 1 FROM [collections].[CollectionFavorites] WITH (UPDLOCK, HOLDLOCK)
                        WHERE [UserId] = {userId} AND [CollectionId] = {collectionId})
                    """,
                    cancellationToken);
            }
            catch (SqlException exception) when (exception.Number is 2601 or 2627)
            {
                // A concurrent identical request inserted it first - the desired state holds.
            }
        }
        else
        {
            await dbContext.CollectionFavorites
                .Where(favorite => favorite.UserId == userId && favorite.CollectionId == collectionId)
                .ExecuteDeleteAsync(cancellationToken);
        }

        if (ownerUserId == userId)
        {
            await dbContext.Collections
                .Where(collection => collection.Id == collectionId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(collection => collection.IsFavorite, isFavorite), cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        // The set-based UPDATE bypasses the change tracker (and bumps the row's RowVersion) - a copy
        // this context already tracks would otherwise make a later save here a false concurrency
        // conflict, so refresh it.
        var trackedCollection = dbContext.ChangeTracker.Entries<Collection>()
            .FirstOrDefault(entry => entry.Entity.Id == collectionId);
        if (trackedCollection is not null)
        {
            await trackedCollection.ReloadAsync(cancellationToken);
        }

        return await GetAsync(userId, collectionId, cancellationToken);
    }

    public async Task<CollectionDto> SetIconAsync(
        long userId,
        long collectionId,
        CollectionIcon icon,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.SetIcon(icon, updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        // The caller's full view (own favorite mark, participants) - same shape as GetAsync.
        return await GetAsync(userId, collectionId, cancellationToken);
    }

    public async Task<(CollectionDto Collection, string? ReplacedBlobName)> SetIconImageAsync(
        long userId,
        long collectionId,
        string? blobName,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        var replaced = collection.SetIconImage(blobName, updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        return (await GetAsync(userId, collectionId, cancellationToken), replaced);
    }

    public async Task<CollectionDto> SetColorAsync(
        long userId,
        long collectionId,
        string color,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.SetColor(color, updatedAtUtc);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        // The caller's full view (own favorite mark, participants) - same shape as GetAsync.
        return await GetAsync(userId, collectionId, cancellationToken);
    }

    public async Task DeleteAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections
            .FirstOrDefaultAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (collection is null)
        {
            return;
        }

        collection.SoftDelete(DateTimeOffset.UtcNow);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Matches Category's delete-vs-delete race handling: another request already removed
            // this Collection, so the desired end state (absent) was already reached.
        }
    }

    public Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort = CollectionItemSort.Manual,
        CancellationToken cancellationToken = default) =>
        GetItemsPageAsync(userId, collectionId, window: null, cursor, limit, sort, cancellationToken);

    public Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsInRangeAsync(
        long userId,
        long collectionId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort,
        CancellationToken cancellationToken = default) =>
        GetItemsPageAsync(userId, collectionId, (fromUtc, toUtc), cursor, limit, sort, cancellationToken);

    public async Task<DateTimeOffset?> GetOldestAddedAtUtcAsync(
        long userId,
        long collectionId,
        DateTimeOffset beforeUtc,
        CancellationToken cancellationToken = default)
    {
        if (!await CanViewAsync(userId, collectionId, cancellationToken))
        {
            throw new CollectionNotFoundException();
        }

        return await (
            from membership in dbContext.CollectionItems.AsNoTracking()
            where membership.CollectionId == collectionId && membership.AddedAtUtc < beforeUtc
            join item in dbContext.Items.AsNoTracking().Where(item => item.DeletedAtUtc == null)
                on membership.ItemId equals item.Id
            select (DateTimeOffset?)membership.AddedAtUtc)
            .MinAsync(cancellationToken);
    }

    /// <summary>
    /// One statement for every window, like ItemStore.CountByRangesAsync: the windows travel as one
    /// JSON parameter and each gets a correlated COUNT over exactly the rows GetItemsPageAsync pages
    /// through (this Collection's memberships whose Item is not in the trash).
    /// </summary>
    public async Task<IReadOnlyList<int>> CountByAddedRangesAsync(
        long userId,
        long collectionId,
        IReadOnlyList<(DateTimeOffset FromUtc, DateTimeOffset ToUtc)> ranges,
        CancellationToken cancellationToken = default)
    {
        if (!await CanViewAsync(userId, collectionId, cancellationToken))
        {
            throw new CollectionNotFoundException();
        }

        if (ranges.Count == 0)
        {
            return [];
        }

        var windows = System.Text.Json.JsonSerializer.Serialize(
            ranges.Select((range, index) => new { i = index, f = range.FromUtc, t = range.ToUtc }));
        var rows = await dbContext.Database
            .SqlQueryRaw<AddedRangeCount>(
                """
                SELECT w.[Idx], (
                    SELECT COUNT(*)
                    FROM [collections].[CollectionItems] AS m
                    INNER JOIN [items].[Items] AS i ON i.[Id] = m.[ItemId]
                    WHERE m.[CollectionId] = @collectionId AND i.[DeletedAtUtc] IS NULL
                        AND m.[AddedAtUtc] >= w.[FromUtc] AND m.[AddedAtUtc] < w.[ToUtc]) AS [Count]
                FROM OPENJSON(@windows) WITH ([Idx] int '$.i', [FromUtc] datetimeoffset '$.f', [ToUtc] datetimeoffset '$.t') AS w
                """,
                new SqlParameter("@collectionId", collectionId),
                new SqlParameter("@windows", windows))
            .ToListAsync(cancellationToken);

        var counts = new int[ranges.Count];
        foreach (var row in rows)
        {
            counts[row.Idx] = row.Count;
        }

        return counts;
    }

    private sealed class AddedRangeCount
    {
        public int Idx { get; init; }

        public int Count { get; init; }
    }

    private async Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsPageAsync(
        long userId,
        long collectionId,
        (DateTimeOffset FromUtc, DateTimeOffset ToUtc)? window,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort,
        CancellationToken cancellationToken)
    {
        if (cursor is not null && cursor.Sort != sort)
        {
            throw new ArgumentException("The cursor belongs to a different sort order.", nameof(cursor));
        }

        if (!await CanViewAsync(userId, collectionId, cancellationToken))
        {
            throw new CollectionNotFoundException();
        }

        var membershipQuery = dbContext.CollectionItems
            .AsNoTracking()
            .Where(membership => membership.CollectionId == collectionId);

        if (window is { } range)
        {
            var (fromUtc, toUtc) = range;
            membershipQuery = membershipQuery.Where(membership => membership.AddedAtUtc >= fromUtc && membership.AddedAtUtc < toUtc);
        }

        // Keyset position after the previous page, in the requested order. The date orders are over
        // the whole Collection (AddedAtUtc, ItemId) - never a re-sort of one page - and ItemId is
        // unique within a Collection, so equal timestamps still page without duplicates or gaps.
        if (cursor is not null)
        {
            membershipQuery = sort switch
            {
                CollectionItemSort.DateDesc => membershipQuery.Where(membership =>
                    membership.AddedAtUtc < cursor.AddedAtUtc
                    || (membership.AddedAtUtc == cursor.AddedAtUtc && membership.ItemId < cursor.ItemId)),
                CollectionItemSort.DateAsc => membershipQuery.Where(membership =>
                    membership.AddedAtUtc > cursor.AddedAtUtc
                    || (membership.AddedAtUtc == cursor.AddedAtUtc && membership.ItemId > cursor.ItemId)),
                _ => membershipQuery.Where(membership =>
                    membership.SortOrder > cursor.SortOrder
                    || (membership.SortOrder == cursor.SortOrder && membership.ItemId > cursor.ItemId)),
            };
        }

        // Every active Item of this Collection, whoever owns it - access to the Collection (checked
        // above) is what grants seeing its links. Private fields are selected only for the viewer's
        // own Items: another member's Memo and uploaded/cover image blob names never leave the
        // database (the conditional is evaluated in SQL, not filtered afterwards).
        var pagedQuery =
            from membership in membershipQuery
            join item in dbContext.Items.AsNoTracking()
                .Where(item => item.DeletedAtUtc == null)
                on membership.ItemId equals item.Id
            select new
            {
                item.Id,
                item.Url,
                item.Title,
                Memo = item.UserId == userId ? item.Memo : null,
                membership.AddedAtUtc,
                membership.SortOrder,
                item.PreviewImageUrl,
                IsMine = item.UserId == userId,
                membership.AddedByUserId,
                membership.AddedViaPublicShare,
                RepresentativeImage = dbContext.ItemImages
                    .Where(image => image.ItemId == item.Id && item.UserId == userId)
                    .OrderBy(image => image.SortOrder)
                    .ThenBy(image => image.Id)
                    .Select(image => new { image.Id, image.BlobName })
                    .FirstOrDefault(),
                CoverImage = dbContext.ItemImages
                    .Where(image => image.ItemId == item.Id && image.Id == item.CoverImageId && item.UserId == userId)
                    .Select(image => new { image.Id, image.BlobName })
                    .FirstOrDefault(),
            };

        var orderedQuery = sort switch
        {
            CollectionItemSort.DateDesc => pagedQuery.OrderByDescending(row => row.AddedAtUtc).ThenByDescending(row => row.Id),
            CollectionItemSort.DateAsc => pagedQuery.OrderBy(row => row.AddedAtUtc).ThenBy(row => row.Id),
            _ => pagedQuery.OrderBy(row => row.SortOrder).ThenBy(row => row.Id),
        };

        var page = await orderedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;
        var adders = await ResolveAddersAsync(
            userId, collectionId, pageRows.Select(row => row.AddedByUserId).ToList(), cancellationToken);

        var items = new List<CollectionItemEntryDto>(pageRows.Count);
        var representativeImages = new Dictionary<long, ItemRepresentativeImageRef>();
        var coverImages = new Dictionary<long, ItemRepresentativeImageRef>();
        foreach (var row in pageRows)
        {
            items.Add(new CollectionItemEntryDto(
                row.Id, row.Url, row.Title, row.Memo, row.AddedAtUtc, row.SortOrder,
                RepresentativeImage: null, row.PreviewImageUrl, CoverImage: null, IsMine: row.IsMine,
                AddedBy: adders(row.AddedByUserId, row.AddedViaPublicShare)));
            if (!row.IsMine)
            {
                continue;
            }

            if (row.RepresentativeImage is not null)
            {
                representativeImages[row.Id] =
                    new ItemRepresentativeImageRef(row.RepresentativeImage.Id, row.RepresentativeImage.BlobName);
            }
            if (row.CoverImage is not null)
            {
                coverImages[row.Id] = new ItemRepresentativeImageRef(row.CoverImage.Id, row.CoverImage.BlobName);
            }
        }

        var nextCursor = !hasMore
            ? null
            : sort == CollectionItemSort.Manual
                ? new CollectionItemPageCursor(pageRows[^1].SortOrder, pageRows[^1].Id)
                : CollectionItemPageCursor.ForDate(sort, pageRows[^1].AddedAtUtc, pageRows[^1].Id);

        return (new CollectionItemPage(items, nextCursor), representativeImages, coverImages);
    }

    /// <summary>
    /// The alreadyMember pre-check below is a fast path only, not the actual duplicate-prevention
    /// mechanism - two concurrent AddAsync calls for the same (collectionId, itemId) can both pass
    /// it (a genuine TOCTOU race), so the real guarantee is UX_CollectionItems_CollectionId_ItemId
    /// (see CollectionItemConfiguration): whichever INSERT loses the race hits that unique
    /// constraint, which the catch below absorbs as the same no-op success as the pre-check path.
    /// Either way, the database can never end up with two CollectionItem rows for the same pair.
    /// </summary>
    public async Task<SharedCollectionItemDto?> GetSharedItemAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        if (!await CanViewAsync(userId, collectionId, cancellationToken))
        {
            throw new CollectionNotFoundException();
        }

        var row = await (
            from membership in dbContext.CollectionItems.AsNoTracking()
            where membership.CollectionId == collectionId && membership.ItemId == itemId
            join item in dbContext.Items.AsNoTracking().Where(item => item.DeletedAtUtc == null)
                on membership.ItemId equals item.Id
            select new
            {
                Item = new SharedCollectionItemDto(
                    item.Id, item.Url, item.Title, item.PreviewImageUrl, membership.AddedAtUtc, item.UserId == userId, null),
                membership.AddedByUserId,
                membership.AddedViaPublicShare,
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return null;
        }

        var adders = await ResolveAddersAsync(userId, collectionId, [row.AddedByUserId], cancellationToken);
        return row.Item with { AddedBy = adders(row.AddedByUserId, row.AddedViaPublicShare) };
    }

    /// <summary>
    /// Describes each link's adder to a caller who may view this Collection (checked by the caller
    /// of this method): themselves, the Owner or a current member by their public identity, or -
    /// for anyone else who added through the 모든 사용자 link - only that fact. Two small queries
    /// for a whole page (members among the adders, then their public identity), never one per row;
    /// each visible person's profile photo is signed once per page (local signing, no query).
    /// AddedByUserId 0 is a pre-collaboration row, which was always the Owner's own add.
    /// </summary>
    private async Task<Func<long, bool, CollectionItemAdderDto?>> ResolveAddersAsync(
        long userId,
        long collectionId,
        IReadOnlyCollection<long> addedByUserIds,
        CancellationToken cancellationToken)
    {
        var ownerId = await dbContext.Collections.AsNoTracking()
            .Where(collection => collection.Id == collectionId)
            .Select(collection => collection.UserId)
            .FirstAsync(cancellationToken);
        long Normalize(long addedByUserId) => addedByUserId == 0 ? ownerId : addedByUserId;

        var others = addedByUserIds.Select(Normalize).Where(id => id != userId).Distinct().ToList();
        var memberIds = others.Count == 0
            ? []
            : (await dbContext.CollectionCollaborators.AsNoTracking()
                .Where(collaborator => collaborator.CollectionId == collectionId && others.Contains(collaborator.UserId))
                .Select(collaborator => collaborator.UserId)
                .ToListAsync(cancellationToken))
                .ToHashSet();
        var visibleIds = others.Where(id => id == ownerId || memberIds.Contains(id)).ToList();
        // The caller too, when they added any of these links - their own avatar on their own links -
        // but only where adders are shown at all (someone else added here, or the Collection has
        // members or a public link): a private Collection's page stays the one query it always was.
        if (addedByUserIds.Select(Normalize).Contains(userId)
            && (others.Count > 0
                || await dbContext.CollectionCollaborators.AsNoTracking().AnyAsync(collaborator => collaborator.CollectionId == collectionId, cancellationToken)
                || await dbContext.CollectionShares.AsNoTracking().AnyAsync(share => share.CollectionId == collectionId && share.IsActive, cancellationToken)))
        {
            visibleIds.Add(userId);
        }

        var people = visibleIds.Count == 0
            ? []
            : await dbContext.Users.AsNoTracking()
                .Where(user => visibleIds.Contains(user.Id))
                .Select(user => new { user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName })
                .ToListAsync(cancellationToken);
        var adderOf = new Dictionary<long, (string Kind, CollectionItemAdderDto Adder)>();
        foreach (var person in people)
        {
            var image = await profileImageStorage.ResolveProfileImageAsync(person.Id, person.ProfileImageBlobName, cancellationToken);
            var kind = person.Id == userId
                ? CollectionItemAdderKinds.Me
                : person.Id == ownerId ? CollectionItemAdderKinds.Owner : CollectionItemAdderKinds.Member;
            adderOf[person.Id] = (kind, new CollectionItemAdderDto(
                kind, person.PublicCode, person.DisplayName, image.Url, image.Version, IsCollectionOwner: person.Id == ownerId));
        }

        return (addedByUserId, addedViaPublicShare) =>
        {
            var adderId = Normalize(addedByUserId);
            if (adderOf.TryGetValue(adderId, out var known))
            {
                return known.Adder;
            }

            if (adderId == userId)
            {
                return new CollectionItemAdderDto(CollectionItemAdderKinds.Me, IsCollectionOwner: adderId == ownerId);
            }

            return addedViaPublicShare ? new CollectionItemAdderDto(CollectionItemAdderKinds.PublicLink) : null;
        };
    }

    /// <summary>Owner or any member (Contributor or Viewer) of this active Collection - the store-level backstop for every member read.</summary>
    private Task<bool> CanViewAsync(long userId, long collectionId, CancellationToken cancellationToken) =>
        dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId
                    && collection.DeletedAtUtc == null
                    && (collection.UserId == userId
                        || dbContext.CollectionCollaborators.Any(
                            collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId)),
                cancellationToken);

    /// <summary>The Owner, or a Contributor - never a Viewer.</summary>
    private Task<bool> CanAddItemsAsync(long userId, long collectionId, CancellationToken cancellationToken) =>
        dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId
                    && (collection.UserId == userId
                        || dbContext.CollectionCollaborators.Any(
                            collaborator => collaborator.CollectionId == collection.Id
                                && collaborator.UserId == userId
                                && collaborator.Role == CollectionCollaboratorRole.Contributor)),
                cancellationToken);

    public async Task<bool?> AddItemAsync(
        string publicId,
        long userId,
        long itemId,
        DateTimeOffset addedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var share = await dbContext.CollectionShares
            .AsNoTracking()
            .Where(entry => entry.PublicId == publicId && entry.IsActive)
            .Select(entry => new { entry.CollectionId })
            .FirstOrDefaultAsync(cancellationToken);
        if (share is null)
        {
            return null;
        }

        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        // Under the Collection row lock (the one share/permission changes serialize on), re-check
        // that this exact link is still active and writable - a concurrent revoke or switch to
        // read-only wins.
        if (await CollectionRowLock.LockActiveAsync(dbContext, share.CollectionId, cancellationToken) is null)
        {
            return null;
        }

        var permission = await dbContext.CollectionShares
            .AsNoTracking()
            .Where(entry => entry.PublicId == publicId && entry.IsActive)
            .Select(entry => (CollectionSharePermission?)entry.Permission)
            .FirstOrDefaultAsync(cancellationToken);
        if (permission is null)
        {
            return null;
        }

        if (permission != CollectionSharePermission.Write)
        {
            throw new PublicShareReadOnlyException();
        }

        // Only the caller's own, live Item - nobody can put someone else's Item anywhere.
        var itemOwned = await dbContext.Items
            .AsNoTracking()
            .AnyAsync(item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null, cancellationToken);
        if (!itemOwned)
        {
            throw new ItemNotFoundException();
        }

        var alreadyMember = await dbContext.CollectionItems
            .AsNoTracking()
            .AnyAsync(membership => membership.CollectionId == share.CollectionId && membership.ItemId == itemId, cancellationToken);
        if (alreadyMember)
        {
            return false;
        }

        var minSortOrder = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == share.CollectionId)
            .Select(membership => (int?)membership.SortOrder)
            .MinAsync(cancellationToken);
        var sortOrder = minSortOrder is { } existingMin ? existingMin - SortOrderGap : 0;

        dbContext.CollectionItems.Add(new CollectionItem(
            share.CollectionId, itemId, userId, addedAtUtc, sortOrder, addedViaPublicShare: true));
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent add of the same Item already won - the desired end state exists.
            return false;
        }

        return true;
    }

    public async Task<bool> AddAsync(
        long userId,
        long collectionId,
        long itemId,
        DateTimeOffset addedAtUtc,
        CancellationToken cancellationToken = default)
    {
        if (!await CanViewAsync(userId, collectionId, cancellationToken))
        {
            throw new CollectionNotFoundException();
        }

        // Store-level backstop behind the AddItem permission: a Viewer may look, never add.
        if (!await CanAddItemsAsync(userId, collectionId, cancellationToken))
        {
            throw new CollectionForbiddenException();
        }

        // Only the caller's own Item, whatever their role - nobody can put someone else's Item
        // into a Collection.
        var itemOwned = await dbContext.Items
            .AsNoTracking()
            .AnyAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (!itemOwned)
        {
            throw new ItemNotFoundException();
        }

        // A repeat Add is a no-op, not a conflict - this is a "set membership" write (mirrors
        // Item.MoveToWishlist's own already-there no-op), never a strict create.
        var alreadyMember = await dbContext.CollectionItems
            .AsNoTracking()
            .AnyAsync(
                membership => membership.CollectionId == collectionId && membership.ItemId == itemId,
                cancellationToken);
        if (alreadyMember)
        {
            return false;
        }

        // New Items prepend (sort before every existing row) so the default "most recently added
        // first" order is preserved for a Collection the owner has never manually reordered.
        var minSortOrder = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == collectionId)
            .Select(membership => (int?)membership.SortOrder)
            .MinAsync(cancellationToken);
        var sortOrder = minSortOrder is { } existingMin ? existingMin - SortOrderGap : 0;

        var membership = new CollectionItem(collectionId, itemId, userId, addedAtUtc, sortOrder);
        dbContext.CollectionItems.Add(membership);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent Add for the same (collectionId, itemId) pair already won the race - the
            // desired end state (membership exists) was already reached. Stop tracking the refused
            // row, so a later save on this context (another Collection of the same batch, its
            // notification) does not try to insert it again.
            dbContext.Entry(membership).State = EntityState.Detached;
            return false;
        }

        return true;
    }

    public async Task RemoveAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        var collectionOwned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(
                collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (!collectionOwned)
        {
            return;
        }

        var membership = await dbContext.CollectionItems
            .FirstOrDefaultAsync(
                membership => membership.CollectionId == collectionId && membership.ItemId == itemId,
                cancellationToken);
        if (membership is null)
        {
            return;
        }

        dbContext.CollectionItems.Remove(membership);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A concurrent Remove (or the Item itself being deleted, cascading this row away)
            // already removed this membership row - the desired end state (absent) was already
            // reached.
        }
    }

    public async Task<ContributedLinkRemoval> RemoveOwnLinkAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        var row = await (
                from membership in dbContext.CollectionItems
                where membership.CollectionId == collectionId && membership.ItemId == itemId
                join item in dbContext.Items on membership.ItemId equals item.Id
                select new { Membership = membership, ItemOwnerId = item.UserId })
            .FirstOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return ContributedLinkRemoval.Absent;
        }

        if (row.ItemOwnerId != userId)
        {
            return ContributedLinkRemoval.NotOwnLink;
        }

        dbContext.CollectionItems.Remove(row.Membership);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Removed concurrently (by the Owner, or the Item's own deletion) - already absent.
        }

        return ContributedLinkRemoval.Removed;
    }

    public async Task RestoreAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
    {
        var collection = await dbContext.Collections.FirstOrDefaultAsync(
            collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc != null,
            cancellationToken);
        if (collection is null)
        {
            throw new CollectionNotFoundException();
        }

        collection.Restore();
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<TransferCollectionItemResult> TransferItemAsync(
        long userId,
        long sourceCollectionId,
        long itemId,
        long targetCollectionId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        await EnsureOwnedCollectionsAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);

        var itemOwnedAndActive = await dbContext.Items.AsNoTracking().AnyAsync(
            item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null, cancellationToken);
        if (!itemOwnedAndActive)
        {
            throw new ItemNotFoundException();
        }

        var sourceMembership = await dbContext.CollectionItems.FirstOrDefaultAsync(
            membership => membership.CollectionId == sourceCollectionId && membership.ItemId == itemId, cancellationToken);
        if (sourceMembership is null)
        {
            throw new ItemNotFoundException();
        }

        if (sourceCollectionId == targetCollectionId)
        {
            await transaction.CommitAsync(cancellationToken);
            return new TransferCollectionItemResult(TargetMembershipCreated: false);
        }

        var targetMembershipExists = await dbContext.CollectionItems.AsNoTracking().AnyAsync(
            membership => membership.CollectionId == targetCollectionId && membership.ItemId == itemId, cancellationToken);
        if (!targetMembershipExists)
        {
            var minSortOrder = await dbContext.CollectionItems
                .Where(membership => membership.CollectionId == targetCollectionId)
                .Select(membership => (int?)membership.SortOrder)
                .MinAsync(cancellationToken);
            var sortOrder = minSortOrder is { } existingMin ? existingMin - SortOrderGap : 0;
            dbContext.CollectionItems.Add(new CollectionItem(targetCollectionId, itemId, userId, sourceMembership.AddedAtUtc, sortOrder));
        }

        dbContext.CollectionItems.Remove(sourceMembership);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new TransferCollectionItemResult(TargetMembershipCreated: !targetMembershipExists);
    }

    public async Task<bool> UndoTransferItemAsync(
        long userId,
        long sourceCollectionId,
        long itemId,
        long targetCollectionId,
        bool targetMembershipCreated,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        await EnsureOwnedCollectionsAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);

        var itemOwnedAndActive = await dbContext.Items.AsNoTracking().AnyAsync(
            item => item.Id == itemId && item.UserId == userId && item.DeletedAtUtc == null, cancellationToken);
        if (!itemOwnedAndActive)
        {
            throw new ItemNotFoundException();
        }

        if (sourceCollectionId == targetCollectionId)
        {
            await transaction.CommitAsync(cancellationToken);
            return false;
        }

        var sourceMembershipExists = await dbContext.CollectionItems.AsNoTracking().AnyAsync(
            membership => membership.CollectionId == sourceCollectionId && membership.ItemId == itemId, cancellationToken);
        if (!sourceMembershipExists)
        {
            var minSortOrder = await dbContext.CollectionItems
                .Where(membership => membership.CollectionId == sourceCollectionId)
                .Select(membership => (int?)membership.SortOrder)
                .MinAsync(cancellationToken);
            var sortOrder = minSortOrder is { } existingMin ? existingMin - SortOrderGap : 0;
            dbContext.CollectionItems.Add(new CollectionItem(sourceCollectionId, itemId, userId, DateTimeOffset.UtcNow, sortOrder));
        }

        if (targetMembershipCreated)
        {
            var targetMembership = await dbContext.CollectionItems.FirstOrDefaultAsync(
                membership => membership.CollectionId == targetCollectionId && membership.ItemId == itemId, cancellationToken);
            if (targetMembership is not null)
            {
                dbContext.CollectionItems.Remove(targetMembership);
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return !sourceMembershipExists;
    }

    public async Task<MergeCollectionsResult> MergeAsync(
        long userId,
        long sourceCollectionId,
        long targetCollectionId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        await EnsureOwnedCollectionsAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);

        if (sourceCollectionId == targetCollectionId)
        {
            await transaction.CommitAsync(cancellationToken);
            return new MergeCollectionsResult(null);
        }

        var source = await dbContext.Collections.FirstAsync(
            collection => collection.Id == sourceCollectionId && collection.UserId == userId, cancellationToken);
        var targetItemIds = await dbContext.CollectionItems.AsNoTracking()
            .Where(membership => membership.CollectionId == targetCollectionId)
            .Select(membership => membership.ItemId)
            .ToHashSetAsync(cancellationToken);
        var sourceMemberships = await dbContext.CollectionItems.AsNoTracking()
            .Where(membership => membership.CollectionId == sourceCollectionId)
            .OrderBy(membership => membership.SortOrder)
            .ThenBy(membership => membership.Id)
            .ToListAsync(cancellationToken);
        var minSortOrder = await dbContext.CollectionItems.AsNoTracking()
            .Where(membership => membership.CollectionId == targetCollectionId)
            .Select(membership => (int?)membership.SortOrder)
            .MinAsync(cancellationToken) ?? 0;

        var createdMemberships = new List<CollectionItem>();
        foreach (var membership in sourceMemberships)
        {
            if (targetItemIds.Add(membership.ItemId))
            {
                minSortOrder -= SortOrderGap;
                var created = new CollectionItem(targetCollectionId, membership.ItemId, userId, membership.AddedAtUtc, minSortOrder);
                dbContext.CollectionItems.Add(created);
                createdMemberships.Add(created);
            }
        }

        // Soft-delete only, matching regular DeleteAsync - unlike the old hard delete this used to
        // do, memberships and the share row are never cascaded away, so Undo can restore this exact
        // state (see UndoMergeAsync) and an active public share becomes reachable again unchanged.
        source.SoftDelete(DateTimeOffset.UtcNow);

        var operationToken = Guid.NewGuid();
        var operation = new CollectionMergeOperation(
            userId, operationToken, sourceCollectionId, targetCollectionId, DateTimeOffset.UtcNow);
        dbContext.CollectionMergeOperations.Add(operation);

        // This first save assigns real Ids to both the operation row and every newly created
        // CollectionItem row - CollectionMergeCreatedMembership rows need those real Ids (neither
        // entity carries a navigation property to the other for EF to fix up automatically - see
        // both configurations), so they can only be built in a second pass below, still inside the
        // same transaction.
        await dbContext.SaveChangesAsync(cancellationToken);

        if (createdMemberships.Count > 0)
        {
            foreach (var created in createdMemberships)
            {
                dbContext.CollectionMergeCreatedMemberships.Add(
                    new CollectionMergeCreatedMembership(operation.Id, created.Id));
            }
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return new MergeCollectionsResult(operationToken, createdMemberships.Count);
    }

    public async Task UndoMergeAsync(
        long userId,
        Guid undoOperationId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);

        // Row-locked so two concurrent Undo calls for the same operation (e.g. a client retry racing
        // its own original request) serialize instead of both observing UndoneAtUtc == null and both
        // acting on it - mirrors EnsureOwnedCollectionsAsync's own UPDLOCK/HOLDLOCK use.
        var operation = await dbContext.CollectionMergeOperations
            .FromSqlInterpolated($"SELECT * FROM collections.CollectionMergeOperations WITH (UPDLOCK, HOLDLOCK) WHERE OperationToken = {undoOperationId}")
            .FirstOrDefaultAsync(cancellationToken);
        if (operation is null || operation.UserId != userId)
        {
            // Not found and "found but belongs to someone else" are deliberately indistinguishable
            // to the caller - same NotFound treatment as every other ownership check in this store.
            throw new CollectionNotFoundException();
        }

        if (operation.UndoneAtUtc is not null)
        {
            // Already undone (e.g. a retried request) - the desired end state was already reached,
            // so this is a safe no-op rather than re-restoring Source or re-deleting memberships
            // that may have since changed for unrelated reasons.
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var source = await dbContext.Collections.FirstOrDefaultAsync(
            collection => collection.Id == operation.SourceCollectionId && collection.UserId == userId, cancellationToken);
        if (source is null)
        {
            throw new CollectionNotFoundException();
        }
        source.Restore();

        // Only the specific CollectionItem rows this merge itself created - never a plain "remove
        // every source ItemId from Target" pass, which would also strip a membership the Target
        // already had before the merge, or one the user (re-)added afterward for their own reasons.
        // A row already gone (removed by the user, or cascaded away with its Item) simply is not
        // returned by this join - never an error, and Target itself is never read or restored here,
        // so an already soft-deleted Target stays exactly as it was (see this store's own remarks).
        var createdCollectionItems = await (
            from created in dbContext.CollectionMergeCreatedMemberships
            where created.MergeOperationId == operation.Id
            join item in dbContext.CollectionItems on created.CollectionItemId equals item.Id
            select item
        ).ToListAsync(cancellationToken);
        dbContext.CollectionItems.RemoveRange(createdCollectionItems);

        operation.MarkUndone(DateTimeOffset.UtcNow);

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task EnsureOwnedCollectionsAsync(
        long userId,
        long sourceCollectionId,
        long targetCollectionId,
        CancellationToken cancellationToken)
    {
        // Lock in stable ID order so concurrent transfer/merge operations cannot observe a partially
        // changed pair. SQL Server applies UPDLOCK/HOLDLOCK through commit.
        var ownedIds = await dbContext.Collections
            .FromSqlInterpolated($"SELECT * FROM collections.Collections WITH (UPDLOCK, HOLDLOCK) WHERE Id IN ({sourceCollectionId}, {targetCollectionId})")
            .AsNoTracking()
            .Where(collection => collection.UserId == userId && collection.DeletedAtUtc == null)
            .Select(collection => collection.Id)
            .ToListAsync(cancellationToken);
        if (!ownedIds.Contains(sourceCollectionId) || !ownedIds.Contains(targetCollectionId))
        {
            throw new CollectionNotFoundException();
        }

        // v1: a Collection with collaborators (or a pending invitation) is never merged or used as a
        // transfer source/target - no partial "owner's items only" variant. Checked under the
        // UPDLOCK taken above, so an invitation accepted concurrently cannot slip in between.
        var collaborative = await dbContext.CollectionCollaborators
                .AnyAsync(collaborator => collaborator.CollectionId == sourceCollectionId || collaborator.CollectionId == targetCollectionId, cancellationToken)
            || await dbContext.CollectionInvitations
                .AnyAsync(invitation => (invitation.CollectionId == sourceCollectionId || invitation.CollectionId == targetCollectionId)
                    && invitation.Status == CollectionInvitationStatus.Pending, cancellationToken);
        if (collaborative)
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.CollaborationActive);
        }
    }

    /// <summary>
    /// Moves itemId to immediately after afterItemId (null = front) using gap-based (fractional)
    /// SortOrder positioning: the moved row's new value is the midpoint between its new neighbors,
    /// so a single reorder only ever writes one row unless the gap between those neighbors has been
    /// fully exhausted, in which case the whole Collection is renumbered (still one transaction) -
    /// mirrors ItemImageStore.InsertRowForLockedItemAsync's UPDLOCK+HOLDLOCK pattern, serializing
    /// concurrent reorders/appends on the same Collection instead of adding a RowVersion to
    /// CollectionItem (see CollectionItem's own remarks).
    /// </summary>
    public async Task MoveItemAsync(
        long userId,
        long collectionId,
        long itemId,
        long? afterItemId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);

        var collectionOwned = await dbContext.Collections
            .FromSqlInterpolated($"SELECT * FROM collections.Collections WITH (UPDLOCK, HOLDLOCK) WHERE Id = {collectionId}")
            .AsNoTracking()
            .AnyAsync(collection => collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (!collectionOwned)
        {
            throw new CollectionNotFoundException();
        }

        var movingItem = await dbContext.CollectionItems
            .FirstOrDefaultAsync(
                membership => membership.CollectionId == collectionId && membership.ItemId == itemId,
                cancellationToken);
        if (movingItem is null)
        {
            throw new ItemNotFoundException();
        }

        if (afterItemId == itemId)
        {
            // Moving an item to right after itself is a well-defined no-op, not an error.
            return;
        }

        int? lowerBound = null;
        if (afterItemId is { } anchorItemId)
        {
            lowerBound = await dbContext.CollectionItems
                .AsNoTracking()
                .Where(membership => membership.CollectionId == collectionId && membership.ItemId == anchorItemId)
                .Select(membership => (int?)membership.SortOrder)
                .FirstOrDefaultAsync(cancellationToken);
            if (lowerBound is null)
            {
                throw new ItemNotFoundException();
            }
        }

        var othersQuery = dbContext.CollectionItems
            .AsNoTracking()
            .Where(membership => membership.CollectionId == collectionId && membership.ItemId != itemId);
        var upperBound = lowerBound is { } after
            ? await othersQuery
                .Where(membership => membership.SortOrder > after)
                .OrderBy(membership => membership.SortOrder)
                .Select(membership => (int?)membership.SortOrder)
                .FirstOrDefaultAsync(cancellationToken)
            : await othersQuery
                .OrderBy(membership => membership.SortOrder)
                .Select(membership => (int?)membership.SortOrder)
                .FirstOrDefaultAsync(cancellationToken);

        var needsRenumber =
            (lowerBound.HasValue && upperBound.HasValue && upperBound.Value - (long)lowerBound.Value <= 1)
            || (lowerBound.HasValue && (long)lowerBound.Value + SortOrderGap > int.MaxValue)
            || (upperBound.HasValue && (long)upperBound.Value - SortOrderGap < int.MinValue);

        if (needsRenumber)
        {
            var orderedOthers = await dbContext.CollectionItems
                .Where(membership => membership.CollectionId == collectionId && membership.ItemId != itemId)
                .OrderBy(membership => membership.SortOrder)
                .ThenBy(membership => membership.ItemId)
                .ToListAsync(cancellationToken);

            var insertIndex = afterItemId is null
                ? 0
                : orderedOthers.FindIndex(membership => membership.ItemId == afterItemId.Value) + 1;
            orderedOthers.Insert(insertIndex, movingItem);

            for (var index = 0; index < orderedOthers.Count; index++)
            {
                orderedOthers[index].SetSortOrder(index * SortOrderGap);
            }
        }
        else if (!lowerBound.HasValue && !upperBound.HasValue)
        {
            movingItem.SetSortOrder(0);
        }
        else if (!lowerBound.HasValue)
        {
            movingItem.SetSortOrder(upperBound!.Value - SortOrderGap);
        }
        else if (!upperBound.HasValue)
        {
            movingItem.SetSortOrder(lowerBound.Value + SortOrderGap);
        }
        else
        {
            var midpoint = lowerBound.Value + ((long)upperBound.Value - lowerBound.Value) / 2;
            movingItem.SetSortOrder((int)midpoint);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
