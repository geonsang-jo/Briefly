# Briefly 파일 저장 전환 작업 노트 (나중 작업용)

## 목적
- 현재 `localStorage` 기반 저장을, 추후 `~/.briefly` 폴더 기반 저장으로 전환한다.
- 일/주/월 목록은 파일 시스템의 날짜 폴더를 읽어 구성한다.
- UI 작업이 끝난 뒤 백엔드/저장소 전환을 안전하게 진행할 수 있게 기준을 고정한다.

## 현재 상태 (기준)
- 프로필 저장: `localStorage["briefly.profile.v3"]`
- 요약 기록 저장: `localStorage["briefly.records.v2"]`
- 요약 생성/로그 수집은 Tauri command 호출을 이미 사용 중 (`run_finish_command`, `collect_today_terminal_conversation`, `detect_log_paths`)

## 목표 저장 구조
```text
~/.briefly/
  profile.json
  records/
    2026-03-07/
      summary.md
      meta.json
    2026-03-08/
      summary.md
      meta.json
```

## 파일 포맷

### `profile.json`
```json
{
  "name": "Marcus",
  "finishCommand": "",
  "autoSummarizeOnFinish": false,
  "collectFromLocalLogs": true,
  "codexRootPath": "",
  "claudeRootPath": "",
  "cursorRootPath": "",
  "geminiRootPath": ""
}
```

### `records/YYYY-MM-DD/meta.json`
```json
{
  "id": "1741376400000",
  "createdAt": "2026-03-07T09:00:00+09:00",
  "provider": "local",
  "dateKey": "2026-03-07"
}
```

### `records/YYYY-MM-DD/summary.md`
```md
---
date: 2026-03-07
provider: local
createdAt: 2026-03-07T09:00:00+09:00
---

## 오늘 한 일
- ...

## 결정한 것
- ...

## 남은 할 일
- ...

## 리스크/메모
- ...
```

## 설계 원칙
- 파일 시스템을 단일 진실 소스(source of truth)로 사용한다.
- 같은 날짜에 여러 건이 필요하면 `records/YYYY-MM-DD/<id>/` 하위 구조로 확장 가능하게 설계한다.
- 날짜 키는 로컬 타임존 기준 `YYYY-MM-DD`로 생성한다.
- 읽기 실패/깨진 파일은 앱이 죽지 않게 스킵하고 경고만 남긴다.

## Tauri 작업 항목 (예정)
- `briefly_base_dir()` 유틸 추가 (`~/.briefly`)
- 커맨드 추가:
  - `load_profile_from_fs`
  - `save_profile_to_fs`
  - `list_records_from_fs`
  - `save_record_to_fs`
  - `migrate_local_storage_to_fs` (선택: 프론트에서 1회 트리거)
- 처리:
  - 디렉토리 없으면 생성
  - 원자적 쓰기(임시 파일 작성 후 rename) 적용 권장

## 프론트 작업 항목 (예정)
- 앱 시작 시:
  - 파일 저장소에서 프로필/요약 로드
  - 로드 실패 시 안내 메시지 표시
- 요약 저장 시:
  - 기존 `localStorage` 저장 대신 `save_record_to_fs` 호출
- 설정 저장 시:
  - `save_profile_to_fs` 호출
- 아카이브/홈 목록:
  - `list_records_from_fs` 결과 사용

## 마이그레이션 전략
1. 앱 시작 시 `localStorage` 데이터 존재 + 파일 데이터 없음인 경우만 마이그레이션 제안
2. 사용자 확인 후 1회 실행:
   - profile → `profile.json`
   - records[] → 날짜별 `meta.json + summary.md`
3. 성공 시 `migrated` 플래그 저장(예: `profile.json`에 `"storageVersion": 1`)
4. 이후 localStorage 키는 읽지 않거나 백업용으로만 유지

## 예외/리스크
- 권한 문제(홈 디렉토리 쓰기 불가)
- 파일 부분 손상/수동 편집 포맷 깨짐
- 같은 날짜 중복 저장 정책 미정(덮어쓰기 vs 누적)
- OS/환경별 홈 경로 차이

## 테스트 체크리스트
- 빈 환경 첫 실행 시 폴더 자동 생성
- 요약 저장 후 파일 생성/내용 포맷 검증
- 앱 재시작 후 목록/주/월 그룹 복원
- 손상된 `meta.json`/`summary.md` 존재 시 앱 정상 동작
- 마이그레이션 1회만 실행되고 재실행 시 중복 생성 없음

## 구현 순서 제안
1. Rust(Tauri) 파일 입출력 커맨드 추가
2. 프론트 저장/불러오기 연결
3. 마이그레이션 로직 추가
4. QA: 저장/복원/예외 케이스 점검
