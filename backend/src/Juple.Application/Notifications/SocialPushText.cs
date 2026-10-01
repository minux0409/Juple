using System.Globalization;
using Juple.Domain.Notifications;

namespace Juple.Application.Notifications;

/// <summary>
/// Title/body of the visible social Push notifications, in the device registration's own locale
/// (PushDeviceRegistration.Locale - the app language the user picked, see the Mobile registration
/// sync). Covers every app language; an unknown locale falls back to its base language, then English.
/// The only inserted values are the sender's display name (or Juple ID), the Collection name
/// (shortened to CollectionNameMaxLength) and a link count - never a private friend note, a link's
/// URL/memo or anything else.
/// </summary>
public static class SocialPushText
{
    /// <summary>Longer Collection names end in "…" - the push body must stay readable on a lock screen.</summary>
    public const int CollectionNameMaxLength = 40;

    private sealed record Texts(string FriendTitle, string FriendBody, string InviteTitle, string InviteBody);

    /// <summary>
    /// CollectionItemsAdded: {0} = who added (By only), {1} = Collection name, {2} = link count (Many only).
    /// Public = added through the Collection's public link - who added it is never named.
    /// </summary>
    private sealed record ItemTexts(string Title, string By, string One, string Many, string Public);

    private static readonly Dictionary<string, ItemTexts> ItemsByLocale = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ko"] = new("새 링크", "{0}님이 '{1}'에 새 링크를 추가했어요.", "'{1}' 컬렉션에 새 링크가 추가됐어요.", "'{1}'에 링크 {2}개가 추가됐어요.", "'{1}'에 공개 링크를 통해 새 링크가 추가됐어요."),
        ["en"] = new("New link", "{0} added a new link to \"{1}\".", "A new link was added to the collection \"{1}\".", "{2} links were added to \"{1}\".", "A new link was added to \"{1}\" through its public link."),
        ["ja"] = new("新しいリンク", "{0}さんが「{1}」に新しいリンクを追加しました。", "コレクション「{1}」に新しいリンクが追加されました。", "「{1}」にリンクが{2}件追加されました。", "公開リンクから「{1}」に新しいリンクが追加されました。"),
        ["zh-Hans"] = new("新链接", "{0} 向「{1}」添加了新链接。", "合集「{1}」中添加了新链接。", "「{1}」中添加了 {2} 个链接。", "有人通过公开链接向「{1}」添加了新链接。"),
        ["zh-Hant"] = new("新連結", "{0} 在「{1}」新增了連結。", "合集「{1}」新增了連結。", "「{1}」新增了 {2} 個連結。", "有人透過公開連結在「{1}」新增了連結。"),
        ["es"] = new("Nuevo enlace", "{0} añadió un nuevo enlace a «{1}».", "Se añadió un nuevo enlace a la colección «{1}».", "Se añadieron {2} enlaces a «{1}».", "Se añadió un nuevo enlace a «{1}» a través de su enlace público."),
        ["fr"] = new("Nouveau lien", "{0} a ajouté un nouveau lien à « {1} ».", "Un nouveau lien a été ajouté à la collection « {1} ».", "{2} liens ont été ajoutés à « {1} ».", "Un nouveau lien a été ajouté à « {1} » via son lien public."),
        ["de"] = new("Neuer Link", "{0} hat „{1}“ einen neuen Link hinzugefügt.", "Der Sammlung „{1}“ wurde ein neuer Link hinzugefügt.", "„{1}“ wurden {2} Links hinzugefügt.", "„{1}“ wurde über den öffentlichen Link ein neuer Link hinzugefügt."),
        ["it"] = new("Nuovo link", "{0} ha aggiunto un nuovo link a «{1}».", "È stato aggiunto un nuovo link alla raccolta «{1}».", "Sono stati aggiunti {2} link a «{1}».", "È stato aggiunto un nuovo link a «{1}» tramite il link pubblico."),
        ["pt-BR"] = new("Novo link", "{0} adicionou um novo link a \"{1}\".", "Um novo link foi adicionado à coleção \"{1}\".", "{2} links foram adicionados a \"{1}\".", "Um novo link foi adicionado a \"{1}\" pelo link público."),
        ["vi"] = new("Liên kết mới", "{0} đã thêm một liên kết mới vào \"{1}\".", "Một liên kết mới đã được thêm vào bộ sưu tập \"{1}\".", "Đã thêm {2} liên kết vào \"{1}\".", "Một liên kết mới đã được thêm vào \"{1}\" qua liên kết công khai."),
        ["th"] = new("ลิงก์ใหม่", "{0} เพิ่มลิงก์ใหม่ใน \"{1}\"", "มีการเพิ่มลิงก์ใหม่ในคอลเลกชัน \"{1}\"", "มีการเพิ่มลิงก์ {2} รายการใน \"{1}\"", "มีการเพิ่มลิงก์ใหม่ใน \"{1}\" ผ่านลิงก์สาธารณะ"),
        ["id"] = new("Tautan baru", "{0} menambahkan tautan baru ke \"{1}\".", "Tautan baru ditambahkan ke koleksi \"{1}\".", "{2} tautan ditambahkan ke \"{1}\".", "Tautan baru ditambahkan ke \"{1}\" melalui tautan publik."),
        ["ru"] = new("Новая ссылка", "{0} добавляет новую ссылку в «{1}».", "В коллекцию «{1}» добавлена новая ссылка.", "В «{1}» добавлено ссылок: {2}.", "В «{1}» добавлена новая ссылка через публичную ссылку."),
        ["tr"] = new("Yeni bağlantı", "{0}, \"{1}\" koleksiyonuna yeni bir bağlantı ekledi.", "\"{1}\" koleksiyonuna yeni bir bağlantı eklendi.", "\"{1}\" koleksiyonuna {2} bağlantı eklendi.", "\"{1}\" koleksiyonuna herkese açık bağlantı üzerinden yeni bir bağlantı eklendi."),
        ["ar"] = new("رابط جديد", "أضاف {0} رابطًا جديدًا إلى \"{1}\".", "تمت إضافة رابط جديد إلى المجموعة \"{1}\".", "عدد الروابط المضافة إلى \"{1}\": {2}.", "تمت إضافة رابط جديد إلى \"{1}\" عبر الرابط العام."),
        ["hi"] = new("नया लिंक", "{0} ने \"{1}\" में नया लिंक जोड़ा है।", "\"{1}\" संग्रह में नया लिंक जोड़ा गया है।", "\"{1}\" में {2} लिंक जोड़े गए हैं।", "सार्वजनिक लिंक के ज़रिए \"{1}\" में नया लिंक जोड़ा गया है।"),
    };

    /// <summary>CollectionLinkShared: {0} = who passed the link on, {1} = Collection name.</summary>
    private sealed record LinkTexts(string Title, string Body);

    private static readonly Dictionary<string, LinkTexts> LinkByLocale = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ko"] = new("컬렉션 링크", "{0}님이 '{1}' 컬렉션 링크를 보냈어요."),
        ["en"] = new("Collection link", "{0} sent you a link to the collection \"{1}\"."),
        ["ja"] = new("コレクションのリンク", "{0}さんからコレクション「{1}」のリンクが届きました。"),
        ["zh-Hans"] = new("合集链接", "{0} 向你发送了合集「{1}」的链接。"),
        ["zh-Hant"] = new("合集連結", "{0} 傳送了合集「{1}」的連結給你。"),
        ["es"] = new("Enlace de colección", "{0} te envió el enlace de la colección «{1}»."),
        ["fr"] = new("Lien de collection", "{0} vous a envoyé le lien de la collection « {1} »."),
        ["de"] = new("Link zur Sammlung", "{0} hat dir den Link zur Sammlung „{1}“ gesendet."),
        ["it"] = new("Link della raccolta", "{0} ti ha inviato il link della raccolta «{1}»."),
        ["pt-BR"] = new("Link da coleção", "{0} enviou para você o link da coleção \"{1}\"."),
        ["vi"] = new("Liên kết bộ sưu tập", "{0} đã gửi cho bạn liên kết bộ sưu tập \"{1}\"."),
        ["th"] = new("ลิงก์คอลเลกชัน", "{0} ส่งลิงก์คอลเลกชัน \"{1}\" ให้คุณ"),
        ["id"] = new("Tautan koleksi", "{0} mengirimi Anda tautan koleksi \"{1}\"."),
        ["ru"] = new("Ссылка на коллекцию", "{0} отправляет вам ссылку на коллекцию «{1}»."),
        ["tr"] = new("Koleksiyon bağlantısı", "{0} size \"{1}\" koleksiyonunun bağlantısını gönderdi."),
        ["ar"] = new("رابط مجموعة", "أرسل إليك {0} رابط المجموعة \"{1}\"."),
        ["hi"] = new("संग्रह का लिंक", "{0} ने आपको \"{1}\" संग्रह का लिंक भेजा है।"),
    };

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

    /// <param name="itemCount">CollectionItemsAdded only: how many links the one operation added.</param>
    /// <param name="viaPublicLink">CollectionItemsAdded only: added through the public link - the adder is never named.</param>
    public static (string Title, string Body) For(
        NotificationType type, string? locale, string actorName, string collectionName, int itemCount = 1, bool viaPublicLink = false)
    {
        if (type == NotificationType.CollectionItemsAdded)
        {
            var items = Resolve(ItemsByLocale, locale);
            var body = itemCount > 1 ? items.Many
                : viaPublicLink ? items.Public
                : string.IsNullOrEmpty(actorName) ? items.One
                : items.By;
            return (items.Title, string.Format(CultureInfo.InvariantCulture, body, actorName, Shorten(collectionName), itemCount));
        }

        if (type == NotificationType.CollectionLinkShared)
        {
            var link = Resolve(LinkByLocale, locale);
            return (link.Title, string.Format(CultureInfo.InvariantCulture, link.Body, actorName, Shorten(collectionName)));
        }

        var texts = Resolve(ByLocale, locale);
        return type == NotificationType.CollectionInvitationReceived
            ? (texts.InviteTitle, string.Format(CultureInfo.InvariantCulture, texts.InviteBody, actorName, collectionName))
            : (texts.FriendTitle, string.Format(CultureInfo.InvariantCulture, texts.FriendBody, actorName));
    }

    /// <summary>Cut on whole user-perceived characters (never mid-emoji/surrogate pair), then "…".</summary>
    public static string Shorten(string collectionName)
    {
        var info = new StringInfo(collectionName);
        return info.LengthInTextElements <= CollectionNameMaxLength
            ? collectionName
            : info.SubstringByTextElements(0, CollectionNameMaxLength - 1).TrimEnd() + "…";
    }

    private static T Resolve<T>(Dictionary<string, T> byLocale, string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
        {
            return byLocale["en"];
        }

        if (byLocale.TryGetValue(locale, out var exact))
        {
            return exact;
        }

        var baseLanguage = locale.Split('-', '_')[0];
        if (BaseLanguageFallback.TryGetValue(baseLanguage, out var mapped))
        {
            return byLocale[mapped];
        }

        return byLocale.TryGetValue(baseLanguage, out var byBase) ? byBase : byLocale["en"];
    }
}
