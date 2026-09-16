using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Items;

/// <summary>
/// Exercises the real SQL-level behaviors InstagramMetadataRetryServiceTests' fake store cannot:
/// the actual Instagram-host discovery filter, the unique-index-backed duplicate registration
/// guard, and TryClaimAsync's atomic conditional UPDATE.
/// </summary>
public sealed class InstagramMetadataRetryStoreIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _dbContext = null!;
    private long _userId;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException(
                "ConnectionStrings__JupleDatabase must be set to run Instagram metadata retry store " +
                "integration tests against a local SQL Server instance.");

        var options = new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options;
        _dbContext = new JupleDbContext(options);

        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        _userId = user.Id;
        _dbContext.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM items.InstagramMetadataRetryTasks WHERE ItemId IN (SELECT Id FROM items.Items WHERE UserId = {_userId})");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM items.Items WHERE UserId = {_userId}");
        await _dbContext.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM users.Users WHERE Id = {_userId}");
        await _dbContext.DisposeAsync();
    }

    private InstagramMetadataRetryStore NewStore() => new(_dbContext);

    private async Task<long> AddItemAsync(string url, DateTimeOffset savedAtUtc)
    {
        var item = new Item(_userId, url, savedAtUtc);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync(CancellationToken.None);
        _dbContext.ChangeTracker.Clear();
        return item.Id;
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://example.com/some/article?ref=instagram.com")] // "instagram.com" in the query only
    public void IsEligibleInstagramCandidateUrl_NonInstagramHost_ReturnsFalse(string url) =>
        Assert.False(InstagramMetadataRetryStore.IsEligibleInstagramCandidateUrl(url));

    [Theory]
    [InlineData("https://www.instagram.com/p/Dc71q9mR3xf/")]
    [InlineData("https://instagram.com/reel/abc123/")]
    public void IsEligibleInstagramCandidateUrl_InstagramHost_ReturnsTrue(string url) =>
        Assert.True(InstagramMetadataRetryStore.IsEligibleInstagramCandidateUrl(url));

    [Fact]
    public async Task RegisterNewCandidatesAsync_DiscoversAnEligibleInstagramItem_ButNotAYouTubeOrAlreadyResolvedOne()
    {
        var now = DateTimeOffset.UtcNow;
        var eligibleItemId = await AddItemAsync(
            $"https://www.instagram.com/p/IntegrationTest{Guid.NewGuid():N}/", now - TimeSpan.FromMinutes(2));
        var youTubeItemId = await AddItemAsync(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ", now - TimeSpan.FromMinutes(2));

        var alreadyResolvedItem = new Item(
            _userId, $"https://www.instagram.com/p/AlreadyResolved{Guid.NewGuid():N}/", now - TimeSpan.FromMinutes(2));
        _dbContext.Items.Add(alreadyResolvedItem);
        await _dbContext.SaveChangesAsync();
        alreadyResolvedItem.UpdateDetails("someone on Instagram: \"caption\"", null);
        alreadyResolvedItem.SetPreviewImageUrl("https://scontent.cdninstagram.com/real.jpg");
        await _dbContext.SaveChangesAsync();
        _dbContext.ChangeTracker.Clear();

        var store = NewStore();
        await store.RegisterNewCandidatesAsync(
            now, discoveryWindow: TimeSpan.FromMinutes(30), firstAttemptDelay: TimeSpan.FromMinutes(1));

        var due = await store.ListDueAsync(now);
        var dueItemIds = due.Select(task => task.ItemId).ToHashSet();

        Assert.Contains(eligibleItemId, dueItemIds);
        Assert.DoesNotContain(youTubeItemId, dueItemIds);
        Assert.DoesNotContain(alreadyResolvedItem.Id, dueItemIds);
    }

    [Fact]
    public async Task RegisterNewCandidatesAsync_CalledTwice_NeverRegistersASecondTaskForTheSameItem()
    {
        var now = DateTimeOffset.UtcNow;
        var itemId = await AddItemAsync(
            $"https://www.instagram.com/p/DupTest{Guid.NewGuid():N}/", now - TimeSpan.FromMinutes(2));
        var store = NewStore();

        await store.RegisterNewCandidatesAsync(now, TimeSpan.FromMinutes(30), TimeSpan.FromMinutes(1));
        // Simulates a second, overlapping worker run's discovery pass finding the same candidate
        // before the first run's task is claimed/removed.
        await store.RegisterNewCandidatesAsync(now, TimeSpan.FromMinutes(30), TimeSpan.FromMinutes(1));

        var taskCount = await _dbContext.InstagramMetadataRetryTasks.CountAsync(task => task.ItemId == itemId);
        Assert.Equal(1, taskCount);
    }

    [Fact]
    public async Task TryClaimAsync_SecondConcurrentClaimOnTheSameTask_Fails()
    {
        var now = DateTimeOffset.UtcNow;
        var itemId = await AddItemAsync(
            $"https://www.instagram.com/p/ClaimTest{Guid.NewGuid():N}/", now - TimeSpan.FromMinutes(2));
        var task = new InstagramMetadataRetryTask(itemId, now, now);
        _dbContext.InstagramMetadataRetryTasks.Add(task);
        await _dbContext.SaveChangesAsync();
        var taskId = task.Id;
        _dbContext.ChangeTracker.Clear();

        var store = NewStore();
        var firstClaim = await store.TryClaimAsync(taskId, now, now - TimeSpan.FromMinutes(2));
        var secondClaim = await store.TryClaimAsync(taskId, now, now - TimeSpan.FromMinutes(2));

        Assert.True(firstClaim);
        Assert.False(secondClaim);
    }

    [Fact]
    public async Task TryClaimAsync_StaleClaimFromACrashedWorker_CanBeReclaimed()
    {
        var now = DateTimeOffset.UtcNow;
        var itemId = await AddItemAsync(
            $"https://www.instagram.com/p/StaleClaimTest{Guid.NewGuid():N}/", now - TimeSpan.FromMinutes(2));
        var task = new InstagramMetadataRetryTask(itemId, now, now);
        _dbContext.InstagramMetadataRetryTasks.Add(task);
        await _dbContext.SaveChangesAsync();
        var taskId = task.Id;
        _dbContext.ChangeTracker.Clear();

        var store = NewStore();
        var staleClaimTime = now - TimeSpan.FromMinutes(5);
        Assert.True(await store.TryClaimAsync(taskId, staleClaimTime, staleClaimTime - TimeSpan.FromMinutes(2)));

        // A later worker run treats anything claimed before (now - StaleClaimThreshold) as
        // abandoned and reclaims it.
        var reclaimed = await store.TryClaimAsync(taskId, now, now - TimeSpan.FromMinutes(2));
        Assert.True(reclaimed);
    }

    [Fact]
    public async Task ApplyResolvedMetadataAsync_NeverOverwritesAnAlreadyPresentTitle()
    {
        var now = DateTimeOffset.UtcNow;
        var item = new Item(_userId, $"https://www.instagram.com/p/Protect{Guid.NewGuid():N}/", now);
        item.UpdateDetails("user's own title", null);
        _dbContext.Items.Add(item);
        await _dbContext.SaveChangesAsync();
        var itemId = item.Id;
        _dbContext.ChangeTracker.Clear();

        var store = NewStore();
        await store.ApplyResolvedMetadataAsync(itemId, "fetched title", "https://scontent.cdninstagram.com/x.jpg");

        var (title, previewImageUrl) = (await store.GetItemMetadataStateAsync(itemId))!.Value;
        Assert.Equal("user's own title", title);
        Assert.Equal("https://scontent.cdninstagram.com/x.jpg", previewImageUrl);
    }
}
