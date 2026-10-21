using System.Net;
using System.Text;
using System.Text.Json;
using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Http;
using Juple.Application.Push;
using Juple.Domain.Push;
using Juple.Infrastructure.Push;

namespace Juple.UnitTests.Push;

public sealed class FirebaseDuplicateNotificationTests
{
    [Fact]
    public async Task SameNotificationUsesSameTrayTagAndDifferentNotificationsCannotOverwriteIt()
    {
        var messages = await CaptureAsync(Visible(123), Visible(123), Visible(124));
        string Tag(int index) => messages[index].GetProperty("android").GetProperty("notification").GetProperty("tag").GetString()!;
        Assert.Equal("juple.notification.123", Tag(0));
        Assert.Equal(Tag(0), Tag(1));
        Assert.NotEqual(Tag(0), Tag(2));
        Assert.All(messages, message => Assert.True(message.TryGetProperty("notification", out _)));
        Assert.Equal("123", messages[0].GetProperty("data").GetProperty("notificationId").GetString());
    }

    [Fact]
    public async Task DataOnlyRefreshNeverCreatesATrayNotificationOrTag()
    {
        var messages = await CaptureAsync(new PushNotificationPayload(null, null, "collectionContentChanged", 125, new Dictionary<string, string>(), null));
        Assert.False(messages[0].TryGetProperty("notification", out _));
        Assert.False(messages[0].GetProperty("android").TryGetProperty("notification", out _));
    }

    private static PushNotificationPayload Visible(long id) => new("Synthetic title", "Synthetic body", "collectionItemsAdded", id, new Dictionary<string, string>(), 1);

    private static async Task<List<JsonElement>> CaptureAsync(params PushNotificationPayload[] payloads)
    {
        var captured = new List<JsonElement>();
        var app = FirebaseApp.Create(new AppOptions { ProjectId = "offline-push-test", Credential = GoogleCredential.FromAccessToken("synthetic-token"), HttpClientFactory = new Factory(captured) }, Guid.NewGuid().ToString("N"));
        try
        {
            var sender = new FirebaseCloudMessagingSender(app);
            var device = new PushDeviceRegistration(1, PushPlatform.Android, "synthetic-installation", "synthetic-fcm-token", "ko", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
            foreach (var payload in payloads)
                Assert.Equal(Juple.Domain.Notifications.NotificationDeliveryStatus.Sent, (await sender.SendAsync(device, payload)).Status);
            Assert.Equal(payloads.Length, captured.Count);
            return captured;
        }
        finally { app.Delete(); }
    }

    private sealed class Factory(List<JsonElement> captured) : Google.Apis.Http.HttpClientFactory
    {
        protected override HttpMessageHandler CreateHandler(CreateHttpClientArgs args) => new Handler(captured);
    }

    private sealed class Handler(List<JsonElement> captured) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            captured.Add(body.RootElement.GetProperty("message").Clone());
            return new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { name = "projects/offline-push-test/messages/" + Guid.NewGuid().ToString("N") }), Encoding.UTF8, "application/json") };
        }
    }
}
