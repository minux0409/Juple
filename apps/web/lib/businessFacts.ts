import type { AppDictionary } from './appI18n.ts';
import { operatorFacts } from './legalContent.ts';
import type { LegalOperatorConfig } from './legalConfig.ts';

export interface BusinessFact {
  readonly label: string;
  readonly value: string;
}

const LABEL_KEYS = {
  운영자: 'businessOperator',
  대표자: 'businessRepresentative',
  사업자등록번호: 'businessRegistrationNumber',
  '통신판매업 신고번호': 'businessEcommerceNumber',
  '사업장 주소': 'businessAddress',
} as const;

/**
 * The business-information dialog's rows on the sign-in page: the operator facts that are really configured (see operatorFacts) with
 * their LABELS in the visitor's language. The values (names, numbers, address) are the operator's own data and stay as registered;
 * the service name is the page's own brand and is not repeated. The support email is added last when configured.
 */
export function localizedBusinessFacts(config: LegalOperatorConfig, dictionary: AppDictionary): BusinessFact[] {
  const facts = operatorFacts(config)
    .filter(fact => fact.label !== '서비스')
    .map(fact => {
      const key = LABEL_KEYS[fact.label as keyof typeof LABEL_KEYS];
      return { label: key ? dictionary[key] : fact.label, value: fact.value };
    });
  if (config.supportEmail) {
    facts.push({ label: dictionary.businessSupportEmail, value: config.supportEmail });
  }
  return facts;
}
