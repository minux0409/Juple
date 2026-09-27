using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionInvitationConfiguration : IEntityTypeConfiguration<CollectionInvitation>
{
    public void Configure(EntityTypeBuilder<CollectionInvitation> builder)
    {
        builder.ToTable("CollectionInvitations", "collections");

        builder.HasKey(invitation => invitation.Id);
        builder.Property(invitation => invitation.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(invitation => invitation.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(invitation => invitation.InvitedUserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(invitation => invitation.InvitedByUserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(invitation => invitation.Role)
            .HasConversion<string>()
            .HasColumnType("varchar(20)")
            .IsRequired();

        builder.Property(invitation => invitation.Status)
            .HasConversion<string>()
            .HasColumnType("varchar(20)")
            .IsRequired();

        builder.Property(invitation => invitation.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(invitation => invitation.ExpiresAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(invitation => invitation.RespondedAtUtc)
            .HasColumnType("datetimeoffset");

        builder.Property(invitation => invitation.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();

        // At most one open invitation per invited user per Collection (the business invariant
        // behind the duplicate-invite 409); resolved rows stay as history.
        builder.HasIndex(invitation => new { invitation.CollectionId, invitation.InvitedUserId })
            .IsUnique()
            .HasFilter("[Status] = 'Pending'")
            .HasDatabaseName("UX_CollectionInvitations_CollectionId_InvitedUserId_Pending");

        // "Invitations I received".
        builder.HasIndex(invitation => new { invitation.InvitedUserId, invitation.Status })
            .HasDatabaseName("IX_CollectionInvitations_InvitedUserId_Status");

        // Owner's pending list, and the share/collaboration exclusivity check.
        builder.HasIndex(invitation => new { invitation.CollectionId, invitation.Status })
            .HasDatabaseName("IX_CollectionInvitations_CollectionId_Status");

        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(invitation => invitation.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(invitation => invitation.InvitedUserId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(invitation => invitation.InvitedByUserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
