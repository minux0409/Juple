using System.Globalization;
using Juple.Domain.Notifications;

namespace Juple.Application.Notifications;

/// <summary>
/// Title/body of the two visible social Push notifications, in the device registration's own locale
/// (PushDeviceRegistration.Locale - the app language the user picked, see the Mobile registration
/// sync). Covers every app language; an unknown locale falls back to its base language, then English.
/// The only inserted values are the sender's display name (or Juple ID) and the Collection name -
/// never a private friend note, link or anything else.
/// </summary>
public static class SocialPushText
{
    private sealed record Texts(string FriendTitle, string FriendBody, string InviteTitle, string InviteBody);

    private static readonly Dictionary<string, Texts> ByLocale = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ko"] = new("친구 신청", "{0}님이 친구 신청을 보냈어요.", "컬렉션 공유", "{0}님이 '{1}' 컬렉션을 공유했어요."),
        ["en"] = new("Friend request", "{0} sent you a friend request.", "Shared collection", "{0} shared the collection \"{1}\" with you."),
        ["ja"] = new("友達申請", "{0}さんから友達申請が届きました。", "コレクションの共有", "{0}さんがコレクション「{1}」を共有しました。"),
        ["zh-Hans"] = new("好友申请", "{0} 向你发送了好友申请。", "合集共享", "{0} 与你共享了合集「{1}」。"),
        ["zh-Hant"] = new("好友邀請", "{0} 向你送出了好友邀請。", "合集共享", "{0} 與你共享了合集「{1}」。"),
        ["es"] = new("Solicitud de amistad", "{0} te envió una solicitud de amistad.", "Colección compartida", "{0} compartió contigo la colección «{1}»."),
        ["fr"] = new("Demande d’ami", "{0} vous a envoyé une demande d’ami.", "Collection partagée", "{0} a partagé la collection « {1} » avec vous."),
        ["de"] = new("Freundschaftsanfrage", "{0} hat dir eine Freundschaftsanfrage gesendet.", "Geteilte Sammlung", "{0} hat die Sammlung „{1}“ mit dir geteilt."),
        ["it"] = new("Richiesta di amicizia", "{0} ti ha inviato una richiesta di amicizia.", "Raccolta condivisa", "{0} ha condiviso con te la raccolta «{1}»."),
        ["pt-BR"] = new("Pedido de amizade", "{0} enviou um pedido de amizade para você.", "Coleção compartilhada", "{0} compartilhou a coleção \"{1}\" com você."),
        ["vi"] = new("Lời mời kết bạn", "{0} đã gửi cho bạn lời mời kết bạn.", "Bộ sưu tập được chia sẻ", "{0} đã chia sẻ bộ sưu tập \"{1}\" với bạn."),
        ["th"] = new("คำขอเป็นเพื่อน", "{0} ส่งคำขอเป็นเพื่อนถึงคุณ", "คอลเลกชันที่แชร์", "{0} แชร์คอลเลกชัน \"{1}\" กับคุณ"),
        ["id"] = new("Permintaan pertemanan", "{0} mengirimi Anda permintaan pertemanan.", "Koleksi dibagikan", "{0} membagikan koleksi \"{1}\" dengan Anda."),
        ["ru"] = new("Заявка в друзья", "{0} отправляет вам заявку в друзья.", "Общая коллекция", "{0} делится с вами коллекцией «{1}»."),
        ["tr"] = new("Arkadaşlık isteği", "{0} size arkadaşlık isteği gönderdi.", "Paylaşılan koleksiyon", "{0} sizinle \"{1}\" koleksiyonunu paylaştı."),
        ["ar"] = new("طلب صداقة", "أرسل إليك {0} طلب صداقة.", "مجموعة مشتركة", "شارك {0} معك المجموعة \"{1}\"."),
        ["hi"] = new("मित्र अनुरोध", "{0} ने आपको मित्र अनुरोध भेजा है।", "शेयर किया गया संग्रह", "{0} ने आपके साथ \"{1}\" संग्रह शेयर किया है।"),
    };

    private static readonly Dictionary<string, string> BaseLanguageFallback = new(StringComparer.OrdinalIgnoreCase)
    {
        ["zh"] = "zh-Hans",
        ["pt"] = "pt-BR",
    };

    public static (string Title, string Body) For(NotificationType type, string? locale, string actorName, string collectionName)
    {
        var texts = Resolve(locale);
        return type == NotificationType.CollectionInvitationReceived
            ? (texts.InviteTitle, string.Format(CultureInfo.InvariantCulture, texts.InviteBody, actorName, collectionName))
            : (texts.FriendTitle, string.Format(CultureInfo.InvariantCulture, texts.FriendBody, actorName));
    }

    private static Texts Resolve(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
        {
            return ByLocale["en"];
        }

        if (ByLocale.TryGetValue(locale, out var exact))
        {
            return exact;
        }

        var baseLanguage = locale.Split('-', '_')[0];
        if (BaseLanguageFallback.TryGetValue(baseLanguage, out var mapped))
        {
            return ByLocale[mapped];
        }

        return ByLocale.TryGetValue(baseLanguage, out var byBase) ? byBase : ByLocale["en"];
    }
}
