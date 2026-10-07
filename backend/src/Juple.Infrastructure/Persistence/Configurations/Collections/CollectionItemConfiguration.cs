using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionItemConfiguration : IEntityTypeConfiguration<CollectionItem>
{
    public void Configure(EntityTypeBuilder<CollectionItem> builder)
    {
        builder.ToTable("CollectionItems", "collections");

        builder.HasKey(collectionItem => collectionItem.Id);
        builder.Property(collectionItem => collectionItem.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(collectionItem => collectionItem.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(collectionItem => collectionItem.ItemId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(collectionItem => collectionItem.AddedByUserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(collectionItem => collectionItem.AddedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // When this membership became visible content of this Collection (see CollectionItem.VisibleSinceUtc). NOT NULL and
        // deliberately WITHOUT a database default: the application always sets it from the authoritative operation time.
        // Not indexed: no live query filters on it yet (the subscription freeze is off) - add an index with R39-D's query
        // plan, not before.
        builder.Property(collectionItem => collectionItem.VisibleSinceUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(collectionItem => collectionItem.SortOrder)
            .HasColumnType("int")
            .IsRequired();

        // Default 0: every existing membership, and every one an earlier revision inserts, is a normal
        // (Owner/member) one.
        builder.Property(collectionItem => collectionItem.AddedViaPublicShare)
            .HasColumnType("bit")
            .IsRequired()
            .HasDefaultValue(false);

        // Collection detail's Item list query pattern (SortOrder ASC, Id ASC, cursor-paged) - the
        // owner's manual display order, not insertion order. Replaces the old
        // (CollectionId, AddedAtUtc, ItemId) index; AddedAtUtc itself is unindexed now but stays as
        // a column (still shown as the Item's "added" time in the UI).
        builder.HasIndex(collectionItem => new { collectionItem.CollectionId, collectionItem.SortOrder, collectionItem.Id })
            .HasDatabaseName("IX_CollectionItems_CollectionId_SortOrder_Id");

        // "Which Collections is this Item in" lookup (ItemDetails membership section) - SQL Server
        // does not auto-index FK columns.
        // Removing a Contributor deletes exactly the associations they added to that Collection.
        builder.HasIndex(collectionItem => new { collectionItem.CollectionId, collectionItem.AddedByUserId })
            .HasDatabaseName("IX_CollectionItems_CollectionId_AddedByUserId");

        builder.HasIndex(collectionItem => collectionItem.ItemId)
            .HasDatabaseName("IX_CollectionItems_ItemId");

        // The same Item must never appear twice in the same Collection - enforced by the database,
        // not just by AddItemToCollectionService's own pre-check (see CollectionStore.AddAsync).
        // An alternate key (a unique constraint, same name as the index it replaces) so that
        // CollectionItemReactions can reference the pair and go with the link - see its configuration.
        builder.HasAlternateKey(collectionItem => new { collectionItem.CollectionId, collectionItem.ItemId })
            .HasName("UX_CollectionItems_CollectionId_ItemId");

        // A membership row is meaningless without its Collection - deleting the Collection must
        // remove only these join rows, never the Items themselves (see CollectionStore.DeleteAsync,
        // which never touches the Items table).
        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(collectionItem => collectionItem.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        // A membership row is equally meaningless without its Item - unlike Purchase's SetNull
        // relationship to Item (where the Purchase record has independent value and must survive
        // the Item's deletion), a CollectionItem has no meaning on its own, so it must be removed
        // along with the Item it references (mirrors ItemImage's Cascade-on-Item precedent, not
        // Purchase's SetNull one). The Collection itself is never touched by this cascade.
        // NoAction like every other UserId FK - AccountDeletionStore clears these rows explicitly.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(collectionItem => collectionItem.AddedByUserId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(collectionItem => collectionItem.ItemId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
