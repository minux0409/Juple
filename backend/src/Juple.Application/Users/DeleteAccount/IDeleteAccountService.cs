namespace Juple.Application.Users.DeleteAccount;

public interface IDeleteAccountService
{
    Task DeleteAsync(long userId, CancellationToken cancellationToken = default);
}
