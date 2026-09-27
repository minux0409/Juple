using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionCollaboratorConfiguration : IEntityTypeConfiguration<CollectionCollaborator>
{
    public void Configure(EntityTypeBuilder<CollectionCollaborator> builder)
    {
        builder.ToTable("CollectionCollaborators", "collections");

        builder.HasKey(collaborator => collaborator.Id);
        builder.Property(collaborator => collaborator.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(collaborator => collaborator.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(collaborator => collaborator.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(collaborator => collaborator.Role)
            .HasConversion<string>()
            .HasColumnType("varchar(20)")
            .IsRequired();

        builder.Property(collaborator => collaborator.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(collaborator => collaborator.CreatedByUserId)
            .HasColumnType("bigint")
            .IsRequired();

        // One membership per user per Collection.
        builder.HasIndex(collaborator => new { collaborator.CollectionId, collaborator.UserId })
            .IsUnique()
            .HasDatabaseName("UX_CollectionCollaborators_CollectionId_UserId");

        // "Collections shared with me" and the per-request access lookup.
        builder.HasIndex(collaborator => new { collaborator.UserId, collaborator.CollectionId })
            .HasDatabaseName("IX_CollectionCollaborators_UserId_CollectionId");

        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(collaborator => collaborator.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        // NoAction like every other UserId FK - AccountDeletionStore clears these rows explicitly.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(collaborator => collaborator.UserId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(collaborator => collaborator.CreatedByUserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
