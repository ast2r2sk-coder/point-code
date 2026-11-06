# Point Code 설계 결정

## 2026-11-06 · 0.8.0 디자인 토큰 · 애플 스타일 · 배치 · 수정 지도

- **디자인 값은 `media/tokens.css` 한 파일에만 둔다.** 간격(4pt 그리드), 모서리, 글자 크기 5단계, 색 역할(`--pc-label`, `--pc-fill`, `--pc-accent`, `--pc-pending` …), 그림자, 모션, 보드 캔버스 색. 뷰 CSS(`inspector-view`, `palette-view`, `screens-view`, `preview`)는 역할 이름만 쓴다. hex·`rgb()`·`--vscode-*`를 뷰 CSS에 쓰면 `test/styles.test.js`가 실패하고, 정의되지 않은 `--pc-*`를 써도 실패한다.
- **색은 VS Code 테마, 구조는 애플 HIG.** 웹뷰는 편집기 안에 있으므로 색은 계속 테마(라이트·다크·고대비)를 따르고, 가져오는 것은 리듬과 위계다. 테두리 대신 옅은 면과 hairline, 묶음 목록, 영역마다 채운 버튼 하나(소스에 저장), 나머지는 회색·텍스트 버튼, 선택지는 segmented control, sticky 바는 반투명. 고대비 테마에서는 면을 없애고 테마의 contrast border를 쓴다(`body.vscode-high-contrast`).
- **클래스 이름은 바꾸지 않았다.** 로직·메시지·테스트가 쓰는 클래스(`.save`, `.revert`, `.dirty`, `button.pick` …)는 그대로이고 CSS가 토큰에 연결한다. 미리보기 패널만 인라인 `<style>`을 `preview.css`로 옮기고 툴바를 한 줄로 합쳤다(id 유지).
- **배치는 의도 → 선언.** 버튼은 ‘가운데’, ‘세로로 쌓기’ 같은 의도를 보내고 `core.layoutDecls`가 요소·부모의 계산값(display, flex-direction)으로 선언을 정한다. 일반 상자의 내용을 정렬하면 flex로 바꾸고(inline이면 inline-flex) 알린다. 부모가 일반 상자면 세로 위치는 만들 수 없으므로 막고 부모 선택을 안내한다(부모를 몰래 바꾸지 않는다). 저장은 요소 자신의 규칙(`setDeclaration`), 없으면 Tailwind class 문자열에서 같은 그룹 유틸리티만 바꾼다(`md:` 같은 변형은 작성자의 의도라 유지). 한 선택의 배치 변경은 pending 항목 하나라 ↺·취소·되돌리기가 그대로 동작한다.
- **수정 지도는 고치기 전에 범위를 보여 준다.** 규칙 공유 수(hits), 컴포넌트 사용 위치(워크스페이스 검색), 같은 클래스·닮은꼴 요소(태그 + 색·배경·글자 크기/굵기·모서리·안쪽 여백·테두리가 같은 요소, 최대 400개 검사). 하드코딩 값은 CSS 파일에서만 자동 치환한다(`findLiterals`: 주석·문자열·토큰 정의 제외, 색은 표기 차이를 정규화, 길이는 같은 속성 계열만). JSX·HTML 안의 값은 코드라서 개수만 알린다. 토큰 만들기 + 전체 치환은 한 batch라 되돌리기 한 번으로 모든 파일이 돌아간다.
- **페이지 위 picker 바는 예외.** 사용자 페이지 안이라 VS Code 변수가 없으므로 `picker.js` 맨 위 `THEME` 상수 하나에 모았다.

## 2026-11-05 · 0.7.0 취소 · 되돌리기 · 한 페이지 앱 화면

- **취소와 되돌리기는 다른 동작이다.** 취소 = 저장 전 미리보기 변경 버리기(전체 또는 항목별 ↺). 되돌리기 = 마지막 ‘소스에 저장’을 파일에서 되돌리기. 인스펙터 미리보기는 웹뷰가 ‘저장된 것 + 저장 대기’ 전체 목록을 보내 호스트가 새로 만든다(`preview-all`). 하나를 취소하는 것은 그 항목을 빼고 보내는 것이다.
- **되돌리기는 VS Code 편집 취소(Ctrl+Z)를 쓰지 않는다.** 문서가 활성 편집기여야 하고, 여러 파일을 한 번에 되돌릴 수 없으며, 사용자의 이후 편집과 섞인다. 저장마다 파일별 저장 직전·직후 텍스트를 기록하고(`writeDoc`이 batch에 기록), 되돌릴 때는 바뀐 구간을 앞뒤 문맥과 함께 현재 파일에서 정확히 한 번 찾아 원래 텍스트로 바꾼다(`revertEdit`). 문맥은 40자부터 줄여 가며 찾으므로 근처의 다른 편집은 남는다. 저장한 구간 자체가 다시 바뀌었거나 여러 곳에 있으면 그 파일은 건드리지 않고 알린다.
- **기록은 인스펙터와 디자인 시스템이 함께 쓰는 스택 하나**(최근 30개). 저장·되돌리기는 같은 순차 큐(`exclusive`)로 실행한다. 메모리 상태(바뀐 className, 토큰 값)는 저장 시 등록한 `onUndo` 훅으로 되돌리고, 인스펙터 웹뷰는 batch id별로 저장 직전 필드 값을 기억해 복원한다.
- **한 페이지 앱의 화면은 파일에 없다.** 실행 중인 페이지에서 찾는다. (1) 같은 사이트 링크를 모은다. 해시는 해시 라우트(`#/`, `#!/`)일 때만 경로로 보고, 정적 파일·Point Code 경로는 뺀다. 앱별로 워크스페이스 상태에 누적한다. (2) ‘화면 담기’는 그 순간의 DOM을 복제해 저장한다. 폼 값(속성이 아닌 프로퍼티)·canvas·CSSOM으로만 넣은 규칙·adoptedStyleSheets를 직렬화하고, 스크립트·on* 핸들러·`javascript:` 링크·Point Code UI·미리보기 토큰은 뺀다. `<base href>`로 원래 페이지 기준 URL을 유지한다. 비밀번호·파일 입력 값은 저장하지 않는다.
- **담은 화면은 프록시가 다시 서빙한다**(`/__point_code__/snap/<id>.html?token=`, 같은 출처). picker만 붙여 서빙하므로 보드 iframe에서 토큰·CSS 미리보기를 그대로 받는다. 앱 스크립트를 빼는 이유는 다시 실행되면 첫 화면으로 돌아가기 때문이고, 그래서 담은 화면은 보기 전용이다. 파일은 workspace storage(`storageUri/snapshots`)에 두고 목록은 workspaceState에, 최대 40개, 1개당 8MB.
- **숨긴 섹션을 강제로 보이게 하는 방식은 쓰지 않는다.** 앱마다 숨기는 방식이 달라 추측이 틀리기 쉽고, 실제로 나오지 않는 화면을 보여 줄 수 있다.

## 2026-11-05 · 0.6.0 저장 안전성 · 화면 보드 연결 구조

- **저장은 열린 TextDocument 기준.** 디스크에서 읽어 문서 전체를 바꾸면 편집기의 미저장 수정이 사라진다. `openTextDocument().getText()`로 읽고, 바뀐 최소 구간만 `WorkspaceEdit`로 바꾼다. 문서에 미저장 변경이 있었으면 적용만 하고 저장은 사용자에게 맡긴다(그 사람의 작업 중인 내용까지 디스크에 쓰지 않기 위해).
- **저장은 한 번의 요청, 순차 실행.** 웹뷰가 항목마다 메시지를 보내면 같은 파일을 동시에 읽어 마지막 것만 남는다. `save {items}` 하나로 보내고 호스트가 `serial()` 큐로 차례대로 쓴 뒤 항목별 결과를 돌려준다. 실패한 항목은 pending에 남는다.
- **선택마다 id.** 인스펙터 대상(targets)은 선택 id별로 최근 3개를 보관한다. 모양이 같은 요소(같은 태그·문구)를 연달아 골라도 이전 편집이 새 요소로 저장되지 않고, 이전 요소의 미저장 편집은 배너에서 그 요소 기준으로 저장할 수 있다.
- **규칙 줄을 못 찾으면 저장 위치도 모른다.** 파일만 알고 선택자 줄을 못 찾았을 때 1번째 줄로 두면 첫 규칙(`:root` 등)에 써 버린다. 이 경우 `save:false` + 선택자로 두고 저장 시 `locateUnique`로 한 번 더 찾는다.
- **토큰이 테마별로 여러 번 정의된 경우**(`:root` + `.dark`, `@theme` + `.dark`): 페이지가 보고한 규칙 선택자(컴파일된 `:root, :host`는 `:root`/`@theme`로 매칭)의 블록을 고치고, 없으면 기본 테마(`:root` → `@theme` → `html`)를 고친다. 서로 관계없는 두 규칙에 있으면 여전히 추측하지 않는다.
- **미리보기 채널 분리.** live 메시지에 `channel: inspector | palette`. 새 요소 선택의 reset은 인스펙터 채널만 지운다. 페이지는 채널별 토큰 맵을 합쳐(palette → inspector 순) `:root`에 칠한다.
- **화면 보드 iframe은 SSE를 열지 않는다.** 브라우저는 HTTP/1.1에서 호스트당 연결을 약 6개로 제한하는데, iframe마다 EventSource를 열면 보드 화면이 늘수록 앱 리소스·HMR 요청이 막힌다. 보드 iframe은 `name="point-code-board"`로 표시하고, picker는 이때 UI·SSE·polling을 끄고 부모(보드 웹뷰)의 `postMessage`로만 미리보기를 받는다. 호스트의 `live()`는 SSE 방송과 함께 보드 웹뷰로 전달한다.
- **보드는 다시 그리지 않고 갱신한다.** iframe은 DOM에서 옮기거나 다시 만들면 새로 로드된다. 카드는 화면 id별로 한 번 만들고 크기·선택만 바꾸며, 순서가 실제로 바뀐 카드만 `insertBefore`로 옮긴다. 캡처 보고는 문서별로 합치고(12초 만료), 내용이 같으면 보드에 보내지 않는다.
- **'일괄 편집' → 선택한 화면에만 미리보기.** 토큰은 원래 모든 화면에 반영되므로, 선택은 보드 안에서 디자인 시스템 미리보기를 선택한 화면으로 좁히는 데 쓴다. 미리보기 창과 브라우저는 항상 적용(실제 결과와 같게).
- **기기 프리셋은 CSS 뷰포트.** 0.5.1의 Flip/Fold 값은 물리 픽셀이었다. Fold는 Chrome DevTools "Galaxy Z Fold 5"(344×882 / 882×1104), Flip은 물리 해상도 ÷ DPR 근사값(UI에 근사값 표시). 목록은 `devices.js` 하나를 미리보기와 보드가 같이 쓴다.
- **라우트는 앱의 프레임워크를 따른다.** package.json 의존성으로 판단: `app/`·`pages/`는 Next, `src/routes/+page`는 SvelteKit, `src/pages`는 파일 라우팅 플러그인이 있을 때만(React Router SPA의 `src/pages`는 컴포넌트 폴더). 모노레포는 앱별로 묶고, 개발 서버 포트가 dev 스크립트에 있는 앱(없으면 프레임워크 기본 포트, 그다음 경로가 많은 앱)을 기본으로 고른다. 동적 세그먼트는 URL로 바꾸지 않고 샘플 값을 받는다(워크스페이스 상태에 저장).
- **Start는 실행 중이면 미리보기만 다시 연다.** 주소 변경은 별도 명령(`changeUrl`).
- **명령·뷰 이름은 `package.nls(.ko).json`으로 현지화.** 런타임 UI 문구는 한국어로 유지한다(주 사용자 언어). 영어 런타임 UI가 필요하면 `vscode.l10n` 번들 + 웹뷰 문자열 전달로 확장한다.

## 2026-11-05 · 0.5.5 브랜드 아이콘

- **마켓플레이스/설치 목록 아이콘**은 컬러 PNG(`media/icon.png`, 128×128) + `package.json` `"icon"`. VSIX manifest에 `Microsoft.VisualStudio.Services.Icons.Default`를 넣는다.
- **활동 표시줄**은 단색 SVG(`media/icon.svg`, `currentColor`)만 쓴다. 컬러 PNG는 활동 표시줄에서 테마 틴트가 깨지므로 쓰지 않는다.

## 2026-11-05 · 0.5.4 디자인 시스템·화면 보드 = 편집기 패널

- **사이드바 WebviewView만으로는 피그마식 보드가 안 보인다.** `openPalette`/`openScreens`는 `createWebviewPanel`(Beside)로 연다. 사이드바 뷰는 보조로 남기고, 미리보기 상단 버튼·명령은 패널을 연다.
- **화면 보드**는 어두운 캔버스에 라우트 iframe 아트보드를 나란히 두고 줌·디바이스 프리셋을 준다. **디자인 시스템**은 Colors / Typography / Spacing / Components 한 페이지 + `components`/`ui` 폴더 스캔.

## 2026-11-05 · 0.5.3 저장 버튼 · 미리보기만 규칙

- **`loc.save === false`여도 pending에 넣고 저장 버튼을 켠다.** persist 경로에 이미 `locateUnique`가 있어, 워크스페이스에 선택자가 하나뿐이면 저장된다. UI만 막아 두던 불일치를 없앴다. 못 찾으면 에러 메시지로 미리보기 유지를 알린다.

## 2026-11-05 · 0.5.1 화면 뷰포트 프리셋

- **Screens iframe은 논리 CSS 뷰포트**로 맞춘 뒤 `transform: scale`한다. 프리셋: Desktop 1440×900, Laptop 1280×800, iPad, iPhone, Android, Flip 커버·펼침, Fold 커버·펼침. 선택은 webview `getState`에만 둔다.

## 2026-11-05 · 0.5.0 디자인 시스템 · 화면 그리드

- 페이지 picker가 토큰을 POST `/palette`, 열린 모달·토스트를 POST `/screens`로 보낸다. 미리보기는 SSE `tokens`로 모든 연결 문서에 동시 반영. 저장은 `setVariable` + WorkspaceEdit, 원본이 하나일 때(또는 저장 시 unique locate).
- 라우트 발견: Next App/Pages, `src/pages`, SvelteKit `+page`. X-Frame-Options/CSP는 제거하지 않는다.
- **일괄 편집**은 공유 토큰 경로다. 화면 “선택”은 UX 포커스이며 토큰 프리뷰 격리는 아니다.

## 2026-11-05 · 0.2.0

- **기본 연결 방식을 리버스 프록시로 전환.** 확장이 `127.0.0.1:포트`에서 개발 서버를 프록시하고, 페이지 탐색 응답(`Sec-Fetch-Dest: document|iframe`, `text/html`, 비압축)의 끝에 picker 스크립트를 붙인다. 프로젝트 파일을 수정하지 않고 Next.js처럼 `index.html`이 없는 프레임워크에도 붙이기 위해서다. 응답을 버퍼링하지 않고 스트림 끝에 붙여 스트리밍 SSR을 지연시키지 않는다.
- **프록시는 Host/Origin/Referer를 개발 서버 값으로 재작성**한다. Vite `allowedHosts`, Next.js `allowedDevOrigins` 검사를 통과시키기 위해서다. 대신 프록시 자체는 Host 헤더가 `127.0.0.1:포트`/`localhost:포트`일 때만 응답한다(DNS 리바인딩 방지).
- **HMR 웹소켓은 raw TCP 터널**로 전달한다. 추가 의존성을 넣지 않기 위해서다.
- **포트·토큰은 워크스페이스별 `workspaceState`에 저장**하고 재사용한다. 스크립트 태그 방식에서 세션마다 태그를 갈아끼우던 문제를 없앤다. 저장된 포트가 사용 중이면 임의 포트로 바꾸고 알린다.
- **보안 헤더(X-Frame-Options, CSP)는 계속 제거하지 않는다.** 0.1.0의 결정을 유지한다.
- **소스 위치 우선순위:** `data-point-source` → `data-v-inspector` → Svelte `__svelte_meta` → React `_debugSource` → React 19 `_debugStack` → Vue `__file` → 문자열 검색. 스택·`__file`처럼 줄이 없거나 변환 후 줄인 경우 `approx`로 표시하고, 확장이 해당 파일 안에서 요소 텍스트·클래스로 줄을 고른다.
- **Svelte 줄 번호:** Svelte 4는 0부터(`loc.char` 존재), Svelte 5는 1부터 센다(컴파일러 `offsetLine: 1`). 열은 둘 다 0부터.
- **Turbopack은 스택에 원본 경로가 없어** 문자열 검색으로 넘긴다. Next.js 내부 엔드포인트로 소스맵을 해석하는 방식은 비공개 API라 쓰지 않았다.

## 2026-11-05 · 0.3.0 요소 인스펙터

- **인스펙터는 사이드바 WebviewView**(`pointCode.inspector`, `retainContextWhenHidden`)로 둔다. 미리보기·기본 브라우저 어느 쪽에서 선택해도 같은 패널을 쓰고, 편집기 그룹을 차지하지 않는다.
- **계층·CSS 수집은 페이지(picker)에서, 파일 위치 해석은 확장 호스트에서** 한다. 페이지만 런타임 정보(fiber, CSSOM, computed style)를 갖고, 워크스페이스 경로 검증(`safeSource`)은 호스트에서만 해야 하기 때문이다. 페이지에서 온 데이터는 길이·개수를 잘라 정리하고, 웹뷰는 텍스트 노드로만 렌더링한다(CSP: nonce 스크립트, 외부 리소스 없음).
- **컴포넌트 계층**: React는 fiber를 거슬러 올라가며 `_debugSource`/`_debugStack`의 호출 위치(=사용 위치)를, Vue는 `__file`(=정의 파일)을, Svelte 5는 `__svelte_meta.parent`(컴포넌트와 `{#if}`/`{#each}` 블록)를 쓴다. 불리언 prop은 ON/OFF, 화면 텍스트와 일치하는 문자열 prop은 `텍스트` 칩으로 표시해 문구를 어디서 고칠지 보여준다. 라이브러리 컴포넌트는 기본으로 숨긴다.
- **Next.js 서버 컴포넌트**는 클라이언트 fiber가 없어 React 19 개발 모드의 `_debugInfo`(이름·props·스택)를 읽는다. 스택이 `.next` 서버 청크를 가리키면(Turbopack) 위치 대신 `<Name` 사용 위치 검색을 제공한다. `node_modules`와 `.next` 경로는 소스로 열지 않는다.
- **CSS cascade는 직접 계산**한다(`!important` → 레이어 순위 → 명시도 → 소스 순서, longhand 단위 덮어쓰기 표시). DevTools Protocol은 웹뷰/기본 브라우저 페이지에서 쓸 수 없기 때문이다. `:hover`/`:focus` 등 상호작용 상태 규칙은 선택 순간 마우스가 올라가 있어 매칭되더라도 항상 별도 "상태" 목록으로 보낸다.
- **CSS 규칙의 소스 위치**: Vite `<style data-vite-dev-id>`의 파일 안에서 선택자 헤더 줄을 찾는다(중첩 `&:hover`는 부모 블록 안에서 다시 찾음). 단일 클래스 규칙이 요소(또는 상속 출처 부모)의 `className`에 있으면 Tailwind 같은 유틸리티로 보고 요소 위치로 연결한다. 번들된 CSS(Next.js `/_next/static/...`)는 파일명만 보여주고 워크스페이스 CSS 검색으로 넘긴다. 소스맵 해석은 하지 않는다.

## 2026-11-05 · 0.4.0 인스펙터에서 바로 수정

- **선택은 편집기를 열지 않는다.** 주 작업면이 인스펙터이므로 `showTextDocument`는 링크를 눌렀을 때만 한다.
- **미리보기는 페이지 SSE, 저장은 명시 버튼.** DevTools Protocol을 쓸 수 없어 picker가 EventSource로 패치를 받는다. CSS는 선택자 오버레이(`!important`), 토큰은 `:root` `setProperty`, 텍스트는 선택된 노드의 텍스트. 파일 쓰기는 ‘소스에 저장’(Ctrl+S)일 때만 한다. 자동 저장은 저장 여부를 알 수 없고, 번들 CSS에서 실패 경고만 남기기 때문이다.
- **번들 CSS는 미리보기만.** Vite `data-vite-dev-id`나 className 위치가 있으면 저장한다. Next `/_next/static/...`처럼 워크스페이스 파일이 아니면 규칙에 `미리보기만`을 붙이고 persist하지 않는다. 저장을 눌러도 원본이 하나뿐일 때만 워크스페이스 CSS에서 선택자를 한 번 더 찾는다.
- **상속 편집은 부모 규칙을 고친다.** 요소에 새 인라인 스타일을 넣지 않는다. 같은 규칙을 쓰는 다른 요소도 오버레이로 함께 바뀌고, 부모는 주황 점선·매칭 요소는 보라 점선으로 표시한다. `html`/`body`/`*` 처럼 넓은 선택자는 페이지 전체를 칠하지 않는다.
- **색·굵기·폰트는 정해진 값/토큰에서 고른다.** `:root`/`@theme` 커스텀 프로퍼티를 kind(color/weight/font/size/space)로 분류한다. 굵기는 100–900 단계(+ `font-thin`…`font-black`), 폰트는 sans/serif/mono와 `--font-*` 토큰. 숫자 자유 입력보다 피커를 기본으로 한다. 현재 값이 `var(--token)`이면 기본은 토큰 정의 수정, 원하면 이 규칙만 분리.
- **유틸리티 클래스는 값을 선언에 쓰지 않고 className을 바꾼다.** `text-blue-700` + `var(--color-red-500)` → `text-red-500`. 매핑이 안 되면 `text-[#…]`. 상속된 유틸리티는 부모 마크업을 고친다.
- **저장 값은 검증한다.** `{` `}` `</` `javascript:` 및 제어 문자를 거절하고, JSX/HTML 텍스트의 `{ } < >` 도 거절한다. 워크스페이스 밖·`node_modules`·`.next` 는 열지도 쓰지도 않는다.
