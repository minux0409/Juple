namespace Juple.Application.Items.SetItemCoverImage;

/// <summary>ImageId null means "clear the explicit cover choice" (fall back to PreviewImageUrl/the first-uploaded image).</summary>
public sealed record SetItemCoverImageCommand(long? ImageId);
