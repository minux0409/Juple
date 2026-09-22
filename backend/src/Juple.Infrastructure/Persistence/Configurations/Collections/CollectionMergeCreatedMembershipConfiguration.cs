using Juple.Domain.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionMergeCreatedMembershipConfiguration : IEntityTypeConfiguration<CollectionMergeCreatedMembership>
{
    public void Configure(EntityTypeBuilder<CollectionMergeCreatedMembership> builder)
    {
        builder.ToTable("CollectionMergeCreatedMemberships", "collections");

        builder.HasKey(created => created.Id);
        builder.Property(created => created.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(created => created.MergeOperationId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(created => created.CollectionItemId)
            .HasColumnType("bigint")
            .IsRequired();

        // "Every CollectionItem row still tracked as created by operation X" lookup - UndoMergeAsync's
        // sole read path over this table.
        builder.HasIndex(created => created.MergeOperationId)
            .HasDatabaseName("IX_CollectionMergeCreatedMemberships_MergeOperationId");

        // A CollectionItem row can be "created by" at most one merge ever - it is a fresh INSERT
        // each time (see CollectionStore.MergeAsync), never reused across operations.
        builder.HasIndex(created => created.CollectionItemId)
            .IsUnique()
            .HasDatabaseName("UX_CollectionMergeCreatedMemberships_CollectionItemId");

        builder.HasOne<CollectionMergeOperation>()
            .WithMany()
            .HasForeignKey(created => created.MergeOperationId)
            .OnDelete(DeleteBehavior.Cascade);

        // Cascade, deliberately: once the CollectionItem row itself is gone (user removal, or
        // cascaded away with its Item/Collection), this row has nothing left to describe - see
        // CollectionMergeCreatedMembership's own remarks on why that is exactly what makes the
        // remove/re-add edge case safe.
        builder.HasOne<CollectionItem>()
            .WithMany()
            .HasForeignKey(created => created.CollectionItemId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
