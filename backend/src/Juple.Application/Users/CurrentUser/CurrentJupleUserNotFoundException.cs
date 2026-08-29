namespace Juple.Application.Users.CurrentUser;

public sealed class CurrentJupleUserNotFoundException : Exception
{
    public CurrentJupleUserNotFoundException()
        : base("The authenticated identity has not completed Juple user bootstrap.")
    {
    }
}