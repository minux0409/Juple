import type { LegalOperatorConfig } from './legalConfig.ts';

/**
 * The text of the three public legal pages. It describes only what the product does today (see docs/data-retention.md and
 * docs/legal/*.draft.md) and carries no placeholder: anything that is not decided or approved yet (operator name, business
 * registration, address, mailboxes) is omitted by the helpers below instead of being invented. The retention periods here must stay
 * equal to RetentionOptions in the backend.
 */
export type LegalBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'ul' | 'ol'; readonly items: readonly string[] };

export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  readonly slug: 'privacy' | 'terms' | 'account-deletion';
  readonly title: string;
  readonly description: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}

export const LEGAL_PATHS = ['/privacy', '/terms', '/account-deletion'] as const;

const p = (text: string): LegalBlock => ({ kind: 'p', text });
const ul = (...items: string[]): LegalBlock => ({ kind: 'ul', items });
const ol = (...items: string[]): LegalBlock => ({ kind: 'ol', items });

/** Only the operator facts that are really configured, in display order. */
export function operatorFacts(config: LegalOperatorConfig): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [{ label: '서비스', value: config.serviceName }];
  if (config.operatorName) {
    facts.push({ label: '운영자', value: config.operatorName });
  }
  if (config.representativeName) {
    facts.push({ label: '대표자', value: config.representativeName });
  }
  if (config.businessRegistrationNumber) {
    facts.push({ label: '사업자등록번호', value: config.businessRegistrationNumber });
  }
  if (config.ecommerceRegistrationNumber) {
    const authority = config.ecommerceRegistrationAuthority ? ` (${config.ecommerceRegistrationAuthority})` : '';
    facts.push({ label: '통신판매업 신고번호', value: `${config.ecommerceRegistrationNumber}${authority}` });
  }
  if (config.businessAddress) {
    facts.push({ label: '사업장 주소', value: config.businessAddress });
  }
  return facts;
}

/**
 * Wording that needs a legal decision before it can be published. Each is a FIXED policy text (code, not configuration) and is left
 * out of the pages while it is null - never a placeholder. A launch needs both reviewed and filled in (docs/production-bring-up.md, step 0 - legal review):
 *
 * - overseasTransfers: the 국외 이전 notice - per recipient the country, when and how the data moves and how long it is kept. The parts
 *   the code itself establishes (who, what, why) are already published in "제3자와 처리 위탁" below.
 * - minorsPolicy: whether and how Juple serves people under 14 (the app has no age check or guardian consent today).
 */
export interface OverseasTransferNotice {
  readonly recipient: string;
  readonly country: string;
  readonly items: string;
  readonly purpose: string;
  readonly whenAndHow: string;
  readonly retention: string;
}

export const REVIEWED_LEGAL_TEXT: {
  readonly overseasTransfers: readonly OverseasTransferNotice[] | null;
  readonly minorsPolicy: readonly string[] | null;
} = {
  overseasTransfers: null,
  minorsPolicy: null,
};

/** The reviewed texts that are still missing - empty means the pages are complete for a launch. */
export function pendingLegalReview(): ('overseasTransfers' | 'minorsPolicy')[] {
  const pending: ('overseasTransfers' | 'minorsPolicy')[] = [];
  if (!REVIEWED_LEGAL_TEXT.overseasTransfers?.length) {
    pending.push('overseasTransfers');
  }
  if (!REVIEWED_LEGAL_TEXT.minorsPolicy?.length) {
    pending.push('minorsPolicy');
  }
  return pending;
}

function overseasTransferSection(): LegalSection[] {
  const notices = REVIEWED_LEGAL_TEXT.overseasTransfers;
  if (!notices?.length) {
    return [];
  }
  return [
    {
      id: 'overseas-transfer',
      title: '국외 이전',
      blocks: notices.flatMap(notice => [
        p(`**${notice.recipient}**`),
        ul(
          `이전 국가: ${notice.country}`,
          `이전 항목: ${notice.items}`,
          `이전 목적: ${notice.purpose}`,
          `이전 일시와 방법: ${notice.whenAndHow}`,
          `보유·이용 기간: ${notice.retention}`,
        ),
      ]),
    },
  ];
}

function minorsSection(): LegalSection[] {
  const text = REVIEWED_LEGAL_TEXT.minorsPolicy;
  return text?.length ? [{ id: 'minors', title: '만 14세 미만 아동', blocks: text.map(p) }] : [];
}

function privacyOfficerSection(config: LegalOperatorConfig): LegalSection[] {
  if (!config.privacyOfficerName) {
    return [];
  }
  const name = config.privacyOfficerTitle ? `${config.privacyOfficerName} (${config.privacyOfficerTitle})` : config.privacyOfficerName;
  return [
    {
      id: 'privacy-officer',
      title: '개인정보 보호책임자',
      blocks: [
        p('개인정보 처리에 관한 문의, 불만 처리, 피해 구제는 아래 보호책임자에게 요청할 수 있습니다.'),
        ul(`성명: ${name}`, ...(config.privacyOfficerEmail ? [`연락처: ${config.privacyOfficerEmail}`] : [])),
      ],
    },
  ];
}

/** Numbers the privacy policy's sections in order, so a section that is left out never leaves a gap. */
function numbered(sections: readonly LegalSection[]): LegalSection[] {
  return sections.map((section, index) => ({ ...section, title: `${index + 1}. ${section.title}` }));
}

function contactBlocks(config: LegalOperatorConfig, kind: 'general' | 'privacy'): LegalBlock[] {
  const email = kind === 'privacy' ? (config.privacyEmail ?? config.supportEmail) : config.supportEmail;
  const blocks: LegalBlock[] = [p('앱의 **내 페이지 > 고객센터**에서 문의를 남길 수 있으며, 답변은 같은 화면에서 확인할 수 있습니다.')];
  if (email) {
    blocks.push(p(`이메일로도 문의할 수 있습니다: ${email}`));
  }
  return blocks;
}

export function privacyDocument(config: LegalOperatorConfig): LegalDocument {
  return {
    slug: 'privacy',
    title: '개인정보처리방침',
    description: 'Juple이 처리하는 정보, 이용 목적, 보관 기간, 계정 삭제 시 처리 방법을 안내합니다.',
    intro:
      'Juple은 링크를 저장하고 컬렉션으로 정리·공유하는 서비스입니다. 이 방침은 Juple 앱과 공유 링크용 웹 페이지에서 처리하는 정보와 그 보관·삭제 방법을 설명합니다. 광고 목적의 행동 추적을 하지 않으며 개인정보를 판매하지 않습니다.',
    sections: numbered([
      {
        id: 'collected',
        title: '처리하는 정보',
        blocks: [
          p('**계정과 로그인**'),
          ul(
            '회원 가입과 로그인은 이메일 주소와 비밀번호로 하며, Microsoft Entra External ID를 통해 이루어집니다. Juple 서버는 Microsoft Entra External ID가 부여한 식별 값(테넌트·사용자 식별자)만 계정과 연결하며, 이메일 주소·비밀번호는 Juple 서버에 저장하지 않습니다. 이메일 주소와 비밀번호는 Microsoft Entra External ID가 처리합니다.',
            'Juple이 만드는 값: 무작위 Juple ID. 이용자가 입력하는 값: 닉네임(선택), 프로필 사진(선택). 언어와 시간대 설정.',
          ),
          p('**직접 저장하거나 입력하는 콘텐츠**'),
          ul(
            '저장한 링크의 주소, 제목, 메모, 미리보기 이미지 주소, 직접 올린 사진.',
            '컬렉션의 이름·아이콘·색·사진, 컬렉션 잠금 비밀번호(복원할 수 없는 해시로 저장), 공유 접근 비밀번호.',
            '친구와 친구 요청, 친구에게 남기는 비공개 메모, 컬렉션 초대·참가 요청, 댓글, 좋아요, 이모지 반응.',
            '고객센터 문의 내용과 답변.',
            '최근 연 링크 기록.',
          ),
          p('**서비스 안전(신고·차단·약관 동의)**'),
          ul(
            '이용약관 동의 기록: 동의한 약관 버전과 동의 시각.',
            '신고: 신고한 사람, 신고 대상(사용자·컬렉션·링크·댓글), 신고 사유와 이용자가 덧붙인 설명, 처리 상태와 처리 결과.',
            '차단 관계: 누가 누구를 차단했는지.',
          ),
          p('**링크 정보 확인**: 링크를 저장하면 제목과 대표 이미지를 확인하기 위해 해당 주소의 공개된 페이지에 접속할 수 있습니다. 확인할 수 없는 정보는 추측하지 않고 직접 입력하도록 합니다.'),
          p('**공유와 협업**: 컬렉션을 공유하면 참여자는 그 컬렉션과 안의 링크, 제목, 링크를 추가한 사람의 닉네임 또는 Juple ID, 프로필 사진을 볼 수 있습니다. 공개 링크를 켜면 링크를 아는 누구나 컬렉션 이름과 링크의 제목·주소·자동 미리보기를 볼 수 있으며, 메모·업로드한 사진·추가한 사람은 공개되지 않습니다. 공유 비밀번호를 설정할 수 있습니다.'),
          p('**푸시 알림**: 알림을 받으려면 기기 식별 값(앱 설치 ID), 푸시 토큰, 언어를 서버에 등록합니다. 푸시 전송에는 Google Firebase Cloud Messaging을 사용합니다. 알림 기록은 앱 안의 알림 목록에 저장됩니다.'),
          p('**구독 결제(Google Play)**: 결제는 Google Play가 처리하며 Juple은 카드 정보를 받지 않습니다. 구독 기능을 사용하면 구독 확인과 복원을 위해 구매 토큰(암호화하여 저장), 상품, 상태, 만료일 등을 처리합니다. 무료 이용 기간의 중복 적용을 막기 위해, 로그인 식별 값과 로그인 이메일 주소를 정해진 방식으로 정리한 뒤 원래 값으로 되돌릴 수 없게 바꾼 변환값(해시)과 이용 기간을 저장합니다. 이 기록에는 이메일 주소 자체를 저장하지 않습니다.'),
          p('**운영 로그와 진단 정보**: 서비스의 안정성, 보안, 장애 대응을 위해 요청 처리 결과, 오류, 내부 식별자 등이 담긴 운영 로그와 진단 정보를 처리할 수 있습니다. 로그에는 비밀번호나 결제 토큰을 남기지 않습니다.'),
        ],
      },
      {
        id: 'purpose',
        title: '이용 목적',
        blocks: [
          ul(
            '링크 저장, 정리, 공유, 협업, 알림 등 서비스 제공',
            '계정 확인과 부정 이용 방지 등 보안',
            '서비스 안전: 신고 접수와 검토, 정책 위반 대응, 이용자 보호, 이용약관 동의 증빙',
            '구독 확인, 복원, 무료 이용 기간 관리',
            '고객 문의 대응',
            '서비스 안정성 확인과 장애 대응',
          ),
        ],
      },
      {
        id: 'third-parties',
        title: '제3자와 처리 위탁',
        blocks: [
          p('서비스 제공을 위해 다음 사업자의 서비스를 이용하며, 각 사업자는 아래 목적의 범위에서 정보를 처리합니다.'),
          ul(
            'Microsoft(Microsoft Entra External ID): 회원 가입·로그인과 본인 확인. 로그인에 쓰는 이메일 주소와 비밀번호, 로그인 식별자를 처리합니다. 계정 삭제를 요청하면 Juple에서 쓰던 로그인 계정의 삭제도 함께 처리합니다.',
            'Microsoft(Azure): 서버, 데이터베이스, 파일 저장소, 운영 로그의 호스팅. 이 방침의 1항 정보를 저장·처리합니다(대한민국 리전).',
            'Google(Firebase Cloud Messaging): 푸시 알림 전송. 푸시 토큰과 알림 내용을 처리합니다.',
            'Google(Google Play): 구독 결제, 갱신, 해지, 환불. 결제 정보는 Google Play가 처리하며, Juple은 구독 확인을 위해 구매 토큰과 구독 상태를 Google Play에 조회합니다.',
            '이용자가 저장한 링크의 공개 웹사이트: 제목·이미지를 확인할 때 접속',
          ),
          p('개인정보를 판매하거나 광고 목적으로 제공하지 않습니다.'),
        ],
      },
      ...overseasTransferSection(),
      {
        id: 'retention',
        title: '보관 기간과 삭제',
        blocks: [
          p('이용자가 계정을 유지하는 동안 위 정보를 보관하며, 링크·컬렉션·사진·댓글을 직접 삭제하면 해당 정보가 삭제됩니다. 일부 정보는 아래 기간 동안 보관한 뒤 자동으로 삭제됩니다.'),
          ul(
            '삭제한 링크(삭제 이력): 삭제 후 30일까지, 사용자당 최대 100개',
            '삭제한 컬렉션과 병합 되돌리기 기록: 삭제 후 30일',
            '앱 내 알림 기록: 생성 후 90일',
            '푸시 알림용 기기 토큰: 마지막 사용 후 180일',
            '결제 알림 처리 기록: 처리 후 90일',
            '운영 로그: 최대 30일',
            '구독 구매 기록: 암호화된 구매 값은 구독 종료 후 180일, 구매 식별 해시와 상태·날짜 등 최소 정보는 구독 종료 후 최대 5년 이내에 삭제합니다.',
            '무료 이용 기간 중복 방지용 해시와 이용 기간: 이용 기간 종료 후 24개월(진행 중인 기간의 기록은 삭제하지 않음)',
            '차단 관계: 차단을 해제하거나 관련된 어느 한쪽의 계정이 삭제될 때까지',
            '이용약관 동의 기록: 계정을 유지하는 동안(계정 삭제 시 함께 삭제)',
            '신고 기록: 신고 처리가 끝난 뒤에도 서비스 안전과 정책 위반 대응에 필요한 범위에서 보관할 수 있습니다.',
          ),
        ],
      },
      {
        id: 'account-deletion',
        title: '계정 삭제 시 처리',
        blocks: [
          p('앱에서 직접 계정을 삭제할 수 있습니다(계정 삭제 안내 페이지 참고). 계정을 삭제하면 프로필, 링크, 컬렉션, 사진, 친구, 알림, 문의, 댓글 등이 삭제됩니다. 다음 정보는 계정과 분리된 상태로 위 보관 기간 동안 남을 수 있습니다.'),
          ul(
            '구독 구매 기록(프로필과 분리): 결제 확인과 복원, 토큰 재사용 방지를 위한 최소 정보',
            '무료 이용 기간 중복 방지용 해시와 이용 기간',
            '신고 기록: 신고한 사람과 신고 대상자의 식별 값은 계정 삭제 시 제거되어 계정과 연결되지 않은 상태로 남을 수 있음',
            '운영 로그(최대 30일)',
          ),
          p('계정 삭제를 요청하면 Juple 서비스에 사용하던 Microsoft Entra External ID 로그인 계정(이메일 주소 등 로그인 정보)의 삭제 절차도 함께 진행됩니다. 삭제가 끝나면 그 이메일 주소와 비밀번호로 다시 로그인할 수 없으며, 같은 이메일 주소로 새로 가입하는 것은 가능합니다.'),
          p('계정을 삭제해도 Google Play 구독은 자동으로 해지되지 않습니다. 먼저 Google Play에서 구독을 해지해 주세요.'),
        ],
      },
      {
        id: 'rights',
        title: '이용자의 권리',
        blocks: [
          p('프로필 편집, 콘텐츠 삭제, 계정 삭제 등으로 앱에서 직접 정보를 확인·수정·삭제할 수 있으며, 그 밖의 열람·정정·삭제·처리정지 요청은 아래 문의 방법으로 할 수 있습니다.'),
        ],
      },
      ...minorsSection(),
      {
        id: 'security',
        title: '보안',
        blocks: [
          p('전송 구간을 암호화하고, 잠금·공유 비밀번호는 해시로, 구매 토큰은 암호화하여 저장합니다. 서버는 모든 요청에서 데이터 소유권을 확인합니다.'),
        ],
      },
      ...privacyOfficerSection(config),
      {
        id: 'changes',
        title: '방침의 변경',
        blocks: [p('방침이 바뀌면 이 페이지에 게시하며, 중요한 변경은 앱에서도 안내합니다. 이 페이지 상단에 최종 수정일을 표시합니다.')],
      },
      {
        id: 'contact',
        title: '문의',
        blocks: contactBlocks(config, 'privacy'),
      },
    ]),
  };
}

export function termsDocument(config: LegalOperatorConfig): LegalDocument {
  return {
    slug: 'terms',
    title: '이용약관',
    description: 'Juple 서비스 이용 조건, 콘텐츠와 공유, 무료 이용 기간·구독, 계정 삭제에 대한 약관입니다.',
    intro: '이 약관은 Juple 앱과 공유 링크용 웹 페이지의 이용 조건을 설명합니다. 서비스를 이용하면 이 약관에 따르는 것으로 봅니다.',
    sections: [
      {
        id: 'service',
        title: '1. 서비스',
        blocks: [
          p('Juple은 링크를 빠르게 저장하고, 오늘 저장한 링크와 전체 기록으로 다시 보고, 컬렉션으로 정리하고, 다른 사람과 공유·협업할 수 있는 서비스입니다. 구매 기록과 반복 구매 관리는 필요한 이용자를 위한 선택 기능입니다.'),
        ],
      },
      {
        id: 'accounts',
        title: '2. 계정',
        blocks: [
          ul(
            '계정은 이메일 주소와 비밀번호로 만들며(로그인은 Microsoft Entra External ID를 통해 이루어집니다), 이메일 계정과 비밀번호의 보안은 이용자가 관리합니다.',
            '계정은 이용자 본인만 사용할 수 있습니다.',
            '이용자는 앱에서 언제든 계정을 삭제할 수 있으며, 삭제되는 범위는 개인정보처리방침과 계정 삭제 안내에 따릅니다.',
          ),
        ],
      },
      {
        id: 'content',
        title: '3. 이용자 콘텐츠',
        blocks: [
          ul(
            '저장한 링크, 메모, 사진, 컬렉션 등은 이용자의 것이며, Juple은 서비스를 제공하는 데 필요한 범위에서만 저장·표시·전송합니다.',
            '이용자는 자신이 저장·공유하는 콘텐츠에 대한 권리와 책임이 있습니다. Juple은 링크가 가리키는 외부 콘텐츠를 보증하지 않습니다.',
          ),
        ],
      },
      {
        id: 'sharing',
        title: '4. 공유와 협업',
        blocks: [
          ul(
            '컬렉션 소유자는 초대, 참여 승인, 공개 링크, 비밀번호, 참여자 권한(읽기 전용 / 승인 후 추가 / 링크 추가)을 정합니다. 공개 링크를 아는 사람은 공개된 범위의 내용을 볼 수 있습니다.',
            '소유자는 참여자를 제거하거나 공유를 중지할 수 있습니다. 소유자가 계정을 삭제하면 그 컬렉션은 삭제되고 참여자는 더 이상 접근할 수 없습니다.',
            '다른 사람의 컬렉션에 이용자가 추가한 콘텐츠는 소유자가 관리할 수 있습니다.',
          ),
        ],
      },
      {
        id: 'conduct',
        title: '5. 금지 행위',
        blocks: [
          p('다음 행위를 해서는 안 됩니다.'),
          ul(
            '불법 콘텐츠를 저장·공유하는 행위',
            '타인의 권리(저작권 등 지식재산권, 개인정보, 초상 등)를 침해하는 행위',
            '다른 이용자를 괴롭히거나 위협하거나 혐오·학대하는 행위',
            '성적 착취, 불법적인 성적 콘텐츠 또는 아동·청소년을 대상으로 한 부적절한 콘텐츠를 저장·공유하는 행위',
            '스팸, 사기, 다른 사람이나 기관을 사칭하는 행위',
            '악성 링크나 악성코드를 공유하는 행위',
            '기타 관련 법령이나 정책에 위반되는 행위',
            '서비스나 계정에 대한 무단 접근, 보안 장치 우회, 과도한 요청, 자동화된 대량 이용',
          ),
        ],
      },
      {
        id: 'reporting',
        title: '5-1. 신고와 차단',
        blocks: [
          ul(
            '다른 이용자의 사용자, 컬렉션, 링크, 댓글에서 문제를 발견하면 앱 또는 웹의 신고 기능으로 신고할 수 있습니다. 신고 사유를 고르고 설명을 덧붙일 수 있습니다.',
            '다른 이용자를 차단할 수 있습니다. 차단하면 서로 친구 요청, 협업 초대, 댓글·반응 등 일부 상호작용이 제한되고, 설정의 "차단한 사용자"에서 언제든 해제할 수 있습니다. 차단은 상대의 콘텐츠를 삭제하거나 이미 함께 쓰는 컬렉션에서 상대를 제거하지 않습니다.',
            '접수된 신고는 Juple 담당자가 검토하며, 신고하신 분의 정보는 신고 대상에게 알리지 않습니다. 신고 결과를 개별적으로 안내하지 않을 수 있습니다.',
          ),
        ],
      },
      {
        id: 'subscription',
        title: '6. 무료 이용 기간과 유료 구독',
        blocks: [
          p('Juple은 무료 이용 기간 후 유료 구독으로 이용하는 서비스이며, 다음이 적용됩니다.'),
          ul(
            '가입 후 30일은 Juple이 제공하는 무료 이용 기간입니다(스토어 결제와 별개).',
            '무료 이용 기간이 끝나면 월 단위 자동 갱신 구독(Juple 구독)이 필요합니다. Android에서는 Google Play로 구독하며, 가격은 구매 화면에 표시되는 Google Play의 가격입니다.',
            '결제·갱신·해지·환불은 Google Play의 약관과 정책을 따릅니다. Google Play의 정기 결제 설정에서 언제든 해지할 수 있습니다.',
            '해지하면 이미 결제한 기간이 끝날 때까지 이용할 수 있습니다. 결제에 문제가 있으면 유예 기간이 적용될 수 있습니다.',
            '무료 이용 기간이 끝났거나 구독이 만료되면 저장한 링크와 컬렉션은 계속 볼 수 있지만, 새로 저장하거나 수정·삭제·공유할 수 없습니다. 구독은 기기가 아니라 계정에 적용되며 구매 복원을 지원합니다.',
            '컬렉션 소유자의 구독이 만료되면 그 컬렉션은 읽을 수만 있으며, 참여자가 구독 중이어도 변경할 수 없습니다.',
            '계정을 삭제해도 스토어 구독은 자동으로 해지되지 않으므로 Google Play에서 먼저 해지해야 합니다.',
          ),
        ],
      },
      {
        id: 'changes-to-service',
        title: '7. 서비스의 변경과 중단',
        blocks: [p('Juple은 기능을 추가·변경·중단할 수 있으며 중요한 변경은 사전에 알립니다. 장애나 점검으로 서비스가 일시적으로 중단될 수 있습니다.')],
      },
      {
        id: 'restriction',
        title: '8. 이용 제한과 종료',
        blocks: [
          p('약관을 위반하거나 신고된 내용이 위반으로 확인되면 Juple은 다음 조치를 할 수 있습니다.'),
          ul(
            '신고 접수와 내용 확인',
            '해당 콘텐츠의 접근 제한 또는 삭제, 공유 중지',
            '이용자의 일부 기능 제한',
            '계정 이용 제한 또는 정지',
            '반복되거나 중대한 위반에 대한 추가 조치',
          ),
          p('Juple은 신고와 이용자의 확인을 바탕으로 사람이 검토합니다. 이용자는 언제든 계정을 삭제할 수 있습니다.'),
        ],
      },
      {
        id: 'liability',
        title: '9. 책임',
        blocks: [
          p('서비스는 합리적인 수준의 주의로 제공하지만, 외부 링크의 내용과 이용자가 올린 콘텐츠의 정확성·적법성은 보증하지 않습니다. 이 약관은 관련 법령이 이용자에게 보장하는 권리를 제한하지 않습니다.'),
        ],
      },
      {
        id: 'changes',
        title: '10. 약관의 변경',
        blocks: [p('약관이 바뀌면 이 페이지에 게시하며, 중요한 변경은 앱에서도 안내합니다. 이 페이지 상단에 최종 수정일을 표시합니다.')],
      },
      {
        id: 'contact',
        title: '11. 문의',
        blocks: contactBlocks(config, 'general'),
      },
    ],
  };
}

export function accountDeletionDocument(config: LegalOperatorConfig): LegalDocument {
  return {
    slug: 'account-deletion',
    title: '계정 삭제 안내',
    description: 'Juple 계정을 삭제하는 방법, 삭제되는 데이터, 삭제 후 일정 기간 남는 정보를 안내합니다.',
    intro: '이 페이지는 로그인 없이 볼 수 있습니다. 계정을 삭제하면 되돌릴 수 없습니다.',
    sections: [
      {
        id: 'in-app',
        title: '앱에서 계정 삭제하기',
        blocks: [
          ol(
            'Juple 앱에서 **내 페이지**를 엽니다.',
            '**계정 관리**를 누르고 **계정 삭제**를 선택합니다.',
            '삭제되는 데이터 목록을 확인하고 **계정 삭제 계속**을 누릅니다.',
            '본인 확인을 위해 **다시 로그인**합니다.',
            '안내에 표시된 **Juple ID를 그대로 입력**하고 **계정 영구 삭제**를 누릅니다.',
          ),
          p('삭제를 시작하면 되돌릴 수 없습니다.'),
        ],
      },
      {
        id: 'cannot-use-app',
        title: '앱을 사용할 수 없는 경우 (이메일로 계정 전체 삭제 요청)',
        blocks: [
          p('앱을 지웠거나, 기기를 잃어버렸거나, 로그인할 수 없는 경우에는 이메일로 **계정 전체의 삭제**를 요청할 수 있습니다. 계정은 유지하고 일부 데이터만 지우고 싶다면 아래 "계정을 유지하면서 데이터 삭제하기"를 참고해 주세요.'),
          ...(config.supportEmail
            ? [
                p(`**삭제 요청 이메일: ${config.supportEmail}**`),
                p('메일 제목에 "Juple 계정 삭제 요청"이라고 적고, 본문에 다음을 알려 주세요.'),
                ul(
                  '가입과 로그인에 사용한 이메일 주소',
                  '알고 있다면 Juple ID',
                  '계정과 저장한 데이터를 모두 삭제하길 원한다는 내용',
                ),
                p('본인 확인을 위해 추가 정보를 요청할 수 있으며, 확인된 요청은 앱에서 삭제하는 것과 같은 범위로 처리합니다. 삭제 후 남는 정보는 아래 "삭제 후 남는 정보"를 참고해 주세요.'),
              ]
            : []),
          p('앱에 로그인할 수 있다면 위 "앱에서 계정 삭제하기"로 직접 삭제하는 것이 가장 빠릅니다.'),
        ],
      },
      {
        id: 'data-only',
        title: '계정을 유지하면서 데이터 삭제하기',
        blocks: [
          p('계정은 그대로 두고 일부 데이터만 지울 수도 있습니다. **이 경우 계정과 나머지 데이터는 유지됩니다.** 계정 전체 삭제와는 다른 요청입니다.'),
          p('**앱에서 직접 삭제하기**'),
          ul(
            '저장한 링크: 링크를 삭제하면 삭제 이력으로 이동하며, 삭제 이력에서 영구 삭제하거나 비울 수 있습니다.',
            '컬렉션과 컬렉션 안의 링크, 업로드한 사진, 내가 남긴 댓글과 반응, 친구와 친구 메모, 알림, 최근 연 링크 기록: 각 화면에서 직접 삭제할 수 있습니다.',
          ),
          ...(config.supportEmail
            ? [
                p('**앱을 사용할 수 없거나 앱에서 지울 수 없는 데이터는 이메일로 요청**'),
                p(`데이터 삭제 요청 이메일: ${config.supportEmail}`),
                p('메일 제목 예시: "Juple 데이터 삭제 요청"'),
                p('본문에 다음을 적어 주세요.'),
                ul(
                  '가입에 사용한 이메일 주소',
                  '알고 있다면 Juple ID',
                  '삭제를 원하는 데이터의 범위(예: 특정 컬렉션, 업로드한 사진, 문의 내역)',
                ),
                p('본인 확인을 위해 추가 정보를 요청할 수 있습니다. 요청한 범위의 데이터만 삭제하며 계정은 유지됩니다. 계정까지 모두 삭제하려면 위의 계정 전체 삭제 절차를 이용해 주세요.'),
              ]
            : []),
        ],
      },
      {
        id: 'deleted',
        title: '삭제되는 데이터',
        blocks: [
          p('계정을 삭제하면 다음이 영구적으로 삭제됩니다.'),
          ul(
            '프로필(닉네임, 프로필 사진, Juple ID)과 언어·시간대 설정',
            '저장한 링크와 메모, 삭제 이력에 있는 링크, 업로드한 사진',
            '내가 만든 모든 컬렉션과 그 설정(아이콘, 색, 사진, 잠금 비밀번호, 공유 링크). 공유 링크는 더 이상 열리지 않으며 참여자는 그 컬렉션을 볼 수 없게 됩니다.',
            '내가 다른 사람의 컬렉션에 추가한 링크, 보낸 승인 요청·참가 요청, 즐겨찾기, 알림 설정',
            '친구, 친구 요청, 친구에게 남긴 비공개 메모',
            '알림 기록, 푸시 알림 기기 등록, 최근 연 링크 기록',
            'Juple 서비스에 사용하던 로그인 계정(Microsoft Entra External ID의 이메일 주소·비밀번호 로그인 정보): 계정 삭제와 함께 삭제 절차가 진행되며, 이후 그 이메일 주소와 비밀번호로는 로그인할 수 없습니다. 같은 이메일 주소로 새로 가입할 수는 있습니다.',
            '고객센터 문의 내역과 답변',
            '내가 남긴 댓글과 좋아요, 이모지 반응. 다른 사람이 내 댓글에 답글을 남긴 경우 대화가 끊기지 않도록 내 댓글은 작성자 정보가 없는 자리 표시로 남습니다.',
          ),
          p('업로드한 사진 파일은 계정 정보가 삭제된 뒤 별도의 정리 작업으로 저장소에서 삭제되며, 보통 곧바로 처리됩니다.'),
        ],
      },
      {
        id: 'kept',
        title: '삭제 후 남는 정보',
        blocks: [
          ul(
            '구독 구매 기록(프로필과 분리): 계정을 삭제해도 Google Play 구독은 자동으로 해지되지 않습니다. 결제 확인과 복원, 구매 토큰 재사용 방지를 위해 최소 정보(구매 식별 해시, 상태, 날짜, 암호화된 구매 값)가 계정과 분리되어 남습니다. 암호화된 구매 값은 구독 종료 후 180일, 나머지 최소 정보는 구독 종료 후 최대 5년 이내에 삭제합니다.',
            '무료 이용 기간 중복 방지 기록: 같은 이메일 주소로 다시 가입해 무료 이용 기간을 반복하지 못하도록, 로그인 정보를 원래 값으로 되돌릴 수 없게 바꾼 변환값(해시)과 이용 기간만 남습니다. 이메일 주소 자체나 이름은 남지 않습니다. 이용 기간 종료 후 24개월까지 보관합니다.',
            '운영 로그: 최대 30일 보관 후 삭제됩니다. 로그에는 내부 식별자가 포함될 수 있으며 비밀번호나 결제 토큰은 포함되지 않습니다.',
          ),
        ],
      },
      {
        id: 'subscription',
        title: '구독을 사용 중이라면',
        blocks: [p('계정을 삭제해도 구독은 계속 결제될 수 있습니다. 먼저 Google Play의 **결제 및 정기 결제 > 정기 결제**에서 Juple 구독을 해지해 주세요.')],
      },
      {
        id: 'contact',
        title: '문의',
        blocks: contactBlocks(config, 'general'),
      },
    ],
  };
}
