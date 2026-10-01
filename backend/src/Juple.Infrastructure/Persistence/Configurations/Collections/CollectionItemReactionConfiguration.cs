using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionItemReactionConfiguration : IEntityTypeConfiguration<CollectionItemReaction>
{
    public void Configure(EntityTypeBuilder<CollectionItemReaction> builder)
    {
        builder.ToTable("CollectionItemReactions", "collections");

        builder.HasKey(reaction => reaction.Id);
        builder.Property(reaction => reaction.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(reaction => reaction.CollectionId).HasColumnType("bigint").IsRequired();
        builder.Property(reaction => reaction.ItemId).HasColumnType("bigint").IsRequired();
        builder.Property(reaction => reaction.UserId).HasColumnType("bigint").IsRequired();

        // A stable catalog key (see CollectionReactionCatalog), never raw Unicode.
        builder.Property(reaction => reaction.ReactionKey)
            .HasColumnType("nvarchar(32)")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(reaction => reaction.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        // One reaction per person per link - a database rule (two fast taps cannot both get in). Its
        // (CollectionId, ItemId) prefix also serves the per-page aggregate, so there is no second index
        // for it.
        builder.HasIndex(reaction => new { reaction.CollectionId, reaction.ItemId, reaction.UserId })
            .IsUnique()
            .HasDatabaseName("UX_CollectionItemReactions_CollectionId_ItemId_UserId");

        // "This person's reactions" - the account deletion and the removal of a member.
        builder.HasIndex(reaction => new { reaction.UserId, reaction.CollectionId })
            .HasDatabaseName("IX_CollectionItemReactions_UserId_CollectionId");

        // The reaction belongs to the link's membership (a CollectionItem), so it goes when the link
        // leaves the Collection - removed, moved, its Collection or its Item deleted - through the one
        // cascade path CollectionItems already has. (Separate FKs to the Collection and the Item would
        // be a second cascade path, which SQL Server refuses.)
        builder.HasOne<CollectionItem>()
            .WithMany()
            .HasForeignKey(reaction => new { reaction.CollectionId, reaction.ItemId })
            .HasPrincipalKey(membership => new { membership.CollectionId, membership.ItemId })
            .OnDelete(DeleteBehavior.Cascade);

        // The reacting user: NoAction like every other UserId FK - AccountDeletionStore clears these.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(reaction => reaction.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
