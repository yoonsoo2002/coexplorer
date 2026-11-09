# CoExplorer

The file explorer you share with your AI agents. 사람과 Claude Code가 함께 쓰는 파일 탐색기.

이 코드는 c0mpiled-17 Seoul 해커톤(2026-11-09) 현장에서 새로 작성했다.

## 실행

```bash
npm install
npm run dev
```

빌드한 앱을 실행하려면 `npm run build` 뒤에 `npx electron .` 를 쓴다.

## 기능

| 기능 | 위치 |
|---|---|
| 빈 지도에서 시작, 폴더 끌어 놓기 (내 PC 트리, 상자 안 폴더 타일, 윈도우 탐색기) | `src/renderer/src/main.js` 끌어 놓기 절 |
| Claude Code 세션 실시간 읽기: 읽는 곳 파란 빛, 새 파일 노란 점, 지난 작업 경로 | `src/main/index.js` `readSession`, 화면 `applyEvents` |
| 폴더 상자: 세로 카드, 버전 겹침, 형식 묶음, 겉으로 올라온 파일, 옆에 꺼내기 | `bodyHTML`, `pullOut` |
| 사람의 손: 고정, 숨김, 잠금, 연결 → `~/.coexplorer/state.json` | 오른쪽 "선택" |
| Claude Code 연결(훅): 규칙을 매 프롬프트에 전달, 숨긴 폴더 읽기와 잠근 폴더 수정을 거절, 막힘 표시 | `src/main/hooks.js` |
| LLM 위키(GBrain 형식): 첫 구축 sonnet, 폴더 추가 시 haiku로 바뀐 파일만 갱신 | `src/main/wiki.js` |
| 주제 탭: Claude가 묶은 것 + (열면) 사람이 더한 것, 메모는 페이지의 "사람 메모"에 저장 | `renderTopicBoard` |
| 위키 탭: 지은 과정(규칙/LLM 단계, 비용), 문장별 출처, 읽은 순서, 흡수 기록, 점검 | `renderWiki` |
| 한국어/영어, 다크 모드, 양쪽 패널 접기, 확대 정도에 따른 표시량 | 화면 위 제목 줄 |
| 버전 쌓기: `_v2`, `_최종`, `(1)`, `_2차수정` 같은 파일과 `v1`~`v7` 폴더를 한 더미로, 최신(또는 고정한 것)이 맨 앞 | `groupVersions`, `stackHTML` |
| 끌어서 연결: 카드 가장자리 손잡이를 다른 파일·폴더로 끌어 놓기, 종류 5가지(함께 읽기·대체·참고·넘김·근거)마다 Claude가 받는 규칙이 다름 | `lkh`, `LT` |
| 작업이 끝나면 지나간 경로를 번호와 움직이는 점으로 다시 보여 줌. Bash·PowerShell 명령 속 경로도 읽음 | `startPath`, `shellPaths` |
| 위키 폴더 보기: 지도 폴더를 트리로 펼쳐 원본 MD를 읽고, 그 파일을 쓰는 주제(백링크)와 연결을 함께 봄 | `renderReader`, `mdHTML` |
| 이 프로젝트로 Claude Code 열기: 지도 폴더를 `--add-dir`로 미리 허용, 훅 안내에 지도 폴더 목록 포함 | `openClaude`, `launchClaude` |
| 60초 데모 투어 | `src/renderer/src/demo.js` |

## 단축키

| 키 | 동작 |
|---|---|
| `Ctrl +` / `Ctrl -` / `Ctrl 0` | 앱 화면 크기 키우기 / 줄이기 / 기본값 (저장됨) |
| `+` / `-` | 지도 확대 / 축소 |
| `Esc` | 연결 고르기 취소 |

## 저장 위치

- `~/.coexplorer/state.json`: 지도와 사람의 판단
- `~/.coexplorer/wiki/`: 위키 페이지(`pages/*.md`), `index.md`, `ingest-log.json`, `manifest.json`
- `~/.coexplorer/coexplorer-hook.cjs`, `blocked.log`: 훅
- 연결 스위치를 켜면 `~/.claude/settings.json`에 훅이 들어간다. 켜기 전에 백업 파일을 만든다. 끄면 우리 항목만 지운다.

## 주의

- 원본 파일은 읽기만 한다. 앱이 쓰는 곳은 위 저장 위치뿐이다.
- 훅은 Read, Edit, Write, Glob, Grep을 막는다. Bash로 여는 파일은 막지 못한다.
- 개발용: `COEX_HOME`은 위키와 훅 폴더를 바꾼다. `COEX_SHOT`, `COEX_VIEW`, `COEX_QUIT`은 화면 저장용이다.
