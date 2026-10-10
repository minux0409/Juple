export interface TutorialPageDefinition {
  /** Locale keys: `tutorial.pages.<id>.title` and `.description`. The illustration is TutorialIllustration's, keyed by the same id. */
  readonly id: 'save' | 'today' | 'collections' | 'share' | 'find' | 'start';
}

/**
 * The first-run tutorial: the mental model in six short pages (the detail lives in the Help Guide). Bundled with the
 * app, nothing is downloaded, so it works offline.
 */
export const TUTORIAL_PAGES: readonly TutorialPageDefinition[] = [
  { id: 'save' },
  { id: 'today' },
  { id: 'collections' },
  { id: 'share' },
  { id: 'find' },
  { id: 'start' },
];
