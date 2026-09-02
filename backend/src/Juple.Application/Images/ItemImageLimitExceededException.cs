namespace Juple.Application.Images;

public sealed class ItemImageLimitExceededException()
    : Exception("This Item already has the maximum number of images.");
