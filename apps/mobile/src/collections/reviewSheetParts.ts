import type { ReactNode } from 'react';

/**
 * What a request sheet is made of, apart from its bottom-sheet shell: its title, the dialogs that must live in the same native Modal, and the
 * list itself. The 승인 대기 / 참여 요청 sheets each keep their own shell (below); the Collection's 검토할 요청 sheet puts both lists, and its
 * own type chooser, into ONE shell and slides between them (CollectionReviewRequestsSheet).
 */
export interface ReviewSheetParts {
  readonly title: string;
  readonly titleTestID: string | null;
  readonly testID: string;
  readonly closeTestID: string;
  readonly modalExtras: ReactNode;
  readonly content: ReactNode;
}
