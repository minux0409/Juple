/** UI notices only, never translated legal text or translation approval. Shared with Web by the consent generator. */
export const legalFallbackNotices = {
  ko: '선택한 언어로 승인된 번역이 없어 한국어 원문을 표시합니다.',
  en: 'An approved translation is not available in your selected language. The Korean original is shown.',
  ja: '選択した言語の承認済み翻訳がないため、韓国語の原文を表示しています。',
  'zh-Hans': '所选语言暂无获批准的译文，现显示韩语原文。',
  'zh-Hant': '所選語言暫無獲核准的譯文，現顯示韓語原文。',
  es: 'No hay una traducción aprobada en el idioma seleccionado. Se muestra el original en coreano.',
  fr: 'Aucune traduction approuvée n’est disponible dans la langue choisie. Le texte original coréen est affiché.',
  de: 'Für die gewählte Sprache liegt keine freigegebene Übersetzung vor. Das koreanische Original wird angezeigt.',
  it: 'Non è disponibile una traduzione approvata nella lingua selezionata. Viene mostrato l’originale coreano.',
  'pt-BR': 'Não há tradução aprovada no idioma selecionado. O original em coreano é exibido.',
  vi: 'Chưa có bản dịch được phê duyệt bằng ngôn ngữ đã chọn. Nội dung gốc tiếng Hàn được hiển thị.',
  th: 'ยังไม่มีคำแปลที่ได้รับอนุมัติในภาษาที่เลือก จึงแสดงต้นฉบับภาษาเกาหลี',
  id: 'Terjemahan yang disetujui belum tersedia dalam bahasa pilihan Anda. Teks asli bahasa Korea ditampilkan.',
  ru: 'Утверждённый перевод на выбранный язык недоступен. Показан оригинал на корейском языке.',
  tr: 'Seçilen dilde onaylanmış çeviri bulunmuyor. Korece özgün metin gösteriliyor.',
  ar: 'لا تتوفر ترجمة معتمدة باللغة المختارة. يُعرض النص الأصلي باللغة الكورية.',
  hi: 'चुनी गई भाषा में स्वीकृत अनुवाद उपलब्ध नहीं है। मूल कोरियाई पाठ दिखाया जा रहा है।',
} as const;
export type LegalLanguage = keyof typeof legalFallbackNotices;
export const legalAccountDeletionLabels: Record<LegalLanguage, string> = {
  ko: '계정 삭제 안내', en: 'Account deletion guide', ja: 'アカウント削除のご案内', 'zh-Hans': '账号删除指南', 'zh-Hant': '帳號刪除指南',
  es: 'Guía para eliminar la cuenta', fr: 'Guide de suppression du compte', de: 'Anleitung zur Kontolöschung', it: 'Guida all’eliminazione dell’account',
  'pt-BR': 'Guia de exclusão da conta', vi: 'Hướng dẫn xóa tài khoản', th: 'คำแนะนำการลบบัญชี', id: 'Panduan penghapusan akun',
  ru: 'Инструкция по удалению аккаунта', tr: 'Hesap silme rehberi', ar: 'دليل حذف الحساب', hi: 'खाता हटाने की मार्गदर्शिका',
};
export function legalLanguage(value: string | null | undefined): LegalLanguage {
  return value && Object.prototype.hasOwnProperty.call(legalFallbackNotices, value) ? value as LegalLanguage : 'en';
}
export function legalDocumentLink(url: string | null, language: string, version?: string): string | null {
  if (!url) return null;
  return `${url}${url.includes('?') ? '&' : '?'}language=${encodeURIComponent(legalLanguage(language))}${version ? `&version=${encodeURIComponent(version)}` : ''}`;
}
