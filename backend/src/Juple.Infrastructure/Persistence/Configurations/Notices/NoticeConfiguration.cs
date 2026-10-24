using Juple.Domain.Notices;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
namespace Juple.Infrastructure.Persistence.Configurations.Notices;
public sealed class NoticeConfiguration : IEntityTypeConfiguration<Notice> {
    public void Configure(EntityTypeBuilder<Notice> b) {
        b.ToTable("Notices", "notices"); b.HasKey(x => x.Id); b.Property(x => x.Id).UseIdentityColumn();
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(16).IsUnicode(false);
        b.Property(x => x.OfficialUrl).HasMaxLength(2048); b.Property(x => x.Version).IsRowVersion();
        b.HasMany(x => x.Translations).WithOne().HasForeignKey(x => x.NoticeId).OnDelete(DeleteBehavior.Cascade);
        b.HasIndex(x => new { x.IsPinned, x.StartsAtUtc, x.Id }).HasFilter("[DeletedAtUtc] IS NULL AND [Status] = 'Published'");
    }
}
public sealed class NoticeTranslationConfiguration : IEntityTypeConfiguration<NoticeTranslation> {
    public void Configure(EntityTypeBuilder<NoticeTranslation> b) {
        b.ToTable("NoticeTranslations", "notices"); b.HasKey(x => new { x.NoticeId, x.Language });
        b.Property(x => x.Language).HasMaxLength(16).IsUnicode(false); b.Property(x => x.Title).HasMaxLength(200); b.Property(x => x.Body).HasMaxLength(20000);
    }
}
public sealed class NoticeReadConfiguration : IEntityTypeConfiguration<NoticeRead> {
    public void Configure(EntityTypeBuilder<NoticeRead> b) {
        b.ToTable("NoticeReads", "notices"); b.HasKey(x => new { x.UserId, x.NoticeId });
        b.HasOne<Notice>().WithMany().HasForeignKey(x => x.NoticeId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.NoAction);
        b.HasIndex(x => x.NoticeId);
    }
}
