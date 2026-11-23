import { createZip } from "./zip.js";

const PERMISSIONS = [
  ["storage"],
  ["window"],
  ["notifications"],
  ["dialog"],
  ["filesystem"],
  ["clipboard"],
  ["external-links"],
  ["system-info"],
];

const APP_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const files = new Map(); // package path -> Uint8Array

const $ = (id) => document.getElementById(id);
const fileList = $("file-list");
const problems = $("problems");
const result = $("result");

// ---------------------------------------------------------------------------
// Launcher environment: window.napp is injected by the runtime host. It carries
// the launcher's language, theme, accent and the repository base URL.
const environment = window.napp || null;

// Studio's own preferences (this app's private storage). "auto" follows the
// launcher; storage can be unavailable, so every access is guarded.
// Studio 자체 설정(앱 전용 저장소). "auto" 는 런처를 따른다. 저장소를 못 쓸 수도 있어 항상 보호한다.
const LANGUAGE_KEY = "ipkgstudio.language";
const THEME_KEY = "ipkgstudio.theme";

function readPreference(key) {
  try {
    return localStorage.getItem(key) || "auto";
  } catch (error) {
    return "auto";
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    /* storage unavailable: the choice only lasts for this session */
  }
}

let languagePreference = readPreference(LANGUAGE_KEY);
let themePreference = readPreference(THEME_KEY);
let currentView = "build";
let resultShown = false;
// Window settings are only written when the user actually changes them.
// 창 설정은 사용자가 실제로 건드렸을 때만 매니페스트에 쓴다.
let windowCustomized = false;
let saveFolder = "";

// The two package images live at fixed paths whatever file was picked, so the
// manifest never depends on the source file name.
// 패키지 이미지 두 개는 어떤 파일을 고르든 고정 경로에 저장한다. 매니페스트가 원본
// 파일 이름에 좌우되지 않게 하기 위함이다.
const APP_ICON_PATH = "metadata/icon.png";
const WINDOW_ICON_PATH = "metadata/window-icon.png";

// Preview state for the app icon and the window icon.
// 앱 아이콘과 창 아이콘의 미리보기 상태.
const iconPreview = { url: "" };
const windowIconPreview = { url: "" };

function resolveLanguage() {
  if (languagePreference === "ko" || languagePreference === "en") return languagePreference;
  if (environment && environment.language) return environment.language === "ko" ? "ko" : "en";
  return String(navigator.language || "en").toLowerCase().startsWith("ko") ? "ko" : "en";
}

function resolveTheme() {
  if (themePreference === "dark" || themePreference === "light") return themePreference;
  if (environment && environment.theme) return environment.theme === "light" ? "light" : "dark";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

let language = resolveLanguage();

const STRINGS = {
  en: {
    tabsLabel: "Studio sections",
    tabBuild: "Build",
    tabDocs: "SDK & API",
    tabSettings: "Settings",
    envTitle: "Values inherited from the NAPP launcher",
    title: "Build a package",
    docsTitle: "SDK & API",
    settingsTitle: "Settings",
    step1: "Describe your app",
    step2: "Add your files",
    fieldId: "App ID",
    fieldVersion: "Version",
    fieldName: "Name",
    fieldAuthor: "Author",
    fieldDescription: "Description",
    fieldLicense: "License",
    fieldEntry: "Entry point",
    windowTitle: "App window",
    windowHint: "Title, opening size and tray icon are written into the manifest and applied by the launcher. Changing them adds the “window” permission.",
    fieldWindowTitle: "Window title",
    hintWindowTitle: "Defaults to the app name",
    fieldWindowWidth: "Window width",
    fieldWindowHeight: "Window height",
    windowTray: "Keep a tray icon; closing the window leaves the app running in the notification area",
    chooseWindowIcon: "Choose window icon…",
    windowIconInfo: "Saved as metadata/window-icon.png",
    windowIconNone: "No window icon yet — the launcher uses the NAPP icon.",
    errWindowIcon: "The window icon is not readable.",
    iconTitle: "App icon",
    iconHint: "The launcher, store and shortcuts use this image. It is stored as metadata/icon.png.",
    chooseIcon: "Choose image…",
    clearIcon: "Remove",
    iconNone: "No image yet — the generated icon is used (metadata/icon.png is added when you build).",
    iconInfo: "Saved as metadata/icon.png",
    iconBad: "This file is not an image the studio can read.",
    iconReadFailed: "Could not read the image.",
    saveTitle: "Save the package to",
    saveHint: "Leave it on the app folder or pick any folder; the host only writes where you chose.",
    saveDefault: "This app's data folder → downloads",
    chooseFolder: "Choose folder…",
    useDefault: "Use default",
    folderUnavailable: "Choosing a folder needs the NAPP launcher. Build in the launcher to pick a destination.",
    errWindowWidth: "Window width must be between 480 and 3840.",
    errWindowHeight: "Window height must be between 360 and 2160.",
    errWindowTitle: "Window title must be 80 characters or fewer.",
    errWindowPermission: "Window settings need the “window” permission; enable it above.",
    hintId: "Reverse-DNS, lowercase. Used as the install folder.",
    hintVersion: "Semantic version, e.g. 2.1.0.",
    hintDescription: "One sentence for the store listing.",
    hintEntry: "Page opened on launch; must be in the file list.",
    permTitle: "Permissions",
    permHint: "The user approves these in a system dialog when the package is installed.",
    permNote: "Notifications appear as real system notifications; Chromium never shows its own popups or prompts.",
    perm_storage: "App-private data",
    perm_window: "Window title / size / tray",
    perm_notifications: "System notifications",
    perm_dialog: "Native dialogs",
    perm_filesystem: "User-picked files",
    perm_clipboard: "Clipboard",
    "perm_external-links": "External links",
    "perm_system-info": "OS / runtime info",
    dropTitle: "Drop files or a folder here",
    dropHint: "Everything is stored relative to the package root.",
    addFiles: "Add files",
    addFolder: "Add folder",
    clear: "Clear",
    autoIcon: "Add a generated icon and preview when the package has none",
    noFiles: "No files yet — add your app folder.",
    removeFile: "Remove",
    fileCount: "{count} files",
    fileCountOne: "1 file",
    build: "Build .ipkg",
    footer: "Manifest is written at the archive root. Entry must exist in the file list.",
    checklistTitle: "Ready to build",
    needId: "App ID looks like com.example.app",
    needVersion: "Version is semantic (1.0.0)",
    needName: "Name is filled in",
    needEntry: "Entry point is in the file list",
    needFiles: "At least one file is added",
    needIcon: "Package has an icon",
    errId: "App ID must be reverse-DNS, lowercase, e.g. com.example.hello.",
    errVersion: "Version must be semantic, e.g. 1.0.0.",
    errName: "Name is required.",
    errAuthor: "Author is required.",
    errDescription: "Description is required.",
    errEntry: "Entry point \"{path}\" is not in the file list.",
    errIcon: "metadata/icon.png is required (or enable the generated icon).",
    errUnsafe: "Unsafe path in package: {path}",
    problemOne: "1 problem",
    problemMany: "{count} problems",
    saveFailed: "Could not save the package",
    resultTitle: "Package ready",
    resFile: "File",
    resSaved: "Saved as",
    resSize: "Size",
    resEntries: "Entries",
    resHint: "Double-click the .ipkg to install it. The launcher asks you to approve the requested permissions in a system dialog, and you can remove the app later from Library → ⋯ → Remove.",
    docsSub: "Downloaded from the repository, not bundled with this app.",
    docsSearch: "Search the SDK",
    docsReload: "Reload from repository",
    docsIdle: "Open the SDK tab to load the documentation.",
    docsLoading: "Downloading the SDK from the repository…",
    docsEmpty: "No documentation was found at this address.",
    docsOffline: "The repository could not be reached. Check the network and the repository URL in Settings.",
    docsNoRepo: "No repository is configured. Add one in the launcher's Settings tab, then reload.",
    docsLoaded: "Loaded {count} sections",
    docsNoMatch: "No matching section.",
    setLanguage: "Language",
    setLanguageHint: "Currently showing: {language}. Auto follows the NAPP launcher (launcher: {launcher}).",
    setTheme: "Theme",
    setThemeHint: "Auto follows the NAPP launcher.",
    setNotify: "System notifications",
    notifyGranted: "Allowed. Messages appear as Windows notifications.",
    notifyDenied: "Not allowed. Grant \"notifications\" to this app in the launcher (Library → permissions).",
    notifyTest: "Send a test notification",
    notifyTestBody: "This is a system notification from IPKG Studio.",
    notifyBuiltTitle: "Package built",
    setRestartNote: "Changing the language inside NAPP Launcher reaches this app the next time it starts. The setting above switches it immediately.",
    optAuto: "Follow NAPP launcher",
    optDark: "Dark",
    optLight: "Light",
    launcherLanguageEn: "English",
    launcherLanguageKo: "Korean",
    chipTitle: "Language: {language} · Theme: {theme} · Accent: {accent}",
  },
  ko: {
    tabsLabel: "스튜디오 메뉴",
    tabBuild: "빌드",
    tabDocs: "SDK · API",
    tabSettings: "설정",
    envTitle: "NAPP 런처에서 가져온 값",
    title: "패키지 만들기",
    docsTitle: "SDK · API",
    settingsTitle: "설정",
    step1: "앱 설명",
    step2: "파일 추가",
    fieldId: "앱 ID",
    fieldVersion: "버전",
    fieldName: "이름",
    fieldAuthor: "제작자",
    fieldDescription: "설명",
    fieldLicense: "라이선스",
    fieldEntry: "진입점",
    windowTitle: "앱 창",
    windowHint: "창 제목, 시작 크기, 창 아이콘, 트레이 아이콘은 매니페스트에 기록되어 런처가 적용합니다. 값을 바꾸면 “window” 권한이 켜집니다.",
    fieldWindowTitle: "창 제목",
    hintWindowTitle: "비워 두면 앱 이름",
    fieldWindowWidth: "창 너비",
    fieldWindowHeight: "창 높이",
    windowTray: "트레이 아이콘 유지 — 창을 닫아도 알림 영역에서 계속 실행",
    chooseWindowIcon: "창 아이콘 선택…",
    windowIconInfo: "metadata/window-icon.png 로 저장됨",
    windowIconNone: "아직 창 아이콘이 없습니다 — NAPP 기본 아이콘을 씁니다.",
    errWindowIcon: "창 아이콘을 읽을 수 없습니다.",
    iconTitle: "앱 아이콘",
    iconHint: "런처, 스토어, 바로가기가 이 이미지를 씁니다. metadata/icon.png 로 저장됩니다.",
    chooseIcon: "이미지 선택…",
    clearIcon: "제거",
    iconNone: "아직 이미지가 없습니다 — 자동 생성 아이콘을 씁니다 (빌드할 때 metadata/icon.png 추가).",
    iconInfo: "metadata/icon.png 로 저장됨",
    iconBad: "스튜디오가 읽을 수 없는 이미지 파일입니다.",
    iconReadFailed: "이미지를 읽지 못했습니다.",
    saveTitle: "패키지 저장 위치",
    saveHint: "앱 데이터 폴더에 두거나 원하는 폴더를 고르세요. 호스트는 직접 고른 폴더에만 씁니다.",
    saveDefault: "이 앱의 데이터 폴더 → downloads",
    chooseFolder: "폴더 선택…",
    useDefault: "기본값",
    folderUnavailable: "폴더 선택은 NAPP 런처에서 실행할 때만 됩니다. 런처에서 빌드하세요.",
    errWindowWidth: "창 너비는 480~3840 사이여야 합니다.",
    errWindowHeight: "창 높이는 360~2160 사이여야 합니다.",
    errWindowTitle: "창 제목은 80자 이하여야 합니다.",
    errWindowPermission: "창 설정을 쓰려면 위에서 “window” 권한을 켜세요.",
    hintId: "역방향 도메인 형식, 소문자. 설치 폴더 이름으로 쓰입니다.",
    hintVersion: "시맨틱 버전 (예: 2.1.0)",
    hintDescription: "스토어에 보일 한 문장 설명입니다.",
    hintEntry: "실행할 때 열리는 페이지이며 파일 목록에 있어야 합니다.",
    permTitle: "권한",
    permHint: "패키지를 설치할 때 사용자가 시스템 대화상자에서 승인합니다.",
    permNote: "알림은 진짜 시스템 알림으로 표시되고, Chromium 자체 팝업이나 안내창은 뜨지 않습니다.",
    perm_storage: "앱 전용 데이터",
    perm_window: "창 제목 / 크기 / 트레이",
    perm_notifications: "시스템 알림",
    perm_dialog: "네이티브 대화상자",
    perm_filesystem: "사용자가 고른 파일",
    perm_clipboard: "클립보드",
    "perm_external-links": "외부 링크",
    "perm_system-info": "OS / 런타임 정보",
    dropTitle: "파일이나 폴더를 여기로 끌어다 놓으세요",
    dropHint: "모든 파일은 패키지 루트 기준 상대 경로로 저장됩니다.",
    addFiles: "파일 추가",
    addFolder: "폴더 추가",
    clear: "비우기",
    autoIcon: "아이콘이 없으면 자동 생성한 아이콘과 미리보기를 넣기",
    noFiles: "아직 파일이 없습니다 — 앱 폴더를 추가하세요.",
    removeFile: "제거",
    fileCount: "파일 {count}개",
    fileCountOne: "파일 1개",
    build: ".ipkg 만들기",
    footer: "매니페스트는 압축 루트에 기록됩니다. 진입점은 파일 목록에 있어야 합니다.",
    checklistTitle: "빌드 준비 상태",
    needId: "앱 ID는 com.example.app 형식",
    needVersion: "버전은 시맨틱 형식(1.0.0)",
    needName: "이름이 입력됨",
    needEntry: "진입점이 파일 목록에 있음",
    needFiles: "파일이 하나 이상 추가됨",
    needIcon: "패키지에 아이콘이 있음",
    errId: "앱 ID는 소문자 역방향 도메인 형식이어야 합니다. 예: com.example.hello",
    errVersion: "버전은 시맨틱 형식이어야 합니다. 예: 1.0.0",
    errName: "이름을 입력하세요.",
    errAuthor: "제작자를 입력하세요.",
    errDescription: "설명을 입력하세요.",
    errEntry: "진입점 \"{path}\" 이(가) 파일 목록에 없습니다.",
    errIcon: "metadata/icon.png 가 필요합니다 (또는 자동 생성 아이콘을 켜세요).",
    errUnsafe: "패키지에 안전하지 않은 경로가 있습니다: {path}",
    problemOne: "문제 1건",
    problemMany: "문제 {count}건",
    saveFailed: "패키지를 저장하지 못했습니다",
    resultTitle: "패키지 완성",
    resFile: "파일",
    resSaved: "저장 위치",
    resSize: "크기",
    resEntries: "항목 수",
    resHint: ".ipkg 를 더블클릭하면 설치됩니다. 런처가 요청한 권한을 시스템 대화상자로 승인받고, 나중에 라이브러리 → ⋯ → 제거로 지울 수 있습니다.",
    docsSub: "이 앱에 포함된 것이 아니라 저장소에서 내려받습니다.",
    docsSearch: "SDK 검색",
    docsReload: "저장소에서 다시 불러오기",
    docsIdle: "SDK 탭을 열면 문서를 불러옵니다.",
    docsLoading: "저장소에서 SDK 문서를 내려받는 중…",
    docsEmpty: "이 주소에서 문서를 찾지 못했습니다.",
    docsOffline: "저장소에 연결하지 못했습니다. 네트워크와 설정의 저장소 주소를 확인하세요.",
    docsNoRepo: "저장소가 설정되어 있지 않습니다. 런처 설정에서 추가한 뒤 새로 고치세요.",
    docsLoaded: "문서 {count}개를 불러왔습니다",
    docsNoMatch: "일치하는 항목이 없습니다.",
    setLanguage: "언어",
    setLanguageHint: "현재 표시 언어: {language}. 자동은 NAPP 런처를 따릅니다 (런처: {launcher}).",
    setTheme: "테마",
    setThemeHint: "자동은 NAPP 런처를 따릅니다.",
    setNotify: "시스템 알림",
    notifyGranted: "허용됨. 메시지가 Windows 알림으로 표시됩니다.",
    notifyDenied: "허용되지 않음. 런처의 이 앱 권한(라이브러리 → 권한)에서 \"notifications\" 를 허용하세요.",
    notifyTest: "테스트 알림 보내기",
    notifyTestBody: "IPKG Studio 가 보낸 시스템 알림입니다.",
    notifyBuiltTitle: "패키지 생성 완료",
    setRestartNote: "NAPP 런처에서 언어를 바꾸면 이 앱은 다음에 실행할 때 반영됩니다. 위 설정은 즉시 바뀝니다.",
    optAuto: "NAPP 런처 따르기",
    optDark: "다크",
    optLight: "라이트",
    launcherLanguageEn: "영어",
    launcherLanguageKo: "한국어",
    chipTitle: "언어: {language} · 테마: {theme} · 강조색: {accent}",
  },
};

function t(key, values) {
  const table = STRINGS[language] || STRINGS.en;
  let text = table[key] !== undefined ? table[key] : STRINGS.en[key] || key;
  if (values) {
    for (const name of Object.keys(values)) text = text.split(`{${name}}`).join(String(values[name]));
  }
  return text;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
  ));
}

// OS notification through the host (window.napp.notify). Only available when the
// app holds the "notifications" permission. // 호스트를 통한 OS 알림. "notifications" 권한이 있을 때만 가능
function notificationsAllowed() {
  return !!(environment && environment.notificationsGranted && typeof environment.notify === "function");
}

function notifyUser(title, body) {
  if (notificationsAllowed()) environment.notify(title, body);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function showProblems(list) {
  if (!list.length) {
    problems.hidden = true;
    problems.innerHTML = "";
    return;
  }
  problems.hidden = false;
  const heading = list.length === 1 ? t("problemOne") : t("problemMany", { count: list.length });
  problems.innerHTML = `<strong>${escapeHtml(heading)}</strong><ul>${list
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}

// ---------------------------------------------------------------------------
// Files

function render() {
  fileList.innerHTML = "";
  if (files.size === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = t("noFiles");
    fileList.appendChild(empty);
  } else {
    const names = [...files.keys()].sort();
    for (const name of names) {
      const item = document.createElement("li");

      const label = document.createElement("span");
      label.className = "name";
      label.textContent = name;

      const size = document.createElement("span");
      size.className = "size";
      size.textContent = formatBytes(files.get(name).length);

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.type = "button";
      remove.title = t("removeFile");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        files.delete(name);
        render();
      });

      item.append(label, size, remove);
      fileList.appendChild(item);
    }
  }
  $("file-summary").textContent = files.size === 1 ? t("fileCountOne") : t("fileCount", { count: files.size });
  syncEntryOptions();
  refreshIconPreview();
  refreshWindowIconPreview();
  renderChecklist();
}

// ---------------------------------------------------------------------------
// Entry point suggestions and the package icon

function syncEntryOptions() {
  const options = $("entry-options");
  options.innerHTML = "";
  for (const path of [...files.keys()].sort()) {
    if (!/\.html?$/i.test(path)) continue;
    const option = document.createElement("option");
    option.value = path;
    options.appendChild(option);
  }
}

function iconBytes() {
  return files.get(APP_ICON_PATH) || null;
}

// Shared preview renderer for the app icon and the window icon. Each slot keeps
// its own object URL so switching one preview cannot leak the other.
// 앱 아이콘과 창 아이콘에 공통으로 쓰는 미리보기 렌더러. 슬롯마다 object URL 을
// 따로 두어 한쪽 미리보기가 다른 쪽을 해제하지 않게 한다.
function refreshImagePreview(imageId, clearId, infoId, path, slot, emptyKey, okKey) {
  if (slot.url) {
    URL.revokeObjectURL(slot.url);
    slot.url = "";
  }
  const image = $(imageId);
  const bytes = files.get(path) || null;
  if (bytes) {
    slot.url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    image.src = slot.url;
    image.style.visibility = "visible";
  } else {
    image.removeAttribute("src");
    image.style.visibility = "hidden";
  }
  $(clearId).disabled = !bytes;
  $(infoId).textContent = bytes ? t(okKey) : t(emptyKey);
}

function refreshIconPreview() {
  refreshImagePreview("icon-preview", "clear-icon", "icon-info", APP_ICON_PATH,
                      iconPreview, "iconNone", "iconInfo");
}

function refreshWindowIconPreview() {
  refreshImagePreview("window-icon-preview", "clear-window-icon", "window-icon-info",
                      WINDOW_ICON_PATH, windowIconPreview, "windowIconNone", "windowIconInfo");
}

// Downscales to at most 512 px and re-encodes as PNG. The manifest points at a
// fixed path whatever image the user picked, so the package shape never depends
// on the source file name.
// 512px 이하로 줄여 PNG 로 저장한다. 어떤 이미지를 고르든 매니페스트는 고정 경로를
// 가리키므로 패키지 모양이 원본 파일 이름에 좌우되지 않는다.
async function useImageFile(file, path, errorKey) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("png encoding failed");
    files.set(path, new Uint8Array(await blob.arrayBuffer()));
    render();
  } catch (error) {
    showProblems([t(errorKey)]);
  }
}

function useIconFile(file) {
  return useImageFile(file, APP_ICON_PATH, "iconReadFailed");
}

function useWindowIconFile(file) {
  return useImageFile(file, WINDOW_ICON_PATH, "errWindowIcon");
}

function markWindowCustomized() {
  windowCustomized = true;
  const box = document.querySelector('input[data-permission="window"]');
  if (box) box.checked = true;
  renderChecklist();
}

function updateSavePath() {
  const label = $("save-path");
  label.textContent = saveFolder || t("saveDefault");
  label.classList.toggle("is-set", saveFolder.length > 0);
  $("reset-folder").disabled = saveFolder.length === 0;
}

async function pickSaveFolder() {
  if (!environment || typeof environment.pickFolderPath !== "string") {
    showProblems([t("folderUnavailable")]);
    return;
  }
  try {
    const response = await fetch(environment.pickFolderPath, { method: "POST" });
    const reply = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(reply.error || `host returned ${response.status}`);
    if (reply.cancelled) return;
    saveFolder = reply.path || "";
    updateSavePath();
  } catch (error) {
    showProblems([t("folderUnavailable")]);
  }
}

async function addFile(file, path) {
  if (!path) return;
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean.split("/").includes("..")) return;
  if (clean === "manifest.json") return;
  files.set(clean, new Uint8Array(await file.arrayBuffer()));
}

async function addFileList(list, stripFirstSegment) {
  for (const file of list) {
    let path = file.webkitRelativePath || file.name;
    if (stripFirstSegment) {
      const parts = path.split("/");
      if (parts.length > 1) path = parts.slice(1).join("/");
    }
    await addFile(file, path);
  }
  render();
}

function permissions() {
  const selected = [];
  for (const [name] of PERMISSIONS) {
    const input = document.querySelector(`input[data-permission="${name}"]`);
    if (input && input.checked) selected.push(name);
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Readiness checklist — the same rules the build enforces, shown as you type.

function renderChecklist() {
  const host = $("checklist");
  const id = $("app-id").value.trim();
  const version = $("app-version").value.trim();
  const name = $("app-name").value.trim();
  const entry = $("app-entry").value.trim().replace(/^\/+/, "");
  const autoIcon = $("auto-icon").checked;

  const items = [
    [APP_ID_PATTERN.test(id), t("needId")],
    [SEMVER_PATTERN.test(version), t("needVersion")],
    [name.length > 0, t("needName")],
    [files.size > 0, t("needFiles")],
    [entry.length > 0 && files.has(entry), t("needEntry")],
    [files.has("metadata/icon.png") || autoIcon, t("needIcon")],
  ];

  host.innerHTML = "";
  for (const [done, label] of items) {
    const item = document.createElement("li");
    item.className = done ? "done" : "";
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = done ? "✓" : "○";
    const text = document.createElement("span");
    text.textContent = label;
    item.append(mark, text);
    host.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// Package build

function generatedIcon(letter) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, "#18223a");
  gradient.addColorStop(1, "#070a10");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = (environment && environment.accentColor) || "#3d7df0";
  context.fillRect(0, 108, 128, 20);
  context.fillStyle = "#eef2f8";
  context.font = "bold 64px 'Segoe UI', system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(letter, 64, 58);
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function validate(entry, id, version, name, author, description, window) {
  const list = [];
  if (!APP_ID_PATTERN.test(id)) list.push(t("errId"));
  if (!SEMVER_PATTERN.test(version)) list.push(t("errVersion"));
  if (!name.trim()) list.push(t("errName"));
  if (!author.trim()) list.push(t("errAuthor"));
  if (!description.trim()) list.push(t("errDescription"));
  if (!files.has(entry)) list.push(t("errEntry", { path: entry }));
  if (!files.has("metadata/icon.png") && !$("auto-icon").checked) list.push(t("errIcon"));
  if (window.customized) {
    if (window.title.length > 80) list.push(t("errWindowTitle"));
    if (!Number.isFinite(window.width) || window.width < 480 || window.width > 3840)
      list.push(t("errWindowWidth"));
    if (!Number.isFinite(window.height) || window.height < 360 || window.height > 2160)
      list.push(t("errWindowHeight"));
  }
  // The window block (and therefore the "window" permission) is needed as soon as
  // any window preference is written, including a window icon added by hand.
  // 창 설정이 하나라도 기록되면(사용자가 직접 추가한 창 아이콘 포함) window 블록과
  // "window" 권한이 함께 필요하다.
  if (window.customized || window.icon) {
    if (!permissions().includes("window")) list.push(t("errWindowPermission"));
  }
  for (const path of files.keys()) {
    if (path.includes("..") || path.startsWith("/")) list.push(t("errUnsafe", { path }));
  }
  return list;
}

async function build() {
  const id = $("app-id").value.trim();
  const version = $("app-version").value.trim();
  const name = $("app-name").value.trim();
  const author = $("app-author").value.trim();
  const description = $("app-description").value.trim();
  const license = $("app-license").value.trim() || "MIT";
  const entry = $("app-entry").value.trim().replace(/^\/+/, "");
  const window = {
    customized: windowCustomized,
    title: $("window-title").value.trim(),
    width: Number.parseInt($("window-width").value, 10),
    height: Number.parseInt($("window-height").value, 10),
    icon: files.has(WINDOW_ICON_PATH),
    tray: $("window-tray").checked,
  };

  const problemsFound = validate(entry, id, version, name, author, description, window);
  showProblems(problemsFound);
  if (problemsFound.length) {
    resultShown = false;
    result.hidden = true;
    return;
  }

  const payload = new Map(files);
  if ($("auto-icon").checked) {
    if (!payload.has(APP_ICON_PATH)) {
      const icon = await generatedIcon(name.charAt(0).toUpperCase() || "N");
      payload.set(APP_ICON_PATH, icon);
    }
    if (!payload.has("metadata/preview.png")) {
      payload.set("metadata/preview.png", payload.get(APP_ICON_PATH));
    }
  }

  // OS notifications need 1.1.0; window title/size/tray need 1.3.0; a custom
  // window icon needs 1.4.0.
  // OS 알림은 1.1.0, 창 제목/크기/트레이는 1.3.0, 창 아이콘은 1.4.0 이상 런타임이 필요하다.
  const minimumRuntime = window.icon
    ? "1.4.0"
    : window.customized
      ? "1.3.0"
      : permissions().includes("notifications") ? "1.1.0" : "1.0.0";

  const manifest = {
    format: "IPKG",
    format_version: 1,
    app: { id, name, version, description, author, license },
    runtime: { type: "chromium", minimum_version: minimumRuntime },
    sdk: { minimum_version: "1.0.0" },
    entry,
    platforms: ["windows-x64", "linux-x64"],
    permissions: permissions(),
    metadata: { icon: APP_ICON_PATH, preview: "metadata/preview.png" },
  };

  if (window.customized || window.icon) {
    const block = {};
    // Size/title/tray are only written once the user actually changed them; the
    // icon is written whenever the package carries one.
    // 제목/크기/트레이는 사용자가 실제로 바꿨을 때만, 아이콘은 패키지에 있으면 언제나 기록한다.
    if (window.customized) {
      if (window.title) block.title = window.title;
      block.width = window.width;
      block.height = window.height;
      if (window.tray) block.tray = true;
    }
    if (window.icon) block.icon = WINDOW_ICON_PATH;
    manifest.window = block;
  }

  const encoder = new TextEncoder();
  const entries = [
    { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)) },
  ];
  for (const path of [...payload.keys()].sort()) {
    entries.push({ name: path, data: payload.get(path) });
  }

  const zip = createZip(entries);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", zip));
  const sha = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const fileName = `${id}-${version}.ipkg`;
  // The host writes the package into the app's downloads folder, or into the
  // folder the user picked with __host/pick-folder. The browser download manager
  // is not used because it cannot choose a safe target path.
  // 호스트가 앱의 downloads 폴더, 또는 사용자가 __host/pick-folder 로 고른 폴더에 저장한다.
  const query = saveFolder ? `?folder=${encodeURIComponent(saveFolder)}` : "";
  let saved = null;
  try {
    const response = await fetch(`/__host/export/${encodeURIComponent(fileName)}${query}`, {
      method: "POST",
      body: zip,
    });
    const reply = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(reply.error || `host returned ${response.status}`);
    saved = reply;
  } catch (error) {
    problems.hidden = false;
    problems.innerHTML = `<strong>${escapeHtml(t("saveFailed"))}</strong><ul><li>${escapeHtml(error.message)}</li></ul>`;
    resultShown = false;
    result.hidden = true;
    return;
  }

  $("result-name").textContent = saved ? saved.name : fileName;
  $("result-path").textContent = saved ? saved.path : "";
  $("result-size").textContent = formatBytes(zip.length);
  $("result-entries").textContent = String(entries.length);
  $("result-sha").textContent = sha;
  resultShown = true;
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  notifyUser(t("notifyBuiltTitle"), saved ? saved.name : fileName);
}

// ---------------------------------------------------------------------------
// SDK & API documentation
// The content lives in the repository (docs/sdk.json) and is downloaded on
// demand, so a new SDK article does not require shipping a new Studio package.

const docsState = {
  loaded: false,
  loading: false,
  document: null,
  activeId: "",
  query: "",
};

function docsStatus(message, tone) {
  const status = $("docs-status");
  status.removeAttribute("data-i18n"); // dynamic text now: language switches must not overwrite it
  status.hidden = false;
  status.className = `docs-status${tone ? " " + tone : ""}`;
  status.textContent = message;
}

function documentSectionId(section) {
  return section.id || section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// Minimal Markdown: headings, paragraphs, bullet lists, fenced code and inline
// code. Text always goes through textContent, so remote docs cannot inject HTML.
function renderMarkdown(container, markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let list = null;
  let code = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const node = document.createElement("p");
    appendInline(node, paragraph.join(" "));
    container.appendChild(node);
    paragraph = [];
  };
  const flushList = () => {
    if (list) container.appendChild(list);
    list = null;
  };
  const flushCode = () => {
    if (!code) return;
    const pre = document.createElement("pre");
    const block = document.createElement("code");
    block.textContent = code.lines.join("\n");
    pre.appendChild(block);
    container.appendChild(pre);
    code = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (code) {
      if (line.trim().startsWith("```")) flushCode();
      else code.lines.push(raw);
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      code = { lines: [] };
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const node = document.createElement(`h${heading[1].length + 1}`);
      appendInline(node, heading[2]);
      container.appendChild(node);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list) list = document.createElement("ul");
      const item = document.createElement("li");
      appendInline(item, bullet[1]);
      list.appendChild(item);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  flushCode();
}

function appendInline(parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function apiEntry(entry) {
  const card = document.createElement("div");
  card.className = "api-entry";

  const head = document.createElement("div");
  head.className = "api-head";
  const name = document.createElement("code");
  name.className = "api-name";
  name.textContent = entry.name || "";
  head.appendChild(name);
  if (entry.returns) {
    const returns = document.createElement("span");
    returns.className = "api-returns";
    returns.textContent = entry.returns;
    head.appendChild(returns);
  }
  card.appendChild(head);

  if (entry.signature) {
    const signature = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = entry.signature;
    signature.appendChild(code);
    card.appendChild(signature);
  }
  if (entry.description) {
    const description = document.createElement("p");
    appendInline(description, entry.description);
    card.appendChild(description);
  }
  if (entry.example) {
    const example = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = entry.example;
    example.appendChild(code);
    card.appendChild(example);
  }
  return card;
}

function renderDocsBody(id) {
  // Only the rendered article is replaced; #docs-status must stay in the DOM,
  // otherwise later status updates write into a detached node.
  // 렌더링된 본문만 교체한다. #docs-status 가 DOM 에 남아야 상태 문구가 보인다.
  const body = $("docs-content");
  const doc = docsState.document;
  if (!doc) return;
  const section = (doc.sections || []).find((item) => documentSectionId(item) === id);
  if (!section) return;

  docsState.activeId = id;
  body.innerHTML = "";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = doc.title || "NAPP SDK";
  body.appendChild(eyebrow);

  const heading = document.createElement("h1");
  heading.textContent = section.title;
  body.appendChild(heading);

  if (section.summary) {
    const summary = document.createElement("p");
    summary.className = "lead";
    appendInline(summary, section.summary);
    body.appendChild(summary);
  }

  const markdown = document.createElement("div");
  markdown.className = "docs-content";
  renderMarkdown(markdown, section.body);
  body.appendChild(markdown);

  const api = (doc.api || []).filter((entry) => entry.section === id);
  if (api.length) {
    const apiHeading = document.createElement("h2");
    apiHeading.textContent = "API";
    body.appendChild(apiHeading);
    for (const entry of api) body.appendChild(apiEntry(entry));
  }

  for (const button of document.querySelectorAll("#docs-list button")) {
    button.classList.toggle("is-active", button.dataset.id === id);
  }
}

function renderDocsIndex() {
  const doc = docsState.document;
  const list = $("docs-list");
  list.innerHTML = "";
  if (!doc) return;

  const query = docsState.query.toLowerCase();
  const sections = (doc.sections || []).filter((section) => {
    if (!query) return true;
    const haystack = `${section.title} ${section.summary || ""} ${section.body || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  for (const section of sections) {
    const id = documentSectionId(section);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = id;
    button.className = "docs-link";
    button.textContent = section.title;
    button.addEventListener("click", () => renderDocsBody(id));
    item.appendChild(button);
    list.appendChild(item);
  }

  if (!sections.length) {
    const empty = document.createElement("li");
    empty.className = "docs-empty";
    empty.textContent = t("docsNoMatch");
    list.appendChild(empty);
  }
}

async function loadDocs(force) {
  if (docsState.loading) return;
  if (docsState.loaded && !force) return;

  const base = environment && environment.repositoryUrl;
  const source = $("docs-source");
  if (!base) {
    docsStatus(t("docsNoRepo"), "warn");
    source.textContent = "window.napp.repositoryUrl is empty";
    return;
  }

  const url = new URL("docs/sdk.json", base).href;
  source.textContent = url;
  docsStatus(t("docsLoading"));

  docsState.loading = true;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const document = await response.json();
    docsState.document = document;
    docsState.loaded = true;
    renderDocsIndex();

    const sections = document.sections || [];
    if (!sections.length) {
      docsStatus(t("docsEmpty"), "warn");
      return;
    }
    docsStatus(t("docsLoaded", { count: sections.length }), "ok");
    renderDocsBody(documentSectionId(sections[0]));
    console.info(`sdk docs loaded: ${sections.length} sections from ${url}`);
  } catch (error) {
    docsState.loaded = false;
    docsStatus(`${t("docsOffline")} (${error.message})`, "warn");
    console.warn(`sdk docs failed: ${url} (${error.message})`);
  } finally {
    docsState.loading = false;
  }
}

// ---------------------------------------------------------------------------
// Shell

function setView(view) {
  currentView = view;
  const isBuild = view === "build";
  const isDocs = view === "docs";
  const isSettings = view === "settings";

  $("build-view").hidden = !isBuild;
  $("docs-view").hidden = !isDocs;
  $("settings-view").hidden = !isSettings;
  // The result card comes back when returning to Build (it used to stay hidden).
  // 빌드로 돌아오면 결과 카드가 다시 보인다 (예전에는 계속 숨겨져 있었다)
  result.hidden = !(isBuild && resultShown);
  // Only the Build view has a footer; hiding its children left an empty bar.
  // 푸터는 빌드 화면에만 있다. 자식만 숨기면 빈 바가 남는다.
  $("footer").hidden = !isBuild;

  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  }

  $("page-title").textContent = isDocs ? t("docsTitle") : isSettings ? t("settingsTitle") : t("title");
  if (isDocs) loadDocs(false);
}

function applyTheme() {
  const theme = resolveTheme();
  document.documentElement.setAttribute("data-napp-theme", theme);
  document.documentElement.style.colorScheme = theme;
  $("env-theme").textContent = theme === "light" ? "LIGHT" : "DARK";
  updateChipTitle();
}

function updateChipTitle() {
  const accent = (environment && environment.accent) || "blue";
  const match = /Chrome\/([\d.]+)/.exec(navigator.userAgent || "");
  $("env-chip").title =
    t("chipTitle", { language: language.toUpperCase(), theme: resolveTheme(), accent }) +
    (match ? ` · Chromium ${match[1]}` : "");
}

function updateSettingsHints() {
  const launcherCode = environment && environment.language === "ko" ? "ko" : "en";
  $("set-language-hint").textContent = t("setLanguageHint", {
    language: language === "ko" ? STRINGS.ko.launcherLanguageKo : STRINGS.en.launcherLanguageEn,
    launcher: t(launcherCode === "ko" ? "launcherLanguageKo" : "launcherLanguageEn"),
  });
  $("set-notify-hint").textContent = notificationsAllowed() ? t("notifyGranted") : t("notifyDenied");
  $("set-notify-test").disabled = !notificationsAllowed();
}

// Re-translates the whole page in place; no reload, no lost input.
// 페이지 전체를 그 자리에서 다시 번역한다. 새로고침도, 입력 손실도 없다.
function applyLanguage() {
  language = resolveLanguage();
  document.documentElement.lang = language;

  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-placeholder]"))
    node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll("[data-i18n-title]")) node.title = t(node.dataset.i18nTitle);
  for (const node of document.querySelectorAll("[data-i18n-aria]"))
    node.setAttribute("aria-label", t(node.dataset.i18nAria));
  for (const [name] of PERMISSIONS) {
    const label = document.querySelector(`[data-permission-label="${name}"]`);
    if (label) label.textContent = t(`perm_${name}`);
  }

  $("env-language").textContent = language.toUpperCase();
  render();
  setView(currentView);
  if (docsState.loaded) renderDocsIndex();
  updateSettingsHints();
  updateSavePath();
  updateChipTitle();
}

function initEnvironment() {
  if (!environment) {
    $("env-chip").hidden = true;
    return;
  }
  console.info(
    `napp environment: lang=${environment.language} theme=${environment.theme} repo=${environment.repositoryUrl || "none"} notifications=${notificationsAllowed()}`,
  );
}

function initSettings() {
  $("set-language").value = languagePreference;
  $("set-theme").value = themePreference;
  $("set-language").addEventListener("change", (event) => {
    languagePreference = event.target.value;
    writePreference(LANGUAGE_KEY, languagePreference);
    applyLanguage();
  });
  $("set-theme").addEventListener("change", (event) => {
    themePreference = event.target.value;
    writePreference(THEME_KEY, themePreference);
    applyTheme();
  });
  $("set-notify-test").addEventListener("click", () => notifyUser("IPKG Studio", t("notifyTestBody")));
}

function init() {
  initEnvironment();

  const host = $("permissions");
  for (const [name] of PERMISSIONS) {
    const wrapper = document.createElement("label");
    wrapper.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.permission = name;
    input.checked = name === "storage";
    const text = document.createElement("span");
    text.dataset.permissionLabel = name;
    text.textContent = t(`perm_${name}`);
    wrapper.append(input, text);
    host.appendChild(wrapper);
  }

  $("pick-files").addEventListener("click", () => $("file-input").click());
  $("pick-folder").addEventListener("click", () => $("folder-input").click());
  $("file-input").addEventListener("change", (event) => {
    addFileList(event.target.files, false);
    event.target.value = "";
  });
  $("folder-input").addEventListener("change", (event) => {
    addFileList(event.target.files, true);
    event.target.value = "";
  });
  $("clear-files").addEventListener("click", () => {
    files.clear();
    render();
  });
  $("build").addEventListener("click", build);

  for (const id of ["app-id", "app-version", "app-name", "app-entry", "auto-icon"]) {
    $(id).addEventListener("input", renderChecklist);
    $(id).addEventListener("change", renderChecklist);
  }

  // Icon picker: any readable image becomes metadata/icon.png.
  // 아이콘 선택: 읽을 수 있는 이미지를 metadata/icon.png 로 만든다.
  $("pick-icon").addEventListener("click", () => $("icon-input").click());
  $("icon-input").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (file) useIconFile(file);
  });
  $("clear-icon").addEventListener("click", () => {
    files.delete(APP_ICON_PATH);
    render();
  });

  // Window icon picker: any readable image becomes metadata/window-icon.png.
  // 창 아이콘 선택: 읽을 수 있는 이미지를 metadata/window-icon.png 로 만든다.
  $("pick-window-icon").addEventListener("click", () => $("window-icon-input").click());
  $("window-icon-input").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (file) {
      markWindowCustomized();
      useWindowIconFile(file);
    }
  });
  $("clear-window-icon").addEventListener("click", () => {
    files.delete(WINDOW_ICON_PATH);
    render();
  });

  // Any window edit switches the "window" permission on, so the install dialog
  // shows exactly why the app asks for it.
  // 창 설정을 건드리면 "window" 권한을 자동으로 켜서 설치 대화상자에 이유가 보이게 한다.
  for (const id of ["window-title", "window-width", "window-height", "window-tray"]) {
    $(id).addEventListener("input", markWindowCustomized);
    $(id).addEventListener("change", markWindowCustomized);
  }

  // Save destination: a native folder dialog hosted by NAPP, never a free-form
  // path typed into the page.
  // 저장 위치: 페이지에 경로를 입력받지 않고, NAPP 호스트의 네이티브 폴더 대화상자를 쓴다.
  $("pick-folder").addEventListener("click", pickSaveFolder);
  $("reset-folder").addEventListener("click", () => {
    saveFolder = "";
    updateSavePath();
  });

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  }
  $("docs-reload").addEventListener("click", () => loadDocs(true));
  $("docs-search").addEventListener("input", (event) => {
    docsState.query = event.target.value.trim();
    renderDocsIndex();
  });

  const drop = $("drop");
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", async (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    const dropped = event.dataTransfer.files;
    if (dropped && dropped.length) await addFileList(dropped, false);
  });

  initSettings();
  applyTheme();
  applyLanguage();
}

init();
