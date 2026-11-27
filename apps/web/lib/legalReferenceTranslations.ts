import { legalLanguage, type LegalLanguage } from './legalDocumentPolicy.generated.ts';
import { type LegalBlock, type LegalDocument } from './legalContent.ts';
import { legalContentHash, selectLegalDocument } from './legalLocalization.ts';
import en from './legalReferenceTranslations/en.json' with { type: 'json' };
import ja from './legalReferenceTranslations/ja.json' with { type: 'json' };
import zhHans from './legalReferenceTranslations/zh-Hans.json' with { type: 'json' };
import zhHant from './legalReferenceTranslations/zh-Hant.json' with { type: 'json' };
import es from './legalReferenceTranslations/es.json' with { type: 'json' };
import fr from './legalReferenceTranslations/fr.json' with { type: 'json' };
import de from './legalReferenceTranslations/de.json' with { type: 'json' };
import it from './legalReferenceTranslations/it.json' with { type: 'json' };
import ptBR from './legalReferenceTranslations/pt-BR.json' with { type: 'json' };
import vi from './legalReferenceTranslations/vi.json' with { type: 'json' };
import th from './legalReferenceTranslations/th.json' with { type: 'json' };
import id from './legalReferenceTranslations/id.json' with { type: 'json' };
import ru from './legalReferenceTranslations/ru.json' with { type: 'json' };
import tr from './legalReferenceTranslations/tr.json' with { type: 'json' };
import ar from './legalReferenceTranslations/ar.json' with { type: 'json' };
import hi from './legalReferenceTranslations/hi.json' with { type: 'json' };

/**
 * REFERENCE translations of the three legal pages - readable in the reader's language, never the legal original and never approved:
 * they carry no review record, are always shown under a notice that the Korean original governs, and are not consent texts (agreeing
 * to the Terms still happens on the approved document only - selectLegalDocument / the backend's PublishedTerms). Each one is bound to
 * the exact Korean text it was translated from (slug, version date and the content hash of the rendered original): when the original
 * changes - a new version, an edited sentence or different operator details - the translation stops matching and the page shows the
 * Korean original with the ordinary fallback notice instead of an outdated translation.
 *
 * File shape: per document the strings of the original in reading order (title, description, intro, then per section its title and
 * each paragraph / list item), translated one to one; plus the operator-fact labels (the values - names, registration numbers - stay
 * as registered).
 */
interface ReferenceDocumentEntry {
  readonly version: string;
  readonly sourceContentHash: string;
  readonly strings: readonly string[];
}
interface ReferenceFile {
  readonly language: string;
  readonly status: string;
  readonly documents: Readonly<Record<string, ReferenceDocumentEntry>>;
  readonly factLabels: Readonly<Record<string, string>>;
}

const FILES: Partial<Record<LegalLanguage, ReferenceFile>> = {
  en, ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant, es, fr, de, it, 'pt-BR': ptBR, vi, th, id, ru, tr, ar, hi,
};

/** The strings of a document in the order the reference files list them. */
export function legalDocumentStrings(doc: Pick<LegalDocument, 'title' | 'description' | 'intro' | 'sections'>): string[] {
  return [doc.title, doc.description, doc.intro, ...doc.sections.flatMap(section => [section.title, ...section.blocks.flatMap(block => (block.kind === 'p' ? [block.text] : [...block.items]))])];
}

const boldMarkers = (text: string) => text.split('**').length - 1;

/** The original's structure with the translated strings - or null when the entry does not fit the original exactly. */
function rebuild(original: LegalDocument, strings: readonly string[]): LegalDocument | null {
  const source = legalDocumentStrings(original);
  if (strings.length !== source.length || strings.some((text, index) => typeof text !== 'string' || !text.trim() || boldMarkers(text) !== boldMarkers(source[index]))) {
    return null;
  }
  let next = 0;
  const take = () => strings[next++];
  const title = take();
  const description = take();
  const intro = take();
  const sections = original.sections.map(section => ({
    id: section.id,
    title: take(),
    blocks: section.blocks.map((block): LegalBlock => (block.kind === 'p' ? { kind: 'p', text: take() } : { kind: block.kind, items: block.items.map(() => take()) })),
  }));
  return { slug: original.slug, updated: original.updated, title, description, intro, sections };
}

export function referenceTranslation(original: LegalDocument, requested: string): LegalDocument | null {
  const language = legalLanguage(requested);
  const entry = language === 'ko' ? undefined : FILES[language]?.documents[original.slug];
  if (!entry || entry.version !== original.updated || entry.sourceContentHash !== legalContentHash(original)) {
    return null;
  }
  return rebuild(original, entry.strings);
}

export function referenceFactLabel(label: string, requested: string): string {
  const language = legalLanguage(requested);
  return (language === 'ko' ? undefined : FILES[language]?.factLabels[label]) ?? label;
}

export interface LegalPageSelection {
  readonly doc: LegalDocument;
  /** The language the shown text is in. */
  readonly language: string;
  readonly requestedLanguage: LegalLanguage;
  /** Korean original shown because no text exists in the requested language. */
  readonly fallback: boolean;
  /** A reference translation is shown: the Korean original governs (the page says so and links to it). */
  readonly reference: boolean;
}

/** Approved translation, else the reference translation, else the Korean original with the fallback notice. */
export function selectLegalPage(original: LegalDocument, requested: string): LegalPageSelection {
  const approved = selectLegalDocument(original, requested);
  if (!approved.fallback) {
    return { doc: approved.doc, language: approved.language, requestedLanguage: approved.requestedLanguage, fallback: false, reference: false };
  }
  const reference = referenceTranslation(original, approved.requestedLanguage);
  if (reference) {
    return { doc: reference, language: approved.requestedLanguage, requestedLanguage: approved.requestedLanguage, fallback: false, reference: true };
  }
  return { doc: approved.doc, language: approved.language, requestedLanguage: approved.requestedLanguage, fallback: approved.fallback, reference: false };
}

/** The notice above a reference translation and its link back to the Korean original. */
export const legalReferenceNotices: Record<Exclude<LegalLanguage, 'ko'>, { readonly notice: string; readonly viewOriginal: string }> = {
  en: { notice: 'This is a reference translation provided for convenience. It has not been approved as an official text. The Korean original is the legally binding version and prevails if the two differ.', viewOriginal: 'View the Korean original' },
  ja: { notice: 'これは便宜のために提供する参考訳であり、公式に承認された文書ではありません。法的効力を持つのは韓国語の原文であり、両者に相違がある場合は韓国語の原文が優先します。', viewOriginal: '韓国語の原文を見る' },
  'zh-Hans': { notice: '本译文仅供参考，未经正式批准，不是官方文本。具有法律效力的是韩语原文；如两者有出入，以韩语原文为准。', viewOriginal: '查看韩语原文' },
  'zh-Hant': { notice: '本譯文僅供參考，未經正式核准，並非官方文本。具法律效力的是韓語原文；如兩者有出入，以韓語原文為準。', viewOriginal: '查看韓語原文' },
  es: { notice: 'Esta es una traducción de referencia ofrecida por comodidad. No ha sido aprobada como texto oficial. El original en coreano es la versión jurídicamente vinculante y prevalece en caso de discrepancia.', viewOriginal: 'Ver el original en coreano' },
  fr: { notice: 'Ceci est une traduction de référence fournie à titre indicatif. Elle n’a pas été approuvée comme texte officiel. L’original coréen fait foi et prévaut en cas de divergence.', viewOriginal: 'Voir l’original coréen' },
  de: { notice: 'Dies ist eine Referenzübersetzung, die nur zur Orientierung dient. Sie wurde nicht als offizieller Text freigegeben. Rechtlich verbindlich ist das koreanische Original; bei Abweichungen hat es Vorrang.', viewOriginal: 'Koreanisches Original ansehen' },
  it: { notice: 'Questa è una traduzione di riferimento fornita per comodità. Non è stata approvata come testo ufficiale. L’originale coreano è la versione giuridicamente vincolante e prevale in caso di differenze.', viewOriginal: 'Vedi l’originale coreano' },
  'pt-BR': { notice: 'Esta é uma tradução de referência oferecida por conveniência. Ela não foi aprovada como texto oficial. O original em coreano é a versão juridicamente vinculante e prevalece em caso de divergência.', viewOriginal: 'Ver o original em coreano' },
  vi: { notice: 'Đây là bản dịch tham khảo được cung cấp để tiện theo dõi, chưa được phê duyệt là văn bản chính thức. Bản gốc tiếng Hàn là văn bản có giá trị pháp lý và được ưu tiên áp dụng nếu có khác biệt.', viewOriginal: 'Xem bản gốc tiếng Hàn' },
  th: { notice: 'นี่คือคำแปลเพื่อการอ้างอิงที่จัดทำขึ้นเพื่อความสะดวก และยังไม่ได้รับอนุมัติให้เป็นข้อความอย่างเป็นทางการ ต้นฉบับภาษาเกาหลีเป็นฉบับที่มีผลทางกฎหมาย และให้ถือตามต้นฉบับภาษาเกาหลีหากมีความแตกต่างกัน', viewOriginal: 'ดูต้นฉบับภาษาเกาหลี' },
  id: { notice: 'Ini adalah terjemahan referensi yang disediakan untuk kemudahan dan belum disetujui sebagai teks resmi. Teks asli berbahasa Korea adalah versi yang mengikat secara hukum dan berlaku jika terdapat perbedaan.', viewOriginal: 'Lihat teks asli bahasa Korea' },
  ru: { notice: 'Это справочный перевод, предоставленный для удобства. Он не утверждён как официальный текст. Юридическую силу имеет оригинал на корейском языке; при расхождениях преимущество имеет он.', viewOriginal: 'Открыть оригинал на корейском' },
  tr: { notice: 'Bu, kolaylık sağlamak için sunulan bir referans çevirisidir ve resmi metin olarak onaylanmamıştır. Hukuken bağlayıcı olan Korece özgün metindir; aralarında fark olması hâlinde Korece metin esas alınır.', viewOriginal: 'Korece özgün metni görüntüle' },
  ar: { notice: 'هذه ترجمة مرجعية مقدَّمة للتيسير، ولم تُعتمد بوصفها نصًا رسميًا. النص الأصلي باللغة الكورية هو النسخة الملزمة قانونًا، ويُعتدّ به عند وجود أي اختلاف.', viewOriginal: 'عرض النص الأصلي باللغة الكورية' },
  hi: { notice: 'यह सुविधा के लिए दिया गया संदर्भ अनुवाद है और इसे आधिकारिक पाठ के रूप में स्वीकृत नहीं किया गया है। कानूनी रूप से बाध्यकारी मूल कोरियाई पाठ है, और दोनों में अंतर होने पर कोरियाई मूल पाठ मान्य होगा।', viewOriginal: 'मूल कोरियाई पाठ देखें' },
};
