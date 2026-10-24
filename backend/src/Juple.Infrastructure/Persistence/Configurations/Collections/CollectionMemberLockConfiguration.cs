using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionMemberLockConfiguration : IEntityTypeConfiguration<CollectionMemberLock>
{
    public void Configure(EntityTypeBuilder<CollectionMemberLock> builder)
    {
        builder.ToTable("CollectionMemberLocks", "collections");

        builder.HasKey(memberLock => memberLock.Id);
        builder.Property(memberLock => memberLock.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(memberLock => memberLock.UserId).HasColumnType("bigint").IsRequired();
        builder.Property(memberLock => memberLock.CollectionId).HasColumnType("bigint").IsRequired();
        builder.Property(memberLock => memberLock.IsLocked).IsRequired();
        builder.Property(memberLock => memberLock.LockVersion).IsRequired();
        builder.Property(memberLock => memberLock.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(memberLock => memberLock.UpdatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        // One personal lock per person per Collection; also the lookup every gate does ("is THIS Collection locked for ME").
        builder.HasIndex(memberLock => new { memberLock.UserId, memberLock.CollectionId })
            .IsUnique()
            .HasDatabaseName("UX_CollectionMemberLocks_UserId_CollectionId");

        // Backs the Collection cascade below (SQL Server does not index FK columns by itself).
        builder.HasIndex(memberLock => memberLock.CollectionId)
            .HasDatabaseName("IX_CollectionMemberLocks_CollectionId");

        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(memberLock => memberLock.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        // NoAction like every other UserId FK - AccountDeletionStore clears these rows explicitly.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(memberLock => memberLock.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
