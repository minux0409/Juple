using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionMergeOperationConfiguration : IEntityTypeConfiguration<CollectionMergeOperation>
{
    public void Configure(EntityTypeBuilder<CollectionMergeOperation> builder)
    {
        builder.ToTable("CollectionMergeOperations", "collections");

        builder.HasKey(operation => operation.Id);
        builder.Property(operation => operation.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(operation => operation.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(operation => operation.OperationToken)
            .HasColumnType("uniqueidentifier")
            .IsRequired();

        builder.Property(operation => operation.SourceCollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(operation => operation.TargetCollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(operation => operation.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(operation => operation.UndoneAtUtc)
            .HasColumnType("datetimeoffset");

        // The Undo endpoint's sole lookup path - must be unique so a token can never resolve to more
        // than one operation. Ownership is still re-checked against UserId after this lookup (see
        // CollectionStore.UndoMergeAsync), not derived from the token's guessability.
        builder.HasIndex(operation => operation.OperationToken)
            .IsUnique()
            .HasDatabaseName("UX_CollectionMergeOperations_OperationToken");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(operation => operation.UserId)
            .OnDelete(DeleteBehavior.NoAction);

        // Two independent FKs to Collections (Source and Target) - never touched by either
        // Collection's own cascade rules, since a merge's history must survive ordinary
        // soft-delete/restore of either side (see UndoMergeAsync's Target soft-delete remarks).
        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(operation => operation.SourceCollectionId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(operation => operation.TargetCollectionId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
