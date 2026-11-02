// Keep the shared import boundary without global presentation state. Operator messages are
// opened from the Inbox; ordinary dialogs retain React Native's visibility/dismissal semantics.
export { Modal as AppNativeModal } from 'react-native';
