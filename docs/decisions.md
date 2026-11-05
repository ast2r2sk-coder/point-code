# Point Code 설계 결정

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
