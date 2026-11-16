import { navigationRef } from '../navigation/navigationRef';

/** 내 페이지 first, then the Membership screen on top of it: Back from Membership lands on 내 페이지. */
export function openMembershipFromMyPage(): void {
  if (!navigationRef.isReady()) {
    return;
  }
  navigationRef.navigate('MainTabs', { screen: 'MyPage' });
  navigationRef.navigate('Subscription');
}
