using Juple.Domain.Admin;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Admin;

public sealed class AdminUserConfiguration : IEntityTypeConfiguration<AdminUser>
{
    public void Configure(EntityTypeBuilder<AdminUser> builder)
    {
        builder.ToTable("AdminUsers", "admin", table =>
        {
            // Stored by name, so reordering the C# enum never changes what an existing grant means; the database refuses any
            // role this build does not know.
            table.HasCheckConstraint("CK_AdminUsers_Role_Valid", "[Role] IN ('Owner', 'Admin')");
        });

        builder.HasKey(admin => admin.Id);
        builder.Property(admin => admin.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(admin => admin.UserId)
            .IsRequired();

        builder.Property(admin => admin.Role)
            .HasConversion<string>()
            .HasColumnType("nvarchar(16)")
            .HasMaxLength(16)
            .IsRequired();

        builder.Property(admin => admin.IsActive)
            .IsRequired();

        builder.Property(admin => admin.GrantedByUserId);

        builder.Property(admin => admin.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(admin => admin.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // One grant per person; the authorization lookup is this exact key.
        builder.HasIndex(admin => admin.UserId)
            .IsUnique()
            .HasDatabaseName("UX_AdminUsers_UserId");

        // The grant belongs to the person: deleting the account removes it (an orphaned grant could never be used anyway, and
        // a restricting key would block account deletion for an admin).
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(admin => admin.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
