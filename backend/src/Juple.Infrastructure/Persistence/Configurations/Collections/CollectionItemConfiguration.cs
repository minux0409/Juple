using Juple.Domain.Collections;
using Juple.Domain.Items;
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

        builder.Property(collectionItem => collectionItem.AddedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // Collection detail's Item list query pattern (AddedAtUtc DESC, ItemId DESC, cursor-paged).
        builder.HasIndex(collectionItem => new { collectionItem.CollectionId, collectionItem.AddedAtUtc, collectionItem.ItemId })
            .HasDatabaseName("IX_CollectionItems_CollectionId_AddedAtUtc_ItemId");

        // "Which Collections is this Item in" lookup (ItemDetails membership section) - SQL Server
        // does not auto-index FK columns.
        builder.HasIndex(collectionItem => collectionItem.ItemId)
            .HasDatabaseName("IX_CollectionItems_ItemId");

        // The same Item must never appear twice in the same Collection - enforced by the database,
        // not just by AddItemToCollectionService's own pre-check (see CollectionStore.AddAsync).
        builder.HasIndex(collectionItem => new { collectionItem.CollectionId, collectionItem.ItemId })
            .IsUnique()
            .HasDatabaseName("UX_CollectionItems_CollectionId_ItemId");

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
        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(collectionItem => collectionItem.ItemId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
