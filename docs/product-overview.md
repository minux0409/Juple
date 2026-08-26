# Product Overview

## 제품 정체성

Juple은 발견한 상품과 콘텐츠를 저장하고, 나중에 다시 검토하고, Wishlist·보관·삭제로 정리한 뒤 실제 구매와 Purchase History로 연결하는 글로벌 서비스다. 반복 구매가 필요한 항목은 Repeat Purchase로 관리한다.

햄스터는 브랜드 마스코트다. 당일 저장한 링크 수에 따라 볼이 부풀어 오르고, 링크와 발견물을 볼주머니에 모으는 경험을 표현한다. 캐릭터는 UX를 돕지만 앱을 게임으로 만들지는 않는다. 앱 아이콘의 시각적 모티브 후보는 sunflower seed다.

## 핵심 흐름

발견 → 빠른 저장 → 나중에 검토 → Wishlist / 보관 / 삭제 → 실제 구매 → Purchase History → Repeat Purchase

## 주요 기능

- 동일 계정과 데이터를 사용하는 Mobile + Web
- Instagram, YouTube, Web Browser, Shopping App 등의 URL 빠른 저장
  - Android: Share Intent
  - iOS: Share Extension
- 날짜별 Daily Inbox와 저장 직후의 낮은 입력 부담
- URL, 이미지, 메모, 카테고리를 관리하는 Wishlist
- 구매 주기, 다음 예상 구매 시점, 알림을 관리하는 Repeat Purchase
- 구매일, 실제 지불 금액, Currency, Store, Size / Quantity / Variant를 기록하는 Purchase History
- 사용자가 직접 생성·수정·정렬하는 User Categories
- 상품 사진 및 screenshot 저장
- 공개적으로 확실히 확인 가능한 경우에만 URL Metadata로 상품명·대표 이미지 입력 보조

사용자 입력 데이터는 신뢰 가능한 원문으로 취급한다. 확인할 수 없는 Metadata는 추측하지 않고 사용자에게 직접 입력을 요청한다.

## 신뢰 원칙

핵심 원칙은 “모르면 모른다고 한다”이다. 다음은 기본 기능으로 제공하지 않는다.

- 모든 쇼핑몰의 가격 자동 크롤링 및 최저가 비교
- 옵션·용량별 가격 추정 또는 가격 변화 그래프
- 외부 쇼핑몰 구매 여부 자동 판단
- 카드 내역만으로 구매 상품 자동 식별
- 불확실한 AI 식별 결과를 확정 데이터로 저장
- CAPTCHA나 Bot protection 우회

예를 들어 대표 가격만 보고 250ml와 500ml의 가격을 동일하다고 표시하지 않는다. 가격 통계가 필요하면 사용자가 직접 기록한 Purchase History만 사용한다.

## AI 사용 원칙

AI는 Screenshot 분석이나 상품 후보 제안 같은 보조 기능으로만 사용한다.

AI 제안 → 사용자 확인 → 저장의 흐름을 지키며, AI를 사용하지 않아도 핵심 앱 기능은 정상 작동해야 한다.

## 글로벌 서비스 기준

처음 지원하는 언어 수와 관계없이 확장 가능한 i18n/l10n 구조를 사용한다.

- Locale, Language, TimeZone
- Currency와 `Amount` + `CurrencyCode`
- 날짜·시간, 숫자 형식
- RTL 가능성
- 국가별 Store Metadata

시간은 원칙적으로 UTC로 저장하고 사용자 TimeZone에서 표현한다. 사용자가 작성한 상품명, 카테고리명, 메모는 원문을 보존한다.

## 인증 및 계정

Identity Provider는 사용자의 신원만 제공하고, Juple 내부 User는 서비스 데이터를 소유하는 내부 `UserId`를 가진다. 상품·구매이력·카테고리의 FK에는 외부 Provider UID를 직접 사용하지 않는다.

장기적으로 Email, Google, Apple 로그인을 지원할 수 있는 구조를 고려하며, Account deletion과 개인정보 삭제는 Google Play 및 Apple App Store 정책에 맞게 설계한다.
