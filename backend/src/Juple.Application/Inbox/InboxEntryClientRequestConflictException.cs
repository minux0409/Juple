namespace Juple.Application.Inbox;

public sealed class InboxEntryClientRequestConflictException()
    : Exception("The clientRequestId was already used for a different request.");
