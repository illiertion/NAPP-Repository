# NAPP Repository

NAPP 앱 패키지(.ipkg)와 저장소 인덱스를 GitHub Raw로 배포하는 저장소입니다.
런처는 `repository.json` → `apps/<appId>.json` → `packages/<appId>/<version>.ipkg` 순서로 읽습니다.

## 포함된 앱

| 앱 | ID | 설명 |
| --- | --- | --- |
| NAPP Demo Lab | `com.illiertion.demo.lab` | 런타임/저장소/권한 확인용 테스트 앱 |
| IPKG Studio | `com.illiertion.ipkgstudio` | 3단계 안내로 manifest 작성 → 파일 묶기 → SHA-256 → `.ipkg` 저장, SDK/API 문서 탭 |

## Raw 주소

기본 base URL: `https://raw.githubusercontent.com/ILLIERTION/NAPP-Repository/main/`

| 용도 | 주소 |
| --- | --- |
| 저장소 인덱스 | `…/main/repository.json` |
| 카테고리 | `…/main/categories/categories.json` |
| 앱 문서 | `…/main/apps/com.illiertion.ipkgstudio.json` |
| 패키지 | `…/main/packages/com.illiertion.ipkgstudio/1.0.0.ipkg` |
| 아이콘 | `…/main/icons/com.illiertion.ipkgstudio.png` |
| SDK/API 문서 | `…/main/docs/sdk.json` |

다른 계정/조직에 올린 경우 그대로 base URL만 바꾸면 됩니다.

```bat
REM 런처 기본 저장소를 내 저장소로 (빌드 시)
cmake -S . -B build\dev -DNAPP_OFFICIAL_REPOSITORY_URL=https://raw.githubusercontent.com/<owner>/<repo>/main/
```

빌드 없이 확인하려면 런처 → 설정 → 저장소 추가에
`https://raw.githubusercontent.com/<owner>/<repo>/main/`를 등록해도 됩니다.

## 구조

```
repository.json              생성물: 저장소 인덱스
repository-meta.json         저장소 이름/소유자/설명 (직접 편집)
categories/categories.json   카테고리 목록
apps-src/<appId>/            앱 소스 (manifest.json + app/ + metadata/)
apps-src/<appId>/publish.json 카테고리/추천/변경 사항 (저장소 전용 메타)
apps/<appId>.json            생성물: NAPP-APP 문서 (버전별 URL/SHA-256)
packages/<appId>/*.ipkg      생성물: 패키지
icons/<appId>.png            생성물: 스토어 아이콘
docs/sdk.json                SDK/API 문서 (스튜디오가 실행 중에 내려받음)
scripts/build_repository.py  빌드 스크립트
```

## 앱 추가

1. `apps-src/<appId>/` 에 `manifest.json`, `app/…`, `metadata/icon.png`(+`preview.png`)를 넣습니다.
2. `publish.json` 에 `category`, `featured`, `released`, `changelog` 를 적습니다.
3. `python scripts/build_repository.py` 실행 → `packages/`, `apps/`, `icons/`, `repository.json` 갱신.
4. 커밋 후 push. `.github/workflows/build.yml` 이 같은 작업을 자동으로 다시 수행합니다.

검증: `python -m jsonschema -i repository.json ../specifications/schemas/repository.schema.json`
(런처 저장소에 `specifications/` 가 있을 때)

## IPKG Studio

`apps-src/com.illiertion.ipkgstudio/` 는 런처에 설치해 쓰는 패키징 도구입니다.

- manifest 편집(앱 ID/버전/이름/설명/작성자/라이선스/엔트리/권한)
- 3단계 안내(설명 → 파일 → 빌드)와 실시간 준비 상태 체크리스트
- 파일·폴더 추가, ZIP(store) 생성, SHA-256 계산
- `SDK & API` 탭: `docs/sdk.json` 을 저장소에서 내려받아 표시 (문서는 패키지에 포함되지 않음)
- 런처의 언어/테마/강조 색을 `window.napp` 에서 읽어 반영
- 내려받은 `.ipkg` 는 앱 데이터 폴더의 `downloads/` 에 저장됩니다
  (런처 → 내 앱 → `데이터` 버튼으로 확인)

스튜디오로 만든 패키지는 `manifest.json` 이 아카이브 루트에 있고
`metadata/icon.png` 가 포함되므로 그대로 저장소에 올릴 수 있습니다.
