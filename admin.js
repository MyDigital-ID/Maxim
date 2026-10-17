// ============================================================
// Maxim Casual Wear - Admin Panel
// ============================================================

const OWNER_KEY  = "maxim_admin_owner";
const REPO_KEY   = "maxim_admin_repo";
const FOLDER_KEY = "maxim_admin_folder";

let GITHUB_OWNER  = localStorage.getItem(OWNER_KEY) || "";
let GITHUB_REPO   = localStorage.getItem(REPO_KEY) || "";
let FOLDER_PATH   = localStorage.getItem(FOLDER_KEY) || "";
let GITHUB_BRANCH = "main";

// يشفّر كل جزء من المسار (مهم لو اسم الفولدر فيه عربي أو مسافات)
function encodePath(p) {
  return String(p).split("/").map(encodeURIComponent).join("/");
}

let DATA_PATH   = "";
let IMAGES_PATH = "";
let DATA_API    = "";

function recomputeGithubPaths() {
  DATA_PATH   = FOLDER_PATH ? `${FOLDER_PATH}/site-data.json` : "site-data.json";
  IMAGES_PATH = FOLDER_PATH ? `${FOLDER_PATH}/assets/uploads` : "assets/uploads";
  DATA_API    = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodePath(DATA_PATH)}`;
}
recomputeGithubPaths();

function pagesBaseUrl() {
  const ownerLower = GITHUB_OWNER.toLowerCase();
  const repoLower  = GITHUB_REPO.toLowerCase();
  if (repoLower === `${ownerLower}.github.io`) return `https://${ownerLower}.github.io`;
  return `https://${ownerLower}.github.io/${GITHUB_REPO}`;
}

const TOKEN_KEY = "maxim_admin_token";
let TOKEN = localStorage.getItem(TOKEN_KEY) || "";
let storeData = null;
let currentSha = null;
let pendingImages = {};
let pendingFeatured = [];
let pendingOffers = {};   // { offerId: File } للصور العروض قيد الرفع

const $ = (id) => document.getElementById(id);

// ============================================================
// 🎨 قائمة الألوان الافتراضية
// ============================================================
const COLOR_PALETTE = [
  "أبيض", "أسود", "بني", "بيج فاتح", "بيج", "أزرق", "لبني",
  "أخضر", "زيتي", "أحمر", "أصفر", "رمادي", "كحلي", "برتقالي"
];

// ============================================================
// أدوات
// ============================================================
function ghHeaders() {
  return {
    "Authorization": `Bearer ${TOKEN}`,
    "Accept": "application/vnd.github+json"
  };
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function compressImage(file, maxSize = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(file);
    const img = new Image();
    const fail = (m) => { URL.revokeObjectURL(objUrl); reject(new Error(m)); };
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) return fail("الصورة فاضية أو تالفة: " + file.name);
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = (maxSize / w) * h; w = maxSize; }
          else { w = (maxSize / h) * w; h = maxSize; }
        }
        w = Math.max(1, Math.round(w));
        h = Math.max(1, Math.round(h));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objUrl);
          if (!blob) return reject(new Error("تعذر ضغط الصورة (غالبًا الصورة كبيرة على ذاكرة الجهاز): " + file.name));
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("تعذر قراءة الصورة بعد الضغط: " + file.name));
          reader.readAsDataURL(blob);
        }, "image/jpeg", quality);
      } catch (e) {
        fail("تعذر معالجة الصورة " + file.name + ": " + ((e && e.message) || e));
      }
    };
    img.onerror = () => fail("تعذر فتح الصورة " + file.name + " (الصيغة غير مدعومة أو الملف تالف) — جرّب صورة JPG أو PNG");
    img.src = objUrl;
  });
}

let statusTimer = null;
function showStatus(msg, type = "ok") {
  const el = $("statusMsg");
  el.textContent = msg;
  el.className = "show " + type;
  clearTimeout(statusTimer);
  // رسائل الخطأ تفضل أطول عشان تلحق تقراها
  statusTimer = setTimeout(() => { el.className = ""; }, type === "err" ? 15000 : 4500);
}

function showLoading(text = "جاري التحميل...") {
  $("loadingText").textContent = text;
  $("loadingOverlay").classList.add("show");
}

function hideLoading() {
  $("loadingOverlay").classList.remove("show");
}

function uid(prefix = "id") {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

// ============================================================
// GitHub API — طبقة اتصال مقاومة للأعطال
// (إعادة محاولة تلقائية + مهلة + فاصل بين الكتابات + رسائل واضحة)
// ============================================================
const GH_TIMEOUT_MS   = 30000;                 // أقصى مدة للطلب الواحد
const GH_MAX_ATTEMPTS = 4;                     // عدد المحاولات لكل طلب
const GH_WRITE_GAP_MS = 1100;                  // أقل فاصل بين أي عمليتين كتابة
const GH_BACKOFF_MS   = [1500, 3500, 7000];    // الانتظار بين المحاولات
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class GhError extends Error {
  constructor(message, status = 0, kind = "other") {
    super(message);
    this.name = "GhError";
    this.status = status;
    this.kind = kind;   // auth | notfound | forbidden | ratelimit | network | conflict | badjson | cancelled | other
  }
}

// يحوّل أي خطأ لنص مفهوم (بدل [object Event] وغيرها)
function errMsg(e) {
  if (!e) return "سبب غير معروف";
  if (e instanceof GhError) return e.message;
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  if (typeof Event !== "undefined" && e instanceof Event) return "تعذر قراءة الصورة (الملف تالف أو صيغته غير مدعومة)";
  return String(e);
}

function notifyRetry(text) {
  const t = $("loadingText"), o = $("loadingOverlay");
  if (t && o && o.classList.contains("show")) t.textContent = text;
}

let lastWriteAt = 0;
async function throttleWrite() {
  const wait = lastWriteAt + GH_WRITE_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastWriteAt = Date.now();
}

// يحدد هل الفشل يستاهل إعادة محاولة، ويرجّع رسالة عربي واضحة
function classifyFailure(status, data, headers, attempt) {
  const apiMsg = (data && data.message) || "";
  const code = " (كود " + status + ")";

  if (status === 401) {
    return { retry: false, err: new GhError("التوكن غير صحيح أو منتهي الصلاحية — اعمل توكن جديد وسجّل الدخول تاني" + code, status, "auth") };
  }
  if (status === 403 || status === 429) {
    const retryAfter = parseInt(headers.get("retry-after") || "", 10);
    const remaining = headers.get("x-ratelimit-remaining");
    const reset = parseInt(headers.get("x-ratelimit-reset") || "", 10);
    const isLimit = status === 429 || !isNaN(retryAfter) || remaining === "0" ||
                    /rate limit|abuse|secondary|too many/i.test(apiMsg);
    if (isLimit) {
      let wait = !isNaN(retryAfter) ? retryAfter * 1000
               : (remaining === "0" && !isNaN(reset)) ? reset * 1000 - Date.now()
               : 5000 * attempt;
      wait = Math.min(Math.max(wait, 2000), 60000);
      return { retry: true, waitMs: wait, err: new GhError("GitHub طلب تهدئة بسبب كثرة الطلبات — استنى دقيقة وجرّب تاني" + code, status, "ratelimit") };
    }
    return { retry: false, err: new GhError("التوكن مالوش صلاحية الكتابة على الريبو (لازم Contents: Read and write)" + code, status, "forbidden") };
  }
  if (status === 404) {
    return { retry: false, err: new GhError("الملف أو الريبو مش موجود، أو التوكن مالوش صلاحية على الريبو ده" + code, status, "notfound") };
  }
  if (status === 409) {
    return { retry: true, err: new GhError("تعارض في النسخة على GitHub (حصل تعديل في نفس اللحظة)" + code, status, "conflict") };
  }
  if (status === 422) {
    // أغلب حالات 422 هنا بتكون مشكلة sha — بتتحل بإعادة المحاولة
    return { retry: /sha/i.test(apiMsg), err: new GhError("GitHub رفض الطلب: " + (apiMsg || "بيانات غير صالحة") + code, status, "other") };
  }
  if (status >= 500) {
    return { retry: true, err: new GhError("GitHub مشغول مؤقتًا" + code, status, "other") };
  }
  return { retry: false, err: new GhError((apiMsg || "خطأ غير متوقع من GitHub") + code, status, "other") };
}

// الدالة الأساسية: كل طلبات GitHub بتعدي من هنا
// initOrBuilder: كائن إعدادات fetch، أو دالة async (attempt, lastErr) بترجّعه (عشان نجدد الـ sha كل محاولة)
async function ghRequest(url, initOrBuilder, opts = {}) {
  const attempts = opts.attempts || GH_MAX_ATTEMPTS;
  const label = opts.label || "الاتصال بـ GitHub";
  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GH_TIMEOUT_MS);
    let failure = null;
    try {
      const init = typeof initOrBuilder === "function" ? await initOrBuilder(attempt, lastErr) : initOrBuilder;
      const isWrite = !!(init.method && init.method !== "GET");
      if (isWrite) await throttleWrite();

      const res = await fetch(url, { ...init, cache: "no-store", signal: ctrl.signal });
      let data = null, text = "";
      if (opts.raw && res.ok) text = await res.text();
      else data = await res.json().catch(() => null);
      if (isWrite) lastWriteAt = Date.now();

      if (res.ok) { clearTimeout(timer); return { status: res.status, data, text }; }
      if (opts.allow404 && res.status === 404) { clearTimeout(timer); return { status: 404, data: null, text: "" }; }
      failure = classifyFailure(res.status, data, res.headers, attempt);
    } catch (e) {
      if (e instanceof GhError) { clearTimeout(timer); throw e; }   // جاي من داخل الـ builder (بعد محاولاته)
      const timedOut = e && e.name === "AbortError";
      failure = {
        retry: true,
        err: new GhError(timedOut
          ? "الاتصال بـ GitHub أخد وقت طويل (انتهت المهلة) — اتأكد من الإنترنت"
          : "تعذر الاتصال بـ GitHub — اتأكد من الإنترنت", 0, "network")
      };
    }
    clearTimeout(timer);
    lastErr = failure.err;
    if (!failure.retry || attempt === attempts) throw failure.err;

    const wait = failure.waitMs != null ? failure.waitMs
               : GH_BACKOFF_MS[Math.min(attempt - 1, GH_BACKOFF_MS.length - 1)];
    notifyRetry(`${label}: فشلت المحاولة ${attempt} من ${attempts}، إعادة المحاولة بعد ${Math.ceil(wait / 1000)} ثانية...`);
    await sleep(wait);
  }
  throw lastErr || new GhError("فشل غير معروف");
}

let baseSha = null;   // نسخة site-data.json اللي بدأنا نعدّل عليها (لاكتشاف تعديل من جهاز تاني)

// يقرأ آخر نسخة من الملف. needText=true يرجّع المحتوى كمان
async function fetchRemote(needText) {
  const url = `${DATA_API}?ref=${GITHUB_BRANCH}&t=${Date.now()}`;
  const r = await ghRequest(url, () => ({ headers: ghHeaders() }), { label: "قراءة البيانات" });
  const info = r.data || {};
  let text = null;
  if (needText) {
    if (info.content && info.encoding === "base64") {
      text = base64ToUtf8(info.content);
    } else {
      // الملفات الأكبر من 1MB مش بترجع محتوى في الرد العادي — نقرأها بصيغة raw
      const raw = await ghRequest(url, () => ({
        headers: { ...ghHeaders(), "Accept": "application/vnd.github.raw+json" }
      }), { raw: true, label: "قراءة البيانات" });
      text = raw.text;
    }
  }
  return { sha: info.sha, text };
}

async function fetchFromGitHub() {
  const { sha, text } = await fetchRemote(true);
  currentSha = sha;
  baseSha = sha;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new GhError("ملف site-data.json على GitHub تالف أو مش JSON صحيح — راجعه قبل ما تحفظ", 0, "badjson");
  }
}

async function saveDataToGitHub() {
  const newContent = JSON.stringify(storeData, null, 2);
  const encoded = utf8ToBase64(newContent);

  // حماية: لو الملف اتعدّل من جهاز/شخص تاني بعد ما فتحت اللوحة، ما نكتبش فوقه بدون علمك
  let remote = await fetchRemote(false);
  if (baseSha && remote.sha !== baseSha) {
    await sleep(2000);                        // نتأكد إنها مش قراءة قديمة
    remote = await fetchRemote(true);
    if (remote.sha !== baseSha) {
      if (remote.text === newContent) {       // نفس البيانات اتحفظت فعلاً (ممكن الرد ضاع)
        currentSha = baseSha = remote.sha;
        return;
      }
      const go = confirm("الموقع اتعدّل من جهاز تاني بعد ما فتحت اللوحة.\nلو كملت، التعديلات دي هتتمسح وتتستبدل بنسختك.\n\nتكمل الحفظ؟");
      if (!go) throw new GhError("تم إلغاء الحفظ — اضغط 'تحديث البيانات' الأول عشان تشوف آخر نسخة", 0, "cancelled");
    }
    baseSha = remote.sha;
  }

  const res = await ghRequest(DATA_API, async (attempt) => {
    // كل محاولة بتجيب أحدث sha (أول محاولة بتستخدم اللي قريناه فوق)
    const latest = attempt === 1 ? remote : await fetchRemote(false);
    currentSha = latest.sha;
    return {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "تحديث بيانات Maxim من لوحة التحكم",
        content: encoded,
        sha: latest.sha,
        branch: GITHUB_BRANCH
      })
    };
  }, { label: "حفظ البيانات" });

  const newSha = res.data && res.data.content && res.data.content.sha;
  currentSha = newSha || currentSha;
  baseSha = newSha || null;
}

async function uploadImageToGitHub(base64Content, fileName) {
  const path = `${IMAGES_PATH}/${fileName}`;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodePath(path)}`;

  await ghRequest(url, async (attempt, lastErr) => {
    const body = {
      message: "رفع صورة: " + fileName,
      content: base64Content,
      branch: GITHUB_BRANCH
    };
    // أسماء الصور فريدة، فمش محتاجين نفحص وجودها قبل كل رفع (بيوفر طلب لكل صورة).
    // لو GitHub قال إن الملف موجود فعلاً (422) نجيب الـ sha ونعيد.
    if (lastErr && lastErr.status === 422) {
      const chk = await ghRequest(`${url}?ref=${GITHUB_BRANCH}&t=${Date.now()}`,
        () => ({ headers: ghHeaders() }),
        { allow404: true, attempts: 2, label: "فحص الصورة" });
      if (chk.data && chk.data.sha) body.sha = chk.data.sha;
    }
    return {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    };
  }, { label: "رفع الصورة" });

  return `${pagesBaseUrl()}/${encodePath(IMAGES_PATH)}/${encodeURIComponent(fileName)}`;
}

// ============================================================
// تسجيل الدخول
// ============================================================
$("loginBtn").onclick = login;
$("pwInput").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

const togglePw = $("togglePw");
if (togglePw) {
  togglePw.onclick = () => {
    const inp = $("pwInput");
    if (inp.type === "password") { inp.type = "text"; togglePw.textContent = "🙈"; }
    else { inp.type = "password"; togglePw.textContent = "👁️"; }
  };
}

async function login() {
  const owner  = $("ownerInput").value.trim().replace(/^\/+|\/+$/g, "");
  const repo   = $("repoInput").value.trim().replace(/^\/+|\/+$/g, "");
  const folder = $("folderInput").value.trim().replace(/^\/+|\/+$/g, "");
  const tok    = $("pwInput").value.trim();

  if (!owner || !repo) {
    $("loginErr").textContent = "لازم تكتب اسم المستخدم/المنظمة واسم الريبو";
    return;
  }
  if (!tok) return;

  $("loginErr").textContent = "";
  $("loginBtn").textContent = "جاري التحقق...";
  $("loginBtn").disabled = true;

  const prevOwner = GITHUB_OWNER, prevRepo = GITHUB_REPO, prevFolder = FOLDER_PATH;
  GITHUB_OWNER = owner;
  GITHUB_REPO = repo;
  FOLDER_PATH = folder;
  recomputeGithubPaths();

  try {
    TOKEN = tok;
    storeData = await fetchFromGitHub();
    localStorage.setItem(TOKEN_KEY, TOKEN);
    localStorage.setItem(OWNER_KEY, GITHUB_OWNER);
    localStorage.setItem(REPO_KEY, GITHUB_REPO);
    localStorage.setItem(FOLDER_KEY, FOLDER_PATH);
    $("loginScreen").style.display = "none";
    $("dashboard").classList.add("active");
    renderAll();
    showStatus("تم الدخول بنجاح ✅", "ok");
  } catch (e) {
    GITHUB_OWNER = prevOwner;
    GITHUB_REPO = prevRepo;
    FOLDER_PATH = prevFolder;
    recomputeGithubPaths();

    if (e && e.kind === "auth") {
      $("loginErr").textContent = "التوكن غير صحيح أو منتهي الصلاحية، أو مفيش صلاحية Push على الريبو ده";
    } else if (e && e.kind === "notfound") {
      $("loginErr").textContent = "مفيش ملف site-data.json في الريبو/الفولدر ده (أو التوكن مالوش صلاحية على الريبو) — تأكد من الأسماء والتوكن";
    } else {
      $("loginErr").textContent = "خطأ: " + errMsg(e);
    }
    $("loginBtn").textContent = "🔓 دخول";
    $("loginBtn").disabled = false;
    TOKEN = "";
  }
}

if (GITHUB_OWNER) $("ownerInput").value = GITHUB_OWNER;
if (GITHUB_REPO) $("repoInput").value = GITHUB_REPO;
if (FOLDER_PATH) $("folderInput").value = FOLDER_PATH;

if (TOKEN && GITHUB_OWNER && GITHUB_REPO) {
  $("pwInput").value = TOKEN;
  login();
}

// ============================================================
// الخروج
// ============================================================
$("logoutBtn").onclick = () => {
  if (!confirm("هيتم مسح التوكن المحفوظ. متأكد؟")) return;
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
};

// ============================================================
// تحديث البيانات
// ============================================================
$("reloadBtn").onclick = async () => {
  if (!confirm("هيتم تجاهل التعديلات غير المحفوظة. متأكد؟")) return;
  showLoading("جاري التحديث...");
  try {
    storeData = await fetchFromGitHub();
    pendingImages = {};
    pendingFeatured = [];
    pendingOffers = {};
    renderAll();
    showStatus("تم التحديث ✅", "ok");
  } catch (e) {
    showStatus("فشل التحديث: " + errMsg(e), "err");
  }
  hideLoading();
};

// ============================================================
// الحفظ
// ============================================================
let isSaving = false;

function setSaveButtonsDisabled(disabled) {
  ["saveBtn", "saveBtnBottom"].forEach((id) => {
    const el = $(id);
    if (el) { el.disabled = disabled; el.style.pointerEvents = disabled ? "none" : ""; el.style.opacity = disabled ? "0.6" : ""; }
  });
}

async function saveAll() {
  if (isSaving) return;       // يمنع الضغط المزدوج
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    showStatus("مفيش اتصال بالإنترنت دلوقتي — التعديلات لسه عندك، اضغط حفظ بعد ما النت يرجع", "err");
    return;
  }
  isSaving = true;
  setSaveButtonsDisabled(true);
  showLoading("جاري حفظ التعديلات...");
  let failed = false;
  saveStage = "";
  try {
    // ١) الصور المميزة
    if (pendingFeatured.length > 0) {
      if (!storeData.featured) storeData.featured = [];
      const total = pendingFeatured.length;
      let done = 0;
      while (pendingFeatured.length > 0) {
        saveStage = `رفع الصور المميزة (${done + 1} من ${total})`;
        showLoading(`جاري رفع الصور المميزة (${++done} من ${total})...`);
        const file = pendingFeatured[0];
        const fileName = `featured_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
        const b64 = await compressImage(file);
        const url = await uploadImageToGitHub(b64, fileName);
        storeData.featured.push(url);
        pendingFeatured.shift();   // تتشال من "قيد الرفع" بعد نجاحها بس
      }
    }

    // ٢) صور العروض
    if (Object.keys(pendingOffers).length > 0) {
      if (!storeData.offers) storeData.offers = [];
      for (const offerId of Object.keys(pendingOffers)) {
        saveStage = "رفع صور العروض";
        showLoading("جاري رفع صور العروض...");
        const file = pendingOffers[offerId];
        const fileName = `offer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
        const b64 = await compressImage(file);
        const url = await uploadImageToGitHub(b64, fileName);
        const offer = storeData.offers.find(o => o.id === offerId);
        if (offer) offer.image = url;
        delete pendingOffers[offerId];
      }
    }

    // ٣) صور المنتجات
    const pendingCount = Object.values(pendingImages).reduce((a, arr) => a + arr.length, 0);
    if (pendingCount > 0) {
      saveStage = "رفع صور المنتجات";
      showLoading(`جاري رفع ${pendingCount} صورة منتج...`);
      await uploadAllPendingImages();
    }

    // ٤) حفظ JSON
    saveStage = "حفظ البيانات";
    showLoading("جاري حفظ البيانات على GitHub...");
    await saveDataToGitHub();
    showStatus("تم الحفظ ✅ التحديث هيظهر خلال دقيقة", "ok");
  } catch (e) {
    failed = true;
    const reason = errMsg(e);
    const hint = (e && e.kind === "cancelled") ? "" : " — تعديلاتك لسه موجودة في الصفحة، اضغط حفظ تاني (ما تعملش Refresh)";
    showStatus("فشل الحفظ" + (saveStage ? " (" + saveStage + ")" : "") + ": " + reason + hint, "err");
  }
  hideLoading();
  if (failed) {
    // نحدّث الشاشة عشان الصور اللي اترفعت فعلاً ما تتعملش تاني
    try { renderAll(); } catch (e) {}
  }
  isSaving = false;
  setSaveButtonsDisabled(false);
}

let saveStage = "";

// تحذير لو حاول يقفل الصفحة أثناء الحفظ
window.addEventListener("beforeunload", (e) => {
  if (isSaving) { e.preventDefault(); e.returnValue = ""; }
});

$("saveBtn").onclick = saveAll;
$("saveBtnBottom").onclick = saveAll;

async function uploadAllPendingImages() {
  for (const productId of Object.keys(pendingImages)) {
    const files = pendingImages[productId];
    if (!files || files.length === 0) continue;

    let product = null;
    for (const cat of storeData.categories) {
      const p = cat.products.find(pp => pp.id === productId);
      if (p) { product = p; break; }
    }
    if (!product) { delete pendingImages[productId]; continue; }

    if (!product.images) product.images = [];
    if (!product.colors) product.colors = [];
    while (product.colors.length < product.images.length) product.colors.push("");

    while (files.length > 0) {
      const file = files[0];
      const fileName = `${productId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const b64 = await compressImage(file);
      const url = await uploadImageToGitHub(b64, fileName);
      product.images.push(url);
      const colorStr = (file.colorNames || []).join("، ");
      product.colors.push(colorStr);
      files.shift();   // تتشال من "قيد الرفع" بعد نجاحها بس
    }
    delete pendingImages[productId];
  }
}

// ============================================================
// عرض الكل
// ============================================================
function renderAll() {
  renderConfig();
  renderFeaturedSection();
  renderOffersSection();
  renderZones();
}

// ============================================================
// الإعدادات العامة
// ============================================================
const CONFIG_FIELDS = [
  ["brand_ar", "اسم المتجر (عربي)"],
  ["brand_en", "اسم المتجر (English)"],
  ["tagline_ar", "التاجلاين (عربي)"],
  ["about_ar", "نبذة عن المتجر (عربي)", true],
  ["whatsappNumber", "رقم واتساب الطلب (بالصيغة الدولية بدون +)"],
  ["mapUrl", "رابط الموقع على خرائط جوجل (Google Maps)"]
];

const SOCIAL_FIELDS = [
  ["facebook", "رابط صفحة الفيسبوك"],
  ["messenger", "الماسنجر: اكتب ID أو اسم الصفحة (مثال: 100063708167410)"],
  ["instagram", "رابط إنستجرام"],
  ["tiktok", "رابط تيك توك"],
  ["telegram", "رابط تليجرام"]
];

function renderConfig() {
  const wrap = $("configFields");
  wrap.innerHTML = "";
  const cfg = storeData.config || (storeData.config = {});

  CONFIG_FIELDS.forEach(([key, label, isArea]) => {
    const lbl = document.createElement("label");
    lbl.textContent = label;
    wrap.appendChild(lbl);

    const input = document.createElement(isArea ? "textarea" : "input");
    if (!isArea) input.type = "text";
    input.value = cfg[key] || "";
    input.oninput = () => { cfg[key] = input.value; };
    wrap.appendChild(input);
  });

  const socialTitle = document.createElement("p");
  socialTitle.style.cssText = "margin-top:26px;padding-top:18px;border-top:2px solid var(--border);font-family:'Cairo',sans-serif;font-weight:900;font-size:1.15rem;color:var(--marble-dark)";
  socialTitle.textContent = "🔗 روابط التواصل الاجتماعي";
  wrap.appendChild(socialTitle);

  const socialHint = document.createElement("p");
  socialHint.style.cssText = "color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;font-weight:700;line-height:1.6";
  socialHint.textContent = "اترك الخانة فاضية لو مش عايز الأيقونة تظهر (ما عدا فيسبوك وواتساب)";
  wrap.appendChild(socialHint);

  if (!storeData.social) storeData.social = {};

  SOCIAL_FIELDS.forEach(([key, label]) => {
    const lbl = document.createElement("label");
    lbl.textContent = label;
    wrap.appendChild(lbl);
    const input = document.createElement("input");
    input.type = "text";
    input.value = storeData.social[key] || "";
    input.placeholder = "https://...";
    input.oninput = () => { storeData.social[key] = input.value; };
    wrap.appendChild(input);
  });
}

// ============================================================
// الصور المميزة
// ============================================================
function renderFeaturedSection() {
  const wrap = $("featuredFields");
  if (!wrap) return;
  wrap.innerHTML = "";

  const hint = document.createElement("p");
  hint.style.cssText = "color:var(--text-muted);font-size:0.95rem;margin-bottom:14px;line-height:1.6;font-weight:700";
  hint.textContent = "الصور اللي بتظهر في السلايدر التاني (الصور المميزة) في الصفحة الرئيسية";
  wrap.appendChild(hint);

  if (!storeData.featured) storeData.featured = [];

  const grid = document.createElement("div");
  grid.className = "images-grid";

  storeData.featured.forEach((imgUrl, i) => {
    const thumb = document.createElement("div");
    thumb.className = "img-thumb";
    const img = document.createElement("img");
    img.src = imgUrl;
    img.onerror = () => { img.style.opacity = "0.3"; };
    const del = document.createElement("button");
    del.className = "img-del";
    del.textContent = "✕";
    del.onclick = () => {
      if (!confirm("حذف هذه الصورة؟")) return;
      storeData.featured.splice(i, 1);
      renderFeaturedSection();
    };
    thumb.appendChild(img);
    thumb.appendChild(del);
    grid.appendChild(thumb);
  });

  pendingFeatured.forEach((file, i) => {
    const thumb = document.createElement("div");
    thumb.className = "img-thumb";
    thumb.style.borderColor = "var(--gold)";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    const del = document.createElement("button");
    del.className = "img-del";
    del.textContent = "✕";
    del.onclick = () => { pendingFeatured.splice(i, 1); renderFeaturedSection(); };
    const badge = document.createElement("div");
    badge.style.cssText = "position:absolute;bottom:4px;left:4px;background:var(--gold);color:#140a00;font-size:0.7rem;padding:3px 8px;border-radius:6px;font-weight:900";
    badge.textContent = "قيد الرفع";
    thumb.appendChild(img);
    thumb.appendChild(del);
    thumb.appendChild(badge);
    grid.appendChild(thumb);
  });

  const addBtn = document.createElement("div");
  addBtn.className = "img-add-btn";
  addBtn.innerHTML = `📷<small>إضافة صورة</small>`;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  addBtn.onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    files.forEach(f => pendingFeatured.push(f));
    renderFeaturedSection();
  };
  grid.appendChild(addBtn);
  wrap.appendChild(grid);
  wrap.appendChild(fileInput);
}

// ============================================================
// 🔥 عرض قسم العروض
// ============================================================
function renderOffersSection() {
  const wrap = $("offersFields");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!storeData.offers || !Array.isArray(storeData.offers)) {
    storeData.offers = [];
  }

  // تحديث العداد
  const counter = $("offersCount");
  if (counter) counter.textContent = storeData.offers.length + " عرض";

  // ====== نص إرشادي ======
  const hint = document.createElement("p");
  hint.style.cssText = "color:var(--text-muted);font-size:0.9rem;margin-bottom:14px;line-height:1.7;font-weight:700";
  hint.innerHTML = "كل عرض = <strong>صورة</strong> + <strong>نص</strong> (زي: \"ثلاث تيشيرتات بسعر اتنين\"). العرض يظهر في قسم <strong>🔥 عروض وخصومات</strong> في الصفحة الرئيسية، بنفس تأثير Coverflow.";
  wrap.appendChild(hint);

  // ====== شبكة العروض ======
  const grid = document.createElement("div");
  grid.className = "offers-grid";

  storeData.offers.forEach((offer, idx) => {
    const card = buildOfferCard(offer, idx);
    grid.appendChild(card);
  });

  // ====== زر إضافة عرض جديد ======
  const addOfferBtn = document.createElement("div");
  addOfferBtn.className = "offer-card";
  addOfferBtn.style.cssText = "justify-content:center;align-items:center;cursor:pointer;border-style:dashed";
  addOfferBtn.innerHTML = `
    <div style="font-size:2.5rem;color:var(--gold-dark)">➕</div>
    <div style="font-weight:900;color:var(--gold-dark);text-align:center;font-size:0.95rem">إضافة عرض جديد</div>
  `;
  addOfferBtn.onclick = () => {
    storeData.offers.push({
      id: uid("offer"),
      image: "",
      text: ""
    });
    renderOffersSection();
    showStatus("تم إضافة عرض جديد — ارفع صورة واكتب النص 💾", "ok");
  };
  grid.appendChild(addOfferBtn);

  wrap.appendChild(grid);
}

// ============================================================
// بناء كارت عرض
// ============================================================
function buildOfferCard(offer, idx) {
  const card = document.createElement("div");
  card.className = "offer-card";

  // رقم العرض
  const num = document.createElement("div");
  num.className = "offer-num";
  num.textContent = "#" + (idx + 1);
  card.appendChild(num);

  // ====== صورة العرض ======
  const imgBox = document.createElement("div");
  imgBox.className = "offer-img-box";

  const pendingFile = pendingOffers[offer.id];
  if (pendingFile) {
    // صورة قيد الرفع
    const img = document.createElement("img");
    img.src = URL.createObjectURL(pendingFile);
    imgBox.appendChild(img);

    const del = document.createElement("button");
    del.className = "offer-img-del";
    del.textContent = "✕";
    del.onclick = () => {
      delete pendingOffers[offer.id];
      renderOffersSection();
    };
    imgBox.appendChild(del);

    const badge = document.createElement("div");
    badge.style.cssText = "position:absolute;bottom:6px;right:6px;background:var(--gold);color:#140a00;font-size:0.65rem;padding:3px 8px;border-radius:6px;font-weight:900;z-index:2";
    badge.textContent = "قيد الرفع";
    imgBox.appendChild(badge);
  } else if (offer.image) {
    // صورة محفوظة
    const img = document.createElement("img");
    img.src = offer.image;
    img.onerror = () => { img.style.opacity = "0.3"; };
    imgBox.appendChild(img);

    const del = document.createElement("button");
    del.className = "offer-img-del";
    del.textContent = "✕";
    del.onclick = () => {
      if (!confirm("حذف صورة العرض؟")) return;
      offer.image = "";
      renderOffersSection();
    };
    imgBox.appendChild(del);

    const changeBtn = document.createElement("button");
    changeBtn.className = "offer-img-change";
    changeBtn.textContent = "🔄 تغيير";
    changeBtn.onclick = () => {
      const fi = document.createElement("input");
      fi.type = "file";
      fi.accept = "image/*";
      fi.onchange = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        pendingOffers[offer.id] = f;
        renderOffersSection();
      };
      fi.click();
    };
    imgBox.appendChild(changeBtn);
  } else {
    // صندوق إضافة صورة
    const addImg = document.createElement("div");
    addImg.className = "offer-img-add";
    addImg.innerHTML = `📷<small>إضافة صورة</small>`;
    addImg.onclick = () => {
      const fi = document.createElement("input");
      fi.type = "file";
      fi.accept = "image/*";
      fi.onchange = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        pendingOffers[offer.id] = f;
        renderOffersSection();
      };
      fi.click();
    };
    imgBox.appendChild(addImg);
  }

  card.appendChild(imgBox);

  // ====== النص ======
  const textLbl = document.createElement("div");
  textLbl.className = "offer-text-label";
  textLbl.textContent = "📝 نص العرض:";
  card.appendChild(textLbl);

  const textInput = document.createElement("textarea");
  textInput.className = "offer-text-input";
  textInput.placeholder = "مثال: ثلاث تيشيرتات بسعر اتنين";
  textInput.value = offer.text || "";
  textInput.oninput = () => { offer.text = textInput.value; };
  card.appendChild(textInput);

  // ====== زر الحذف ======
  const delBtn = document.createElement("button");
  delBtn.className = "offer-del-btn";
  delBtn.textContent = "🗑️ حذف العرض";
  delBtn.onclick = () => {
    if (!confirm("حذف هذا العرض نهائياً؟")) return;
    delete pendingOffers[offer.id];
    storeData.offers.splice(idx, 1);
    renderOffersSection();
  };
  card.appendChild(delBtn);

  return card;
}

// ============================================================
// عرض الأقسام
// ============================================================
function renderZones() {
  const wrap = $("zonesWrap");
  wrap.innerHTML = "";
  if (!storeData.categories) storeData.categories = [];
  storeData.categories.forEach((cat, idx) => {
    wrap.appendChild(buildZoneCard(cat, idx));
  });
}

function buildZoneCard(cat, idx) {
  const card = document.createElement("div");
  card.className = "card";

  const title = document.createElement("div");
  title.className = "card-title";

  const info = document.createElement("div");
  info.className = "title-info";
  info.innerHTML = `
    <span class="zone-icon">${cat.icon || "📦"}</span>
    <span>${cat.name_ar || "(قسم بدون اسم)"}</span>
    <span class="type-badge">${(cat.products || []).length} منتج</span>
    <span class="toggle-chev">▼</span>
  `;

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";

  const visToggle = document.createElement("div");
  visToggle.className = "vis-toggle " + (cat.visible !== false ? "on" : "off");
  visToggle.textContent = cat.visible !== false ? "👁️ ظاهر" : "🚫 مخفي";
  visToggle.onclick = (e) => {
    e.stopPropagation();
    cat.visible = cat.visible === false ? true : false;
    visToggle.className = "vis-toggle " + (cat.visible !== false ? "on" : "off");
    visToggle.textContent = cat.visible !== false ? "👁️ ظاهر" : "🚫 مخفي";
  };

  const delBtn = document.createElement("button");
  delBtn.className = "btn-danger";
  delBtn.textContent = "🗑️ حذف";
  delBtn.onclick = (e) => {
    e.stopPropagation();
    if (!confirm(`متأكد من حذف قسم "${cat.name_ar}"؟`)) return;
    storeData.categories.splice(idx, 1);
    renderZones();
  };

  actions.appendChild(visToggle);
  actions.appendChild(delBtn);
  title.appendChild(info);
  title.appendChild(actions);
  card.appendChild(title);

  const body = document.createElement("div");
  body.className = "zone-body";

  info.onclick = () => {
    body.classList.toggle("open");
    title.querySelector(".toggle-chev").classList.toggle("open");
  };

  body.appendChild(fieldRow("اسم القسم (عربي)", cat.name_ar, (v) => {
    cat.name_ar = v;
    info.querySelector("span:nth-child(2)").textContent = v;
  }));
  body.appendChild(fieldRow("اسم القسم (English)", cat.name_en, (v) => { cat.name_en = v; }));
  body.appendChild(fieldRow("أيقونة (إيموجي)", cat.icon, (v) => {
    cat.icon = v;
    info.querySelector(".zone-icon").textContent = v;
  }));
  body.appendChild(fieldRow("رابط صورة القسم", cat.homeImg, (v) => { cat.homeImg = v; }));

  const homeImgActions = document.createElement("div");
  homeImgActions.style.cssText = "display:flex;gap:8px;margin-top:10px";
  const uploadHomeBtn = document.createElement("button");
  uploadHomeBtn.className = "btn-secondary";
  uploadHomeBtn.style.fontSize = "0.9rem";
  uploadHomeBtn.textContent = "📤 رفع صورة القسم";
  const homeFile = document.createElement("input");
  homeFile.type = "file";
  homeFile.accept = "image/*";
  homeFile.style.display = "none";
  uploadHomeBtn.onclick = () => homeFile.click();
  homeFile.onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    showLoading("جاري رفع صورة القسم...");
    try {
      const b64 = await compressImage(f);
      const fileName = `cat_${cat.id}_${Date.now()}.jpg`;
      const url = await uploadImageToGitHub(b64, fileName);
      cat.homeImg = url;
      renderZones();
      showStatus("تم رفع الصورة ✅ لا تنسَ الحفظ", "ok");
    } catch (err) {
      showStatus("فشل الرفع: " + errMsg(err), "err");
    }
    hideLoading();
  };
  homeImgActions.appendChild(uploadHomeBtn);
  homeImgActions.appendChild(homeFile);
  body.appendChild(homeImgActions);

  // ============================================================
  // 🎨 محرر ألوان القسم
  // ============================================================
  if (!cat.colors || !Array.isArray(cat.colors) || cat.colors.length === 0) {
    cat.colors = [...COLOR_PALETTE];
  }

  const colorsBox = document.createElement("div");
  colorsBox.className = "cat-colors-editor";

  const colorsLbl = document.createElement("label");
  colorsLbl.textContent = "🎨 الألوان المتاحة في هذا القسم";
  colorsBox.appendChild(colorsLbl);

  const colorsHint = document.createElement("p");
  colorsHint.className = "cat-colors-hint";
  colorsHint.textContent = "اضغط على أي لون لإخفائه/إظهاره. الألوان دي هي اللي هتظهر كخيارات سريعة تحت كل صورة. لو محتاج لون مش في القائمة، استخدم زر ( + لون جديد ) تحت الصورة نفسها.";
  colorsBox.appendChild(colorsHint);

  const chipsWrap = document.createElement("div");
  chipsWrap.className = "color-chips-wrap";

  COLOR_PALETTE.forEach(c => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-chip-btn " + (cat.colors.includes(c) ? "on" : "off");
    btn.textContent = c;
    btn.onclick = () => {
      const i = cat.colors.indexOf(c);
      if (i > -1) cat.colors.splice(i, 1);
      else cat.colors.push(c);
      btn.className = "color-chip-btn " + (cat.colors.includes(c) ? "on" : "off");
    };
    chipsWrap.appendChild(btn);
  });

  colorsBox.appendChild(chipsWrap);

  const restoreBtn = document.createElement("button");
  restoreBtn.type = "button";
  restoreBtn.className = "img-color-tags-all-btn";
  restoreBtn.style.cssText = "margin-top:12px;padding:8px 16px;font-size:0.85rem;border-width:2.5px";
  restoreBtn.textContent = "↺ استرجاع كل الألوان";
  restoreBtn.onclick = () => {
    cat.colors = [...COLOR_PALETTE];
    renderZones();
  };
  colorsBox.appendChild(restoreBtn);

  body.appendChild(colorsBox);

  // ============================================================
  // المنتجات
  // ============================================================
  const prodsLabel = document.createElement("label");
  prodsLabel.style.cssText = "margin-top:24px;font-size:1.1rem;color:var(--marble-dark)";
  prodsLabel.textContent = "🛍️ المنتجات:";
  body.appendChild(prodsLabel);

  const prodsWrap = document.createElement("div");
  body.appendChild(prodsWrap);

  function rerender() {
    renderProductsAdmin(prodsWrap, cat, rerender);
    info.querySelector(".type-badge").textContent = (cat.products || []).length + " منتج";
  }
  rerender();

  const addProdBtn = document.createElement("button");
  addProdBtn.className = "btn-add";
  addProdBtn.textContent = "+ إضافة منتج جديد";
  addProdBtn.onclick = () => {
    if (!cat.products) cat.products = [];
    cat.products.push({
      id: uid("p"),
      name_ar: "",
      name_en: "",
      desc_ar: "",
      desc_en: "",
      images: [],
      colors: [],
      sizes: []
    });
    rerender();
  };
  body.appendChild(addProdBtn);

  card.appendChild(body);
  return card;
}

// ============================================================
// حقل مساعد
// ============================================================
function fieldRow(label, value, onChange) {
  const wrap = document.createElement("div");
  const lbl = document.createElement("label");
  lbl.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.oninput = () => onChange(input.value);
  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return wrap;
}

// ============================================================
// المقاسات
// ============================================================
const SIZE_PRESETS = ["S", "M", "L", "XL", "XXL", "XXXL"];
// البنطلونات والجينز: مقاسات الخصر من 26 وطالع
const PANTS_PRESETS = Array.from({ length: 25 }, (_, i) => String(26 + i));   // 26 … 50
const LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL"];

function isPantsCat(cat) {
  if (!cat) return false;
  if (cat.id === "pants" || cat.id === "jeans") return true;
  return /بنطلون|بنطلونات|جينز/.test(cat.name_ar || "");
}

// يوحّد شكل المقاس: أرقام عربية -> إنجليزية، وحروف كبيرة (xl -> XL)
function normalizeSizeLabel(raw) {
  let v = String(raw || "").trim();
  v = v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
       .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  if (/^[0-9a-z]+$/i.test(v)) v = v.toUpperCase();
  return v;
}

function sizeSortKey(label) {
  if (/^\d+(\.\d+)?$/.test(label)) return [0, parseFloat(label), 0];              // الأرقام الأول، تصاعديًا
  const li = LETTER_ORDER.indexOf(label.toUpperCase());
  if (li !== -1) return [1, li, 0];                                                 // بعدين الحروف بالترتيب
  return [2, 0, 0];                                                                 // وأي حاجة تانية في الآخر
}

function sortSizes(arr) {
  const withIdx = arr.map((x, i) => ({ x, i, k: sizeSortKey(String(x.label)) }));
  withIdx.sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]) || (a.i - b.i));
  arr.splice(0, arr.length, ...withIdx.map((o) => o.x));
}

// يضيف مقاس (لو مش موجود) ويرتّب القائمة. يرجّع true لو اتضاف
function addSizeLabel(prod, label) {
  const v = normalizeSizeLabel(label);
  if (!v) return false;
  if (!prod.sizes) prod.sizes = [];
  if (prod.sizes.some((s) => String(s.label).toUpperCase() === v.toUpperCase())) return false;
  prod.sizes.push({ label: v, price: 0 });
  sortSizes(prod.sizes);
  return true;
}
const SHOE_PRESETS = ["40", "41", "42", "43", "44", "45", "46"];
const KIDS_PRESETS = ["2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y"];

// ============================================================
// عرض المنتجات
// ============================================================
function renderProductsAdmin(container, cat, rerender) {
  container.innerHTML = "";
  if (!cat.products || cat.products.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "text-align:center;color:var(--text-muted);padding:24px;font-size:0.95rem;font-weight:700";
    empty.textContent = "لا توجد منتجات - اضغط على + لإضافة منتج";
    container.appendChild(empty);
    return;
  }
  cat.products.forEach((prod, pIdx) => {
    container.appendChild(buildProductCard(prod, pIdx, cat, rerender));
  });
}

function buildProductCard(prod, pIdx, cat, rerender) {
  const box = document.createElement("div");
  box.className = "item-box";

  const num = document.createElement("div");
  num.className = "item-num";
  num.textContent = "#" + (pIdx + 1);
  box.appendChild(num);

  const acts = document.createElement("div");
  acts.className = "item-actions";
  const delBtn = document.createElement("button");
  delBtn.className = "btn-danger";
  delBtn.textContent = "🗑️ حذف المنتج";
  delBtn.onclick = () => {
    if (!confirm(`حذف "${prod.name_ar || 'المنتج'}"؟`)) return;
    cat.products.splice(pIdx, 1);
    rerender();
  };
  acts.appendChild(delBtn);
  box.appendChild(acts);

  box.appendChild(fieldRow("الاسم (عربي)", prod.name_ar, (v) => { prod.name_ar = v; }));
  box.appendChild(fieldRow("الاسم (English)", prod.name_en, (v) => { prod.name_en = v; }));
  box.appendChild(fieldRow("وصف مختصر (اختياري)", prod.desc_ar, (v) => { prod.desc_ar = v; }));

  box.appendChild(buildImagesSection(prod, rerender, cat));
  box.appendChild(buildSizesSection(prod, rerender, cat));

  return box;
}

// ============================================================
// 📷 صور المنتج
// ============================================================
function buildImagesSection(prod, rerender, cat) {
  const wrap = document.createElement("div");

  const lbl = document.createElement("label");
  lbl.textContent = "📷 صور المنتج";
  wrap.appendChild(lbl);

  const hint = document.createElement("p");
  hint.style.cssText = "font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;font-weight:700;line-height:1.6";
  hint.textContent = "لكل صورة: اضغط على الألوان المتوفرة فيها. الألوان المخصصة (زي: روز، ذهبي، فضي) ضيفها بزر (+ لون جديد) — اللون ده هيتحفظ للصورة دي بس.";
  wrap.appendChild(hint);

  const enabledColors = (cat && cat.colors && cat.colors.length) ? cat.colors : COLOR_PALETTE;

  const grid = document.createElement("div");
  grid.className = "images-grid";

  if (!prod.images) prod.images = [];
  if (!prod.colors) prod.colors = [];
  while (prod.colors.length < prod.images.length) prod.colors.push("");

  function colorList(i) {
    return (prod.colors[i] || "").split(/[،,]/).map(s => s.trim()).filter(Boolean);
  }

  function buildColorRow(imgIdx) {
    const row = document.createElement("div");
    row.className = "img-colors-row";
    const active = colorList(imgIdx);

    enabledColors.forEach(c => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "img-color-tag" + (active.includes(c) ? " on" : "");
      t.textContent = c;
      t.onclick = (e) => {
        e.preventDefault();
        const list = colorList(imgIdx);
        const i = list.indexOf(c);
        if (i > -1) list.splice(i, 1);
        else list.push(c);
        prod.colors[imgIdx] = list.join("، ");
        t.classList.toggle("on");
      };
      row.appendChild(t);
    });

    const customColors = active.filter(c => !enabledColors.includes(c));
    customColors.forEach(c => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "img-color-tag custom";
      t.textContent = c + " ✕";
      t.title = "لون مخصص - اضغط للحذف";
      t.onclick = (e) => {
        e.preventDefault();
        const list = colorList(imgIdx);
        const i = list.indexOf(c);
        if (i > -1) list.splice(i, 1);
        prod.colors[imgIdx] = list.join("، ");
        rerender();
      };
      row.appendChild(t);
    });

    const addCustomBtn = document.createElement("button");
    addCustomBtn.type = "button";
    addCustomBtn.className = "img-color-tag add-custom";
    addCustomBtn.textContent = "+ لون جديد";
    addCustomBtn.onclick = (e) => {
      e.preventDefault();
      const newColor = prompt("اكتب اسم اللون المخصص (مثال: روز، ذهبي، فضي، كريمي...):");
      if (!newColor) return;
      const cleanColor = newColor.trim().replace(/[،,]/g, " ").trim();
      if (!cleanColor) return;
      const list = colorList(imgIdx);
      if (!list.includes(cleanColor)) {
        list.push(cleanColor);
        prod.colors[imgIdx] = list.join("، ");
      }
      rerender();
    };
    row.appendChild(addCustomBtn);

    if (enabledColors.length > 1) {
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "img-color-tags-all-btn";
      allBtn.textContent = "الكل";
      allBtn.onclick = (e) => {
        e.preventDefault();
        prod.colors[imgIdx] = enabledColors.join("، ");
        rerender();
      };
      row.appendChild(allBtn);
    }

    return row;
  }

  function buildPendingColorRow(file) {
    const row = document.createElement("div");
    row.className = "img-colors-row";
    const active = (file.colorNames || []).slice();

    enabledColors.forEach(c => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "img-color-tag" + (active.includes(c) ? " on" : "");
      t.textContent = c;
      t.onclick = (e) => {
        e.preventDefault();
        const list = file.colorNames || (file.colorNames = []);
        const ix = list.indexOf(c);
        if (ix > -1) list.splice(ix, 1);
        else list.push(c);
        t.classList.toggle("on");
      };
      row.appendChild(t);
    });

    const customColors = active.filter(c => !enabledColors.includes(c));
    customColors.forEach(c => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "img-color-tag custom";
      t.textContent = c + " ✕";
      t.title = "لون مخصص - اضغط للحذف";
      t.onclick = (e) => {
        e.preventDefault();
        const list = file.colorNames || [];
        const ix = list.indexOf(c);
        if (ix > -1) list.splice(ix, 1);
        rerender();
      };
      row.appendChild(t);
    });

    const addCustomBtn = document.createElement("button");
    addCustomBtn.type = "button";
    addCustomBtn.className = "img-color-tag add-custom";
    addCustomBtn.textContent = "+ لون جديد";
    addCustomBtn.onclick = (e) => {
      e.preventDefault();
      const newColor = prompt("اكتب اسم اللون المخصص (مثال: روز، ذهبي، فضي...):");
      if (!newColor) return;
      const cleanColor = newColor.trim().replace(/[،,]/g, " ").trim();
      if (!cleanColor) return;
      if (!file.colorNames) file.colorNames = [];
      if (!file.colorNames.includes(cleanColor)) file.colorNames.push(cleanColor);
      rerender();
    };
    row.appendChild(addCustomBtn);

    if (enabledColors.length > 1) {
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "img-color-tags-all-btn";
      allBtn.textContent = "الكل";
      allBtn.onclick = (e) => {
        e.preventDefault();
        file.colorNames = [...enabledColors];
        rerender();
      };
      row.appendChild(allBtn);
    }

    return row;
  }

  function renderImgs() {
    grid.innerHTML = "";

    prod.images.forEach((imgUrl, i) => {
      const cell = document.createElement("div");
      cell.className = "img-cell";
      const thumb = document.createElement("div");
      thumb.className = "img-thumb";
      const img = document.createElement("img");
      img.src = imgUrl;
      img.onerror = () => { img.style.opacity = "0.3"; };
      const del = document.createElement("button");
      del.className = "img-del";
      del.textContent = "✕";
      del.onclick = () => {
        if (!confirm("حذف هذه الصورة؟")) return;
        prod.images.splice(i, 1);
        prod.colors.splice(i, 1);
        rerender();
      };
      thumb.appendChild(img);
      thumb.appendChild(del);
      cell.appendChild(thumb);
      cell.appendChild(buildColorRow(i));
      grid.appendChild(cell);
    });

    const pending = pendingImages[prod.id] || [];
    pending.forEach((file, i) => {
      const cell = document.createElement("div");
      cell.className = "img-cell";
      const thumb = document.createElement("div");
      thumb.className = "img-thumb";
      thumb.style.borderColor = "var(--gold)";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      const del = document.createElement("button");
      del.className = "img-del";
      del.textContent = "✕";
      del.onclick = () => {
        pendingImages[prod.id].splice(i, 1);
        if (!pendingImages[prod.id].length) delete pendingImages[prod.id];
        rerender();
      };
      const badge = document.createElement("div");
      badge.style.cssText = "position:absolute;bottom:4px;left:4px;background:var(--gold);color:#140a00;font-size:0.7rem;padding:3px 8px;border-radius:6px;font-weight:900";
      badge.textContent = "قيد الرفع";
      thumb.appendChild(img);
      thumb.appendChild(del);
      thumb.appendChild(badge);
      cell.appendChild(thumb);
      cell.appendChild(buildPendingColorRow(file));
      grid.appendChild(cell);
    });

    const addBtn = document.createElement("div");
    addBtn.className = "img-add-btn";
    addBtn.innerHTML = `📷<small>إضافة صورة</small>`;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    addBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      if (!pendingImages[prod.id]) pendingImages[prod.id] = [];
      files.forEach(f => {
        f.colorNames = [];
        pendingImages[prod.id].push(f);
      });
      rerender();
    };
    grid.appendChild(addBtn);
    wrap.appendChild(grid);
    wrap.appendChild(fileInput);
  }

  renderImgs();
  return wrap;
}

// ============================================================
// المقاسات والأسعار
// ============================================================
function buildSizesSection(prod, rerender, cat) {
  const wrap = document.createElement("div");

  const lbl = document.createElement("label");
  lbl.textContent = "📏 المقاسات والأسعار";
  wrap.appendChild(lbl);

  const hint = document.createElement("p");
  hint.style.cssText = "font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;font-weight:700";
  hint.textContent = "اضغط على المقاس لإضافته وحدد سعره — واملأ خانة سعر العرض فقط لو في خصم على المقاس ده";
  wrap.appendChild(hint);

  const selectedWrap = document.createElement("div");
  selectedWrap.className = "selected-sizes";

  if (!prod.sizes) prod.sizes = [];

  if (prod.sizes.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.style.cssText = "text-align:center;color:#999;font-size:0.9rem;padding:12px;font-weight:700";
    emptyMsg.textContent = "لا توجد مقاسات - اختر من الأسفل";
    selectedWrap.appendChild(emptyMsg);
  } else {
    prod.sizes.forEach((sz, i) => {
      const row = document.createElement("div");
      row.className = "selected-size-row";

      const lblSz = document.createElement("span");
      lblSz.className = "sz-label";
      lblSz.textContent = sz.label;

      const priceInput = document.createElement("input");
      priceInput.type = "number";
      priceInput.className = "sz-price-input";
      priceInput.value = sz.price || 0;
      priceInput.placeholder = "السعر";
      priceInput.oninput = () => { prod.sizes[i].price = parseFloat(priceInput.value) || 0; };

      const currency = document.createElement("span");
      currency.style.cssText = "font-weight:900;color:var(--text-muted)";
      currency.textContent = "ج.م";

      const offerInput = document.createElement("input");
      offerInput.type = "number";
      offerInput.className = "sz-price-input";
      offerInput.style.cssText = "border-color:var(--gold);";
      offerInput.value = sz.offerPrice || "";
      offerInput.placeholder = "سعر العرض (اختياري)";
      offerInput.oninput = () => {
        const v = parseFloat(offerInput.value);
        prod.sizes[i].offerPrice = (!isNaN(v) && v > 0) ? v : 0;
      };

      const del = document.createElement("button");
      del.className = "sz-del";
      del.textContent = "✕";
      del.onclick = () => { prod.sizes.splice(i, 1); rerender(); };

      row.appendChild(lblSz);
      row.appendChild(priceInput);
      row.appendChild(currency);
      row.appendChild(offerInput);
      row.appendChild(del);
      selectedWrap.appendChild(row);
    });
  }
  wrap.appendChild(selectedWrap);

  const presetsLbl = document.createElement("p");
  presetsLbl.style.cssText = "font-size:0.9rem;color:var(--marble-mid);margin-top:16px;margin-bottom:8px;font-weight:900";
  presetsLbl.textContent = "المقاسات الجاهزة:";
  wrap.appendChild(presetsLbl);

  let presets = SIZE_PRESETS;
  if (cat && cat.id === "sneakers") presets = SHOE_PRESETS;
  else if (cat && cat.id === "boxers") presets = SIZE_PRESETS;
  else if (isPantsCat(cat)) presets = PANTS_PRESETS;

  const chipsWrap1 = document.createElement("div");
  chipsWrap1.className = "size-chips";
  presets.forEach(sz => {
    const chip = document.createElement("button");
    chip.className = "size-chip";
    chip.textContent = sz;
    if (prod.sizes.some(s => s.label === sz)) chip.classList.add("selected");
    chip.onclick = () => {
      const existingIdx = prod.sizes.findIndex(s => s.label === sz);
      if (existingIdx !== -1) prod.sizes.splice(existingIdx, 1);
      else addSizeLabel(prod, sz);
      rerender();
    };
    chipsWrap1.appendChild(chip);
  });
  wrap.appendChild(chipsWrap1);

  const extraLbl = document.createElement("p");
  extraLbl.style.cssText = "font-size:0.85rem;color:var(--text-muted);margin-top:12px;margin-bottom:6px;font-weight:700";
  extraLbl.textContent = "مقاسات أخرى:";
  wrap.appendChild(extraLbl);

  const chipsWrap2 = document.createElement("div");
  chipsWrap2.className = "size-chips";
  const allExtras = isPantsCat(cat)
    ? [...SIZE_PRESETS, "Standard", "One Size"]
    : [...new Set([...SHOE_PRESETS, ...KIDS_PRESETS, "Standard", "One Size"])];
  allExtras.forEach(sz => {
    const chip = document.createElement("button");
    chip.className = "size-chip";
    chip.textContent = sz;
    chip.style.fontSize = "0.85rem";
    chip.style.padding = "8px 14px";
    if (prod.sizes.some(s => s.label === sz)) chip.classList.add("selected");
    chip.onclick = () => {
      const existingIdx = prod.sizes.findIndex(s => s.label === sz);
      if (existingIdx !== -1) prod.sizes.splice(existingIdx, 1);
      else addSizeLabel(prod, sz);
      rerender();
    };
    chipsWrap2.appendChild(chip);
  });
  wrap.appendChild(chipsWrap2);

  // ===== إضافة مقاسات يدويًا =====
  const addBox = document.createElement("div");
  addBox.className = "size-add-box";

  const boxTitle = document.createElement("div");
  boxTitle.className = "sab-title";
  boxTitle.textContent = "✍️ إضافة مقاس يدويًا";
  addBox.appendChild(boxTitle);

  const addRow = document.createElement("div");
  addRow.className = "size-add-row";
  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.placeholder = "مثال: 26, 27 أو 4XL";
  const customBtn = document.createElement("button");
  customBtn.type = "button";
  customBtn.className = "btn-secondary";
  customBtn.textContent = "+ إضافة";
  const submitCustom = () => {
    const parts = customInput.value.split(/[,،;\n\s]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 0) return;
    let added = 0;
    parts.forEach((p) => { if (addSizeLabel(prod, p)) added++; });
    customInput.value = "";
    if (added === 0) showStatus("المقاسات دي موجودة بالفعل", "err");
    rerender();
  };
  customBtn.onclick = submitCustom;
  customInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitCustom(); }
  });
  addRow.appendChild(customInput);
  addRow.appendChild(customBtn);
  addBox.appendChild(addRow);

  // مدى من رقم لرقم (مثال: من 30 إلى 44 كل 2)
  const rangeRow = document.createElement("div");
  rangeRow.className = "size-range-row";
  const mkField = (labelText, value) => {
    const f = document.createElement("div");
    f.className = "sr-field";
    const l = document.createElement("label");
    l.textContent = labelText;
    const i = document.createElement("input");
    i.type = "text";            // text عشان الأرقام العربي (٢٦) تتقبل وتتحول لإنجليزي
    i.inputMode = "numeric";
    i.value = value;
    f.appendChild(l);
    f.appendChild(i);
    rangeRow.appendChild(f);
    return i;
  };
  const fromInput = mkField("من", isPantsCat(cat) ? "26" : "");
  const toInput = mkField("إلى", isPantsCat(cat) ? "40" : "");
  const stepInput = mkField("كل", "1");
  const rangeBtn = document.createElement("button");
  rangeBtn.type = "button";
  rangeBtn.className = "btn-secondary";
  rangeBtn.textContent = "+ إضافة المدى";
  rangeBtn.onclick = () => {
    const from = parseInt(normalizeSizeLabel(fromInput.value), 10);
    const to = parseInt(normalizeSizeLabel(toInput.value), 10);
    const step = Math.max(1, parseInt(normalizeSizeLabel(stepInput.value), 10) || 1);
    if (isNaN(from) || isNaN(to) || from > to) {
      showStatus("اكتب مدى صحيح (من أصغر من أو يساوي إلى)", "err");
      return;
    }
    if (Math.floor((to - from) / step) + 1 > 60) {
      showStatus("المدى كبير جدًا (أقصى 60 مقاس في المرة)", "err");
      return;
    }
    for (let n = from; n <= to; n += step) addSizeLabel(prod, String(n));
    rerender();
  };
  rangeRow.appendChild(rangeBtn);
  addBox.appendChild(rangeRow);

  const addHint = document.createElement("div");
  addHint.className = "size-add-hint";
  addHint.textContent = "تقدر تكتب أكتر من مقاس بفاصلة، أو تحدد مدى كامل. المقاسات بتتضاف مرتبة تلقائيًا (الأرقام ثم الحروف)، والأرقام العربي بتتحول لإنجليزي.";
  addBox.appendChild(addHint);

  wrap.appendChild(addBox);

  return wrap;
}

// ============================================================
// إضافة قسم جديد
// ============================================================
$("addZoneBtn").onclick = () => {
  const name = prompt("اسم القسم بالعربي:");
  if (!name) return;
  const nameEn = prompt("اسم القسم بالإنجليزي (اختياري):") || "";
  const icon = prompt("أيقونة (إيموجي، اختياري):", "🛍️") || "🛍️";

  if (!storeData.categories) storeData.categories = [];
  storeData.categories.push({
    id: uid("cat"),
    icon: icon,
    name_ar: name,
    name_en: nameEn,
    homeImg: "",
    visible: true,
    colors: [...COLOR_PALETTE],
    products: []
  });

  renderZones();
  showStatus("تم إضافة القسم — لا تنسَ الحفظ 💾", "ok");
};

// ============================================================
// معالجات
// ============================================================
window.addEventListener("online", () => {
  if ($("loadingOverlay").classList.contains("show")) hideLoading();
});

window.addEventListener("beforeunload", (e) => {
  const hasPending = Object.keys(pendingImages).length > 0
    || pendingFeatured.length > 0
    || Object.keys(pendingOffers).length > 0;
  if (hasPending) { e.preventDefault(); e.returnValue = ""; }
});

console.log("🎛️ Maxim Admin Panel loaded");