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

let DATA_PATH   = "";
let IMAGES_PATH = "";
let DATA_API    = "";

function recomputeGithubPaths() {
  DATA_PATH   = FOLDER_PATH ? `${FOLDER_PATH}/site-data.json` : "site-data.json";
  IMAGES_PATH = FOLDER_PATH ? `${FOLDER_PATH}/assets/uploads` : "assets/uploads";
  DATA_API    = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`;
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
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = (maxSize / w) * h; w = maxSize; }
          else { w = (maxSize / h) * w; h = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          const reader2 = new FileReader();
          reader2.onload = () => resolve(reader2.result.split(",")[1]);
          reader2.onerror = reject;
          reader2.readAsDataURL(blob);
        }, "image/jpeg", quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showStatus(msg, type = "ok") {
  const el = $("statusMsg");
  el.textContent = msg;
  el.className = "show " + type;
  setTimeout(() => { el.className = ""; }, 4500);
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
// GitHub API
// ============================================================
async function fetchFromGitHub() {
  const res = await fetch(`${DATA_API}?ref=${GITHUB_BRANCH}&t=${Date.now()}`, {
    headers: ghHeaders()
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("GitHub error " + res.status);
  const info = await res.json();
  currentSha = info.sha;
  return JSON.parse(base64ToUtf8(info.content));
}

async function saveDataToGitHub() {
  const newContent = JSON.stringify(storeData, null, 2);
  const res = await fetch(DATA_API, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "تحديث بيانات Maxim من لوحة التحكم",
      content: utf8ToBase64(newContent),
      sha: currentSha,
      branch: GITHUB_BRANCH
    })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.message || ("Save error " + res.status));
  currentSha = out.content.sha;
}

async function uploadImageToGitHub(base64Content, fileName) {
  const path = `${IMAGES_PATH}/${fileName}`;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  let sha = null;
  try {
    const check = await fetch(`${url}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders() });
    if (check.ok) {
      const info = await check.json();
      sha = info.sha;
    }
  } catch (e) {}
  const body = {
    message: "رفع صورة: " + fileName,
    content: base64Content,
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Upload failed");
  }
  return `${pagesBaseUrl()}/${IMAGES_PATH}/${fileName}`;
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

    if (e.message === "UNAUTHORIZED") {
      $("loginErr").textContent = "التوكن غير صحيح أو منتهي الصلاحية، أو مفيش صلاحية Push على الريبو ده";
    } else if (e.message && e.message.includes("404")) {
      $("loginErr").textContent = "مفيش ملف site-data.json في الريبو/الفولدر ده — تأكد من الأسماء";
    } else {
      $("loginErr").textContent = "خطأ: " + e.message;
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
    renderAll();
    showStatus("تم التحديث ✅", "ok");
  } catch (e) {
    showStatus("فشل التحديث: " + e.message, "err");
  }
  hideLoading();
};

// ============================================================
// الحفظ
// ============================================================
async function saveAll() {
  showLoading("جاري حفظ التعديلات...");
  try {
    if (pendingFeatured.length > 0) {
      showLoading(`جاري رفع ${pendingFeatured.length} صورة مميزة...`);
      if (!storeData.featured) storeData.featured = [];
      for (const file of pendingFeatured) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const fileName = `featured_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const b64 = await compressImage(file);
        const url = await uploadImageToGitHub(b64, fileName);
        storeData.featured.push(url);
      }
      pendingFeatured = [];
    }

    const pendingCount = Object.values(pendingImages).reduce((a, arr) => a + arr.length, 0);
    if (pendingCount > 0) {
      showLoading(`جاري رفع ${pendingCount} صورة منتج...`);
      await uploadAllPendingImages();
    }

    showLoading("جاري حفظ البيانات على GitHub...");
    await saveDataToGitHub();
    showStatus("تم الحفظ ✅ التحديث هيظهر خلال دقيقة", "ok");
    pendingImages = {};
  } catch (e) {
    showStatus("فشل الحفظ: " + e.message, "err");
  }
  hideLoading();
}

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
    if (!product) continue;

    if (!product.images) product.images = [];
    if (!product.colors) product.colors = [];
    while (product.colors.length < product.images.length) product.colors.push("");

    for (const file of files) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const fileName = `${productId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const b64 = await compressImage(file);
      const url = await uploadImageToGitHub(b64, fileName);
      product.images.push(url);
      const colorStr = (file.colorNames || []).join("، ");
      product.colors.push(colorStr);
    }
  }
}

// ============================================================
// عرض الكل
// ============================================================
function renderAll() {
  renderConfig();
  renderFeaturedSection();
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
    badge.style.cssText = "position:absolute;bottom:4px;left:4px;background:var(--gold);color:#fff;font-size:0.7rem;padding:3px 8px;border-radius:6px;font-weight:900";
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
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const fileName = `cat_${cat.id}_${Date.now()}.${ext}`;
      const url = await uploadImageToGitHub(b64, fileName);
      cat.homeImg = url;
      renderZones();
      showStatus("تم رفع الصورة ✅ لا تنسَ الحفظ", "ok");
    } catch (err) {
      showStatus("فشل الرفع: " + err.message, "err");
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
// 📷 صور المنتج — كل صورة تحتها شرائح ألوان + لون مخصص
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

  // ============================================================
  // بناء صف الألوان لصورة معينة
  // ============================================================
  function buildColorRow(imgIdx) {
    const row = document.createElement("div");
    row.className = "img-colors-row";
    const active = colorList(imgIdx);

    // ١) الألوان الأساسية من القسم
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

    // ٢) الألوان المخصصة (اللي مش موجودة في القسم، بس مضافة على الصورة دي)
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

    // ٣) زر "+ لون جديد"
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

    // ٤) زر "الكل" (للألوان الأساسية بس)
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

  // ============================================================
  // بناء صف الألوان لصورة قيد الرفع
  // ============================================================
  function buildPendingColorRow(file) {
    const row = document.createElement("div");
    row.className = "img-colors-row";
    const active = (file.colorNames || []).slice();

    // ١) الألوان الأساسية
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

    // ٢) الألوان المخصصة
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

    // ٣) زر "+ لون جديد"
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

    // ٤) زر "الكل"
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

  // ============================================================
  // بناء شبكة الصور
  // ============================================================
  function renderImgs() {
    grid.innerHTML = "";

    // ١) الصور المحفوظة
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

    // ٢) الصور قيد الرفع
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
      badge.style.cssText = "position:absolute;bottom:4px;left:4px;background:var(--gold);color:#fff;font-size:0.7rem;padding:3px 8px;border-radius:6px;font-weight:900";
      badge.textContent = "قيد الرفع";
      thumb.appendChild(img);
      thumb.appendChild(del);
      thumb.appendChild(badge);
      cell.appendChild(thumb);
      cell.appendChild(buildPendingColorRow(file));
      grid.appendChild(cell);
    });

    // ٣) زر الإضافة
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
      else prod.sizes.push({ label: sz, price: 0 });
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
  const allExtras = [...new Set([...SHOE_PRESETS, ...KIDS_PRESETS, "Standard", "One Size"])];
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
      else prod.sizes.push({ label: sz, price: 0 });
      rerender();
    };
    chipsWrap2.appendChild(chip);
  });
  wrap.appendChild(chipsWrap2);

  const customWrap = document.createElement("div");
  customWrap.style.cssText = "display:flex;gap:8px;margin-top:14px";
  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.placeholder = "مقاس مخصص (مثال: 4XL)";
  customInput.style.flex = "1";
  const customBtn = document.createElement("button");
  customBtn.className = "btn-secondary";
  customBtn.textContent = "+ إضافة";
  customBtn.onclick = () => {
    const v = customInput.value.trim();
    if (!v) return;
    if (!prod.sizes.some(s => s.label === v)) prod.sizes.push({ label: v, price: 0 });
    customInput.value = "";
    rerender();
  };
  customWrap.appendChild(customInput);
  customWrap.appendChild(customBtn);
  wrap.appendChild(customWrap);

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
  const hasPending = Object.keys(pendingImages).length > 0 || pendingFeatured.length > 0;
  if (hasPending) { e.preventDefault(); e.returnValue = ""; }
});

console.log("🎛️ Maxim Admin Panel loaded");