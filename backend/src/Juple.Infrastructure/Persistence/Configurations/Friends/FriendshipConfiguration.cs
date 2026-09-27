using Juple.Domain.Friends;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Friends;

public sealed class FriendshipConfiguration : IEntityTypeConfiguration<Friendship>
{
    public void Configure(EntityTypeBuilder<Friendship> builder)
    {
        builder.ToTable("Friendships", "users", table =>
            table.HasCheckConstraint("CK_Friendships_CanonicalPair", "[UserLowId] < [UserHighId]"));

        builder.HasKey(friendship => friendship.Id);
        builder.Property(friendship => friendship.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(friendship => friendship.UserLowId).HasColumnType("bigint").IsRequired();
        builder.Property(friendship => friendship.UserHighId).HasColumnType("bigint").IsRequired();
        builder.Property(friendship => friendship.RequestedByUserId).HasColumnType("bigint").IsRequired();

        // Stable string, never the enum's int (see UserPlan's remarks on reordering).
        builder.Property(friendship => friendship.Status)
            .HasConversion<string>()
            .HasColumnType("varchar(20)")
            .IsRequired();

        builder.Property(friendship => friendship.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();
        builder.Property(friendship => friendship.AcceptedAtUtc).HasColumnType("datetimeoffset");

        builder.Property(friendship => friendship.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();

        // One row per pair (canonical order), which is also the lookup for "does this pair exist"
        // and, by its leading column, "friendships where I am the low id".
        builder.HasIndex(friendship => new { friendship.UserLowId, friendship.UserHighId })
            .IsUnique()
            .HasDatabaseName("UX_Friendships_UserLowId_UserHighId");

        // "Friendships where I am the high id" - the other half of listing my friends/requests.
        builder.HasIndex(friendship => friendship.UserHighId)
            .HasDatabaseName("IX_Friendships_UserHighId");

        // NoAction like every other UserId FK - AccountDeletionStore clears these rows explicitly.
        builder.HasOne<User>().WithMany().HasForeignKey(friendship => friendship.UserLowId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<User>().WithMany().HasForeignKey(friendship => friendship.UserHighId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<User>().WithMany().HasForeignKey(friendship => friendship.RequestedByUserId).OnDelete(DeleteBehavior.NoAction);
    }
}

public sealed class FriendshipNoteConfiguration : IEntityTypeConfiguration<FriendshipNote>
{
    public void Configure(EntityTypeBuilder<FriendshipNote> builder)
    {
        builder.ToTable("FriendshipNotes", "users");

        builder.HasKey(note => note.Id);
        builder.Property(note => note.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(note => note.FriendshipId).HasColumnType("bigint").IsRequired();
        builder.Property(note => note.UserId).HasColumnType("bigint").IsRequired();

        // Exactly FriendNoteText's technical cap, so every value the validator accepts is storable.
        builder.Property(note => note.Note)
            .HasColumnType($"nvarchar({FriendNoteText.MaxStorageLength})")
            .HasMaxLength(FriendNoteText.MaxStorageLength)
            .IsRequired();

        builder.Property(note => note.UpdatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        // One private note per author per friendship.
        builder.HasIndex(note => new { note.FriendshipId, note.UserId })
            .IsUnique()
            .HasDatabaseName("UX_FriendshipNotes_FriendshipId_UserId");

        // A note is meaningless without its friendship: removing the friend removes both notes.
        builder.HasOne<Friendship>().WithMany().HasForeignKey(note => note.FriendshipId).OnDelete(DeleteBehavior.Cascade);

        // NoAction like every other UserId FK - the author is always one of the pair, so the
        // friendship cascade above already removes it before the User row goes.
        builder.HasOne<User>().WithMany().HasForeignKey(note => note.UserId).OnDelete(DeleteBehavior.NoAction);
    }
}
