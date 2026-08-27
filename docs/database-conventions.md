# Database Conventions

Juple의 Database Persistence 규칙은 실제 Entity와 schema를 만들기 전에 공통 기준으로 사용한다. 이 문서는 현재 구현을 의미하지 않으며, 구체적인 Entity·module 요구사항이 생길 때 세부 결정을 보완한다.

## 1. Primary Key

Juple의 기본 내부 Primary Key는 C# `long`, SQL Server `bigint IDENTITY`를 사용한다. 모든 Entity의 기본 키로 `Guid`를 사용하지 않는다.

이 선택은 Azure SQL의 관계형 workload, 작은 clustered/nonclustered index key, 효율적인 join/index, 서버 중심의 데이터 생성, 단순한 운영과 debugging에 적합하다.

외부 공개 식별자가 실제로 필요한 Aggregate에는 별도의 `Guid PublicId` 등을 추가할 수 있다. 그러나 모든 Entity에 PublicId를 미리 추가하지 않는다. ID의 순차성은 authorization 수단이 아니며, 사용자 데이터 접근 권한은 항상 서버에서 검증한다.

## 2. Time and Date

실제 세계의 특정 순간(instant)은 C# `DateTimeOffset`, SQL Server `datetimeoffset`을 기본으로 사용하고 UTC(offset zero)로 저장한다.

예: `CreatedAtUtc`, `UpdatedAtUtc`, `SavedAtUtc`, `LastLoginAtUtc`

날짜 자체만 의미가 있는 값은 C# `DateOnly`, SQL Server `date`를 사용한다.

예: `PurchaseDate`

사용자의 로컬 시각만 의미가 있는 값은 `TimeOnly`와 User TimeZone을 조합한다. 예를 들어 알림 선호 시간은 특정 국가나 서버 local time으로 해석하지 않는다.

한국 시간 또는 서버 local time을 Database business rule에 하드코딩하지 않는다. 애플리케이션에서 현재 시각이 필요할 때 광범위한 `DateTime.Now` 대신 .NET `TimeProvider`를 활용할 수 있는 구조를 선호한다.

## 3. Money and Currency

금액에는 floating-point 타입을 사용하지 않는다.

- C#: `decimal`
- SQL Server: `decimal(19,4)`

통화는 금액과 분리하지 않고 ISO 4217 3-character uppercase `CurrencyCode`를 함께 저장한다.

```text
Amount = 19900
CurrencyCode = KRW
```

환율 변환값으로 원본 금액을 덮어쓰지 않는다. 사용자가 실제 구매한 금액은 원래 거래 통화 그대로 보존한다.

## 4. String and Unicode

사용자 텍스트는 Unicode를 지원해야 한다. EF Core와 SQL Server에서 문자열 max length를 가능한 경우 명시하며, `nvarchar(max)`를 기본값처럼 사용하지 않는다.

`Name`, `Memo`, `URL`, `ExternalSubject` 등은 실제 요구사항에 따라 필드별 길이를 결정한다. URL도 무제한 문자열로 만들지 않는다.

대소문자와 정규화가 중요한 값은 필요에 따라 원문 표시값과 비교용 normalized value를 분리한다. 사용자가 직접 작성한 텍스트는 원문을 유지한다.

## 5. SQL Schema and Module Ownership

Modular Monolith의 module ownership을 Database에도 반영한다. 각 module은 자신이 소유하는 SQL schema를 사용할 수 있다.

예상 방향:

- `users`
- `inbox`
- `items`
- `wishlist`
- `purchases`
- `notifications`
- `images`

실제 schema 이름은 각 module 구현 시 확정한다. 모든 table을 `dbo`에 몰아넣지 않으며, 다른 module의 table을 직접 수정하지 않는다. Cross-module relation이 필요하면 module boundary와 future extraction 가능성을 먼저 검토한다.

## 6. Created and Updated Audit Fields

모든 Entity에 동일한 `BaseEntity`를 무조건 강제하지 않는다. Entity lifecycle에 실제 의미가 있는 경우에만 다음 필드를 사용한다.

- `CreatedAtUtc`
- `UpdatedAtUtc`

Lookup 또는 value entity처럼 audit column의 의미가 없는 대상에는 습관적으로 추가하지 않는다. `CreatedBy`와 `UpdatedBy`도 실제 audit requirement가 있는 경우에만 추가한다.

## 7. Soft Delete

모든 table에 전역 `IsDeleted`를 추가하지 않는다. Soft delete는 실제 business 의미가 있을 때 명시적인 lifecycle 상태로 모델링한다.

예: `Archive`, `Disabled`, `Deleted pending retention`

진짜 삭제가 맞는 데이터는 삭제할 수 있다. Account deletion과 개인정보 삭제 requirement를 global soft delete 하나로 해결하지 않는다.

## 8. Concurrency

Web, iOS, Android 등 여러 client가 동일 데이터를 수정하고 lost update가 문제가 되는 Aggregate Root에는 optimistic concurrency를 사용한다. SQL Server `rowversion`을 우선 검토한다.

모든 Entity에 `rowversion`을 무조건 추가하지 않는다. Concurrency conflict는 API에서 명확한 오류와 처리 흐름으로 표현할 수 있어야 한다.

## 9. Delete Behavior

Cascade delete를 광범위한 기본값으로 사용하지 않는다.

- Aggregate 내부의 명백한 owned/dependent child: 명확한 경우 explicit Cascade 허용
- Aggregate 또는 module 경계를 넘는 relation: `Restrict` 또는 `NoAction` 우선

삭제 결과가 명확하지 않은 관계에는 cascade를 자동 적용하지 않는다.

## 10. Index and Unique Constraints

SQL Server가 FK index를 자동 생성한다고 가정하지 않는다. 실제 query/access pattern에 필요한 FK와 검색 column에는 명시적으로 index를 설계한다.

Unique index는 기술 편의가 아니라 business invariant를 표현할 때 사용한다. 예를 들어 외부 Identity Provider의 동일 subject 중복 방지에 사용할 수 있다. 사용되지 않을 것으로 추정되는 index를 미리 대량 생성하지 않는다.

## 11. User Ownership

사용자 소유 데이터의 owner는 client request가 아니라 server가 인증 context에서 결정한다.

```text
현재 인증된 principal
    -> internal Juple UserId
        -> owned data
```

예를 들어 `POST /items` 요청 body의 임의 `UserId`를 ownership 근거로 신뢰하지 않는다. 서버가 인증된 principal을 내부 User로 매핑하고, 해당 내부 UserId를 기준으로 접근과 변경을 검증한다.

## 12. Enum Persistence

Enum persistence 방식을 하나의 global rule로 고정하지 않는다. 각 enum의 변경 가능성, query 요구, 외부 API 계약, 의미 안정성을 검토하여 `int`, `string`, value object, lookup 중 선택한다.

Enum member의 순서를 바꿨다는 이유로 기존 Database 값의 의미가 바뀌는 설계는 금지한다.

## 13. EF Core Configuration

Entity mapping은 Data Annotation보다 `IEntityTypeConfiguration<T>` Fluent Configuration을 우선한다. Domain Entity가 EF Core persistence attribute에 불필요하게 종속되지 않도록 한다.

Configuration은 Infrastructure에서 관리한다. Migration은 다음 위치에서 관리한다.

```text
backend/src/Juple.Infrastructure/Persistence/Migrations
```

## 14. Database Naming

C# domain naming은 PascalCase를 사용한다. Database table과 column 이름도 기본적으로 EF Core의 명확하고 일관된 PascalCase 이름을 사용한다.

외부 library를 추가해 snake_case를 강제하지 않는다. Table은 읽기 쉬운 복수형 또는 명확한 domain 이름을 사용하되 모든 module에서 일관성을 유지한다. Reserved keyword와 충돌하는 이름은 피한다.

## 15. Collation and Global Text

Juple은 글로벌 앱이므로 Unicode 저장을 기본으로 한다. 특정 국가 언어의 정렬 규칙을 Database 전체 business rule로 하드코딩하지 않는다.

Display sorting이 locale-sensitive한 경우 해당 User locale을 고려하여 application 또는 UI layer에서 처리할 수 있다. Database collation은 구체적인 검색 requirement가 정해지기 전 임의로 변경하지 않는다.

## 16. Migration Principles

- Schema 변경은 반드시 EF Core Migration으로 추적한다.
- Production Database 수동 변경을 정상 workflow로 사용하지 않는다.
- Migration 생성 후 생성된 SQL과 schema를 검토한다.
- Migration 이름은 의미 있게 작성한다.
- 이미 Production에 적용된 Migration을 임의로 수정하지 않는다.
- 변경이 필요하면 새 Migration으로 추가한다.
- App startup에서 Production Database에 자동 Migration을 무조건 적용하지 않는다.
- Deployment migration 전략은 배포 구조 설계 단계에서 별도로 결정한다.

## 17. Prohibited Shortcuts

다음은 이 문서 작성 단계에서 수행하지 않는다.

- Entity 생성
- DbSet 생성
- Migration 생성
- Database 생성
- `JupleDbContext` 수정
- Package 변경
- Backend code 수정
- Mobile 수정
- Azure 리소스 생성

## Decision Summary

| Decision          | Choice                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Primary Key       | C# `long`, SQL Server `bigint IDENTITY`; 필요한 Aggregate에만 별도 PublicId 검토         |
| Instant timestamp | C# `DateTimeOffset`, SQL `datetimeoffset`, UTC 저장                                      |
| Date-only         | C# `DateOnly`, SQL `date`                                                                |
| Money             | C# `decimal`, SQL `decimal(19,4)`                                                        |
| Currency          | ISO 4217 3-character uppercase `CurrencyCode`를 Amount와 함께 저장                       |
| Soft delete       | 전역 `IsDeleted` 금지; business lifecycle이 있을 때만 명시적으로 모델링                  |
| Concurrency       | 필요한 Aggregate Root에 optimistic concurrency와 SQL Server `rowversion` 우선 검토       |
| SQL schema        | Module ownership을 반영하며 실제 schema 이름은 module 구현 시 확정                       |
| EF configuration  | Infrastructure의 `IEntityTypeConfiguration<T>` Fluent Configuration 우선                 |
| Migration         | `backend/src/Juple.Infrastructure/Persistence/Migrations`에서 EF Core Migration으로 추적 |
| User ownership    | 인증 principal에서 서버가 internal Juple UserId를 결정; client UserId 불신               |
