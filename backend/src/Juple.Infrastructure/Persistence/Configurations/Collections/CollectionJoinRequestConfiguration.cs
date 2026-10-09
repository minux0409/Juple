using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionJoinRequestConfiguration : IEntityTypeConfiguration<CollectionJoinRequest>
{
    public void Configure(EntityTypeBuilder<CollectionJoinRequest> builder)
    {
        builder.ToTable("CollectionJoinRequests", "collections");

        builder.HasKey(request => request.Id);
        builder.Property(request => request.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(request => request.CollectionId).HasColumnType("bigint").IsRequired();
        builder.Property(request => request.RequesterUserId).HasColumnType("bigint").IsRequired();

        builder.Property(request => request.Status)
            .HasConversion<string>()
            .HasColumnType("varchar(10)")
            .IsRequired();

        builder.Property(request => request.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(request => request.ResolvedAtUtc).HasColumnType("datetimeoffset");
        builder.Property(request => request.ResolvedByUserId).HasColumnType("bigint");

        // At most one waiting request per person and Collection - a database rule, so two taps (or two devices) cannot both
        // get in. A resolved request frees the slot: a declined person may ask again.
        builder.HasIndex(request => new { request.CollectionId, request.RequesterUserId })
            .IsUnique()
            .HasFilter("[Status] = 'Pending'")
            .HasDatabaseName("UX_CollectionJoinRequests_CollectionId_RequesterUserId_Pending");

        // The Owner's list: waiting requests of one Collection, oldest first, keyset-paged by Id.
        builder.HasIndex(request => new { request.CollectionId, request.Id })
            .HasFilter("[Status] = 'Pending'")
            .HasDatabaseName("IX_CollectionJoinRequests_CollectionId_Id_Pending");

        builder.HasIndex(request => request.RequesterUserId)
            .HasDatabaseName("IX_CollectionJoinRequests_RequesterUserId");

        // Meaningless without its Collection (cascade). The requester's UserId is NoAction like every other UserId FK -
        // AccountDeletionStore clears these explicitly.
        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(request => request.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(request => request.RequesterUserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
