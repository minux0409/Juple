import type { AppLanguage } from './appI18n.ts';

/**
 * Web-only strings of the Web renewal (the collapsible side bar, the selection hint, the membership plans block), written in every
 * one of the 17 languages - unlike the older Web-only strings (Korean / English, appDictionary.ts), a new Web-only string is never left
 * to fall back to English. Strings the mobile app already has are NOT here: they come from the mobile locale files
 * (appI18nMobileKeys.ts).
 */
export interface RenewalStrings {
  /** The side bar's own button (collapse it to icons / expand it again). */
  readonly sidebarCollapse: string;
  readonly sidebarExpand: string;
  /** The tooltip of a card's selection check: what a click and a Shift+click do. */
  readonly selectionToggleHint: string;
  /** 멤버십: the heading of the two plans (monthly / yearly) that the apps sell. */
  readonly membershipPlansHeading: string;
  /** 멤버십: why no price is shown on the Web (prices come from each store, inside the app). */
  readonly membershipPlansInAppNote: string;
}

export const RENEWAL_STRINGS: Readonly<Record<AppLanguage, RenewalStrings>> = {
  ko: {
    sidebarCollapse: '사이드바 접기',
    sidebarExpand: '사이드바 펼치기',
    selectionToggleHint: '선택 · Shift+클릭으로 범위 선택',
    membershipPlansHeading: '멤버십 플랜',
    membershipPlansInAppNote: '가격은 Juple 앱에서 이용 중인 스토어(Google Play, App Store) 기준으로 표시돼요.',
  },
  en: {
    sidebarCollapse: 'Collapse sidebar',
    sidebarExpand: 'Expand sidebar',
    selectionToggleHint: 'Select · Shift+click to select a range',
    membershipPlansHeading: 'Membership plans',
    membershipPlansInAppNote: 'Prices are shown in the Juple app, from your store (Google Play or the App Store).',
  },
  ja: {
    sidebarCollapse: 'サイドバーを折りたたむ',
    sidebarExpand: 'サイドバーを展開',
    selectionToggleHint: '選択 · Shift+クリックで範囲選択',
    membershipPlansHeading: 'メンバーシッププラン',
    membershipPlansInAppNote: '価格はJupleアプリで、ご利用のストア（Google Play、App Store）に基づいて表示されます。',
  },
  'zh-Hans': {
    sidebarCollapse: '收起侧边栏',
    sidebarExpand: '展开侧边栏',
    selectionToggleHint: '选择 · Shift+点击可选择范围',
    membershipPlansHeading: '会员方案',
    membershipPlansInAppNote: '价格会在 Juple 应用中按你使用的商店（Google Play、App Store）显示。',
  },
  'zh-Hant': {
    sidebarCollapse: '收合側邊欄',
    sidebarExpand: '展開側邊欄',
    selectionToggleHint: '選取 · Shift+點按可選取範圍',
    membershipPlansHeading: '會員方案',
    membershipPlansInAppNote: '價格會在 Juple 應用程式中依你使用的商店（Google Play、App Store）顯示。',
  },
  es: {
    sidebarCollapse: 'Contraer barra lateral',
    sidebarExpand: 'Expandir barra lateral',
    selectionToggleHint: 'Seleccionar · Mayús+clic para seleccionar un rango',
    membershipPlansHeading: 'Planes de membresía',
    membershipPlansInAppNote: 'Los precios se muestran en la app de Juple, según tu tienda (Google Play o App Store).',
  },
  fr: {
    sidebarCollapse: 'Réduire la barre latérale',
    sidebarExpand: 'Développer la barre latérale',
    selectionToggleHint: 'Sélectionner · Maj+clic pour sélectionner une plage',
    membershipPlansHeading: "Formules d'abonnement",
    membershipPlansInAppNote: "Les prix sont affichés dans l'app Juple, selon votre boutique (Google Play ou App Store).",
  },
  de: {
    sidebarCollapse: 'Seitenleiste einklappen',
    sidebarExpand: 'Seitenleiste ausklappen',
    selectionToggleHint: 'Auswählen · Umschalt+Klick wählt einen Bereich',
    membershipPlansHeading: 'Mitgliedschaftspläne',
    membershipPlansInAppNote: 'Die Preise werden in der Juple-App angezeigt, je nach deinem Store (Google Play oder App Store).',
  },
  it: {
    sidebarCollapse: 'Comprimi barra laterale',
    sidebarExpand: 'Espandi barra laterale',
    selectionToggleHint: 'Seleziona · Maiusc+clic per selezionare un intervallo',
    membershipPlansHeading: 'Piani di abbonamento',
    membershipPlansInAppNote: "I prezzi sono mostrati nell'app Juple, in base al tuo store (Google Play o App Store).",
  },
  'pt-BR': {
    sidebarCollapse: 'Recolher barra lateral',
    sidebarExpand: 'Expandir barra lateral',
    selectionToggleHint: 'Selecionar · Shift+clique para selecionar um intervalo',
    membershipPlansHeading: 'Planos de assinatura',
    membershipPlansInAppNote: 'Os preços aparecem no app Juple, de acordo com a sua loja (Google Play ou App Store).',
  },
  vi: {
    sidebarCollapse: 'Thu gọn thanh bên',
    sidebarExpand: 'Mở rộng thanh bên',
    selectionToggleHint: 'Chọn · Shift+nhấp để chọn một dải',
    membershipPlansHeading: 'Gói thành viên',
    membershipPlansInAppNote: 'Giá được hiển thị trong ứng dụng Juple, theo cửa hàng bạn dùng (Google Play hoặc App Store).',
  },
  th: {
    sidebarCollapse: 'ยุบแถบด้านข้าง',
    sidebarExpand: 'ขยายแถบด้านข้าง',
    selectionToggleHint: 'เลือก · Shift+คลิกเพื่อเลือกเป็นช่วง',
    membershipPlansHeading: 'แพ็กเกจสมาชิก',
    membershipPlansInAppNote: 'ราคาจะแสดงในแอป Juple ตามสโตร์ที่คุณใช้ (Google Play หรือ App Store)',
  },
  id: {
    sidebarCollapse: 'Ciutkan bilah samping',
    sidebarExpand: 'Luaskan bilah samping',
    selectionToggleHint: 'Pilih · Shift+klik untuk memilih rentang',
    membershipPlansHeading: 'Paket keanggotaan',
    membershipPlansInAppNote: 'Harga ditampilkan di aplikasi Juple, sesuai toko Anda (Google Play atau App Store).',
  },
  ru: {
    sidebarCollapse: 'Свернуть боковую панель',
    sidebarExpand: 'Развернуть боковую панель',
    selectionToggleHint: 'Выбрать · Shift+щелчок — выбрать диапазон',
    membershipPlansHeading: 'Тарифы подписки',
    membershipPlansInAppNote: 'Цены показываются в приложении Juple — по данным вашего магазина (Google Play или App Store).',
  },
  tr: {
    sidebarCollapse: 'Kenar çubuğunu daralt',
    sidebarExpand: 'Kenar çubuğunu genişlet',
    selectionToggleHint: 'Seç · Aralık seçmek için Shift+tıklayın',
    membershipPlansHeading: 'Üyelik planları',
    membershipPlansInAppNote: "Fiyatlar Juple uygulamasında, kullandığınız mağazaya göre (Google Play veya App Store) gösterilir.",
  },
  ar: {
    sidebarCollapse: 'طي الشريط الجانبي',
    sidebarExpand: 'توسيع الشريط الجانبي',
    selectionToggleHint: 'تحديد · Shift+نقرة لتحديد نطاق',
    membershipPlansHeading: 'خطط العضوية',
    membershipPlansInAppNote: 'تظهر الأسعار في تطبيق Juple حسب متجرك (Google Play أو App Store).',
  },
  hi: {
    sidebarCollapse: 'साइडबार छोटा करें',
    sidebarExpand: 'साइडबार बड़ा करें',
    selectionToggleHint: 'चुनें · रेंज चुनने के लिए Shift+क्लिक करें',
    membershipPlansHeading: 'सदस्यता प्लान',
    membershipPlansInAppNote: 'कीमतें Juple ऐप में आपके स्टोर (Google Play या App Store) के अनुसार दिखाई जाती हैं।',
  },
};
