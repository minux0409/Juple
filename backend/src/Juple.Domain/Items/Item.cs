namespace Juple.Domain.Items;

public sealed class Item
{
    private Item()
    {
    }

    public Item(long userId, string url, DateTimeOffset savedAtUtc)
    {
        UserId = userId;
        Url = url;
        SavedAtUtc = savedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public string Url { get; private set; } = null!;

    public DateTimeOffset SavedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    public string? Title { get; private set; }

    public string? Memo { get; private set; }

    /// <summary>
    /// Best-effort link-preview image auto-extracted from URL metadata (og:image and similar) -
    /// completely separate from user-uploaded ItemImages (see Juple.Domain.Images.ItemImage): at
    /// most one, never counted against the user's image limit, never itself uploaded/stored as a
    /// blob. Null whenever no such image could be found - this is enrichment, never a save
    /// requirement (see docs/product-overview.md's "모르면 모른다고 한다").
    /// </summary>
    public string? PreviewImageUrl { get; private set; }

    /// <summary>
    /// The user's explicit choice of which of their own uploaded ItemImages (see
    /// Juple.Domain.Images.ItemImage) represents this Item, overriding PreviewImageUrl/the
    /// first-uploaded-image fallback wherever a single representative image is shown. Deliberately
    /// NOT a database-level foreign key: ItemImage already has its own FK back to Item
    /// (ItemId -&gt; Items.Id, ON DELETE CASCADE - see ItemImageConfiguration), and a second FK the
    /// other way (Items.CoverImageId -&gt; ItemImages.Id) would form a cascade cycle SQL Server
    /// rejects at constraint-creation time. Ownership (the referenced image must belong to this
    /// same Item) and clearing on delete are enforced in application code instead - see
    /// ItemStore.SetCoverImageIdAsync and ItemImageStore.DeleteAsync - mirroring the existing
    /// precedent of ItemSaveRequest.ItemId being "deliberately not a foreign key" for the same
    /// class of reason. Null means "no explicit choice" - the effective representative image then
    /// falls back to PreviewImageUrl, then the first-uploaded image, then none.
    /// </summary>
    public long? CoverImageId { get; private set; }

    /// <summary>
    /// Null while active; set to the moment this Item was moved to the trash otherwise. Deliberately
    /// not a separate Trash table/row - Home/History/Item-detail/Category-item-list/Public-share
    /// queries simply filter on this being null (see the various query store implementations), and
    /// Collection memberships, uploaded images, and every other row are left completely untouched by
    /// SoftDelete/Restore, so Restore brings the Item back exactly as it was, including any
    /// still-existing Collection memberships.
    /// </summary>
    public DateTimeOffset? DeletedAtUtc { get; private set; }

    /// <summary>
    /// Replaces the user-owned Title/Memo. Callers must pass already-normalized values (trimmed,
    /// empty collapsed to null) - this method only applies them and is a no-op when both are
    /// already at the requested values, so an unchanged edit does not touch RowVersion.
    /// </summary>
    public void UpdateDetails(string? title, string? memo)
    {
        if (Title == title && Memo == memo)
        {
            return;
        }

        Title = title;
        Memo = memo;
    }

    /// <summary>
    /// Sets the auto-extracted preview image URL. Callers must pass an already-validated absolute
    /// http/https URL - a no-op when it already matches, so a repeated enrichment pass (e.g. a
    /// retried Quick Save) never touches RowVersion needlessly.
    /// </summary>
    public void SetPreviewImageUrl(string previewImageUrl)
    {
        if (PreviewImageUrl == previewImageUrl)
        {
            return;
        }

        PreviewImageUrl = previewImageUrl;
    }

    /// <summary>
    /// Sets (or clears, with null) the user's explicit cover image choice. Callers must have
    /// already verified the referenced ItemImage (if any) belongs to this same Item - this method
    /// only applies the value and is a no-op when it already matches.
    /// </summary>
    public void SetCoverImageId(long? coverImageId)
    {
        if (CoverImageId == coverImageId)
        {
            return;
        }

        CoverImageId = coverImageId;
    }

    /// <summary>
    /// Moves this Item to the trash. No-op if already deleted - mirrors the idempotent-DELETE
    /// contract the endpoint above this already had before it became a soft delete.
    /// </summary>
    public void SoftDelete(DateTimeOffset deletedAtUtc)
    {
        if (DeletedAtUtc is not null)
        {
            return;
        }

        DeletedAtUtc = deletedAtUtc;
    }

    /// <summary>
    /// Brings this Item back out of the trash. No-op if not currently deleted.
    /// </summary>
    public void Restore()
    {
        if (DeletedAtUtc is null)
        {
            return;
        }

        DeletedAtUtc = null;
    }
}
