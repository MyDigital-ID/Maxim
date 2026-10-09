// ============================================================
// Maxim Casual Wear - Main Script
// ============================================================

let STORE_DATA = loadStoreData();
let cart = [];
let cartLineId = 0;
let currentCategory = null;

// ============================================================
// تحميل البيانات
// ============================================================
function loadStoreData() {
  const saved = localStorage.getItem("maximStoreData_v2");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.warn("فشل تحميل البيانات:", e);
    }
  }
  return {
    config: {
      brand_ar: "Maxim",
      brand_en: "Maxim Casual Wear",
      tagline_ar: "أناقه بلا حدود",
      about_ar: "إختيارك ل Maxim .. إختيار الجوده و الشياكه.",
      whatsappNumber: "",
      facebook: ""
    },
    social: {},
    featured: [],
    offers: [],
    categories: []
  };
}

const DEFAULT_PALETTE = [
  "أبيض", "أسود", "بني", "بيج فاتح", "بيج", "أزرق", "لبني",
  "أخضر", "زيتي", "أحمر", "أصفر", "رمادي", "كحلي", "برتقالي"
];

window.addEventListener('storeDataReady', () => {
  console.log("🔔 إشارة storeDataReady وصلت");
  STORE_DATA = loadStoreData();
  applySocialLinks();
  applyConfig();
  renderCategories();
  renderFeatured();
  renderOffersSlider();
});

// ============================================================
// Social
// ============================================================
function applySocialLinks() {
  const social = STORE_DATA.social || {};
  const cfg = STORE_DATA.config || {};

  const fbUrl = social.facebook || cfg.facebook || "#";
  const waNum = cfg.whatsappNumber || "";
  const waUrl = social.whatsapp || (waNum ? `https://wa.me/${waNum}` : "#");
  const igUrl = social.instagram || "#";
  const ttUrl = social.tiktok || "#";
  const tgUrl = social.telegram || "#";

  let messengerUrl = "https://m.me/100063708167410";
  const mRaw = (social.messenger || "").trim();
  if (mRaw) {
    if (/m\.me\//i.test(mRaw)) {
      messengerUrl = mRaw;
    } else if (/^\d+$/.test(mRaw)) {
      messengerUrl = "https://m.me/" + mRaw;
    } else if (!/^https?:/i.test(mRaw)) {
      messengerUrl = "https://m.me/" + mRaw.replace(/^@/, "");
    } else {
      const idm = mRaw.match(/profile\.php\?id=(\d+)/);
      const um  = mRaw.match(/facebook\.com\/([A-Za-z0-9.\-_]+)\/?(\?|$)/);
      if (idm) messengerUrl = "https://m.me/" + idm[1];
      else if (um && !/^(share|profile\.php|pages|people|groups)$/i.test(um[1]))
        messengerUrl = "https://m.me/" + um[1];
    }
  }

  const setHref = (id, url) => {
    const el = document.getElementById(id);
    if (el) el.href = url;
  };

  setHref("facebookLink", fbUrl);
  setHref("whatsappLink", waUrl);
  setHref("instagramLink", igUrl);
  setHref("tiktokLink", ttUrl);
  setHref("telegramLink", tgUrl);
  ["facebookLink", "instagramLink", "tiktokLink", "telegramLink", "whatsappLink"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (el.getAttribute("href") || "#") === "#" ? "none" : "";
  });

  setHref("contactFacebook", fbUrl);
  setHref("contactWhatsapp", waUrl);

  const messengerBtn = document.getElementById("sendMessengerBtn");
  if (messengerBtn) messengerBtn.href = messengerUrl;

  const locationLink = document.getElementById("locationLink");
  if (locationLink && cfg.mapUrl) {
    locationLink.href = cfg.mapUrl;
    locationLink.target = "_blank";
  }
}

// ============================================================
// Config
// ============================================================
function applyConfig() {
  const cfg = STORE_DATA.config || {};

  const aboutText = document.getElementById("aboutText");
  if (aboutText) aboutText.textContent = cfg.about_ar || "";

  const footTag = document.getElementById("footTagline");
  if (footTag && cfg.tagline_ar) footTag.textContent = cfg.tagline_ar;

  const footAddr = document.getElementById("footAddress");
  if (footAddr) footAddr.textContent = cfg.address_ar || "";

  const footPhones = document.getElementById("footPhones");
  if (footPhones) {
    const phones = Array.isArray(cfg.phones) ? cfg.phones : [];
    footPhones.innerHTML = phones.map(p => `<a href="tel:${p}" dir="ltr">${p}</a>`).join(" &nbsp;|&nbsp; ");
  }

  const locLink = document.getElementById("locationLink");
  if (locLink) {
    if (cfg.mapUrl) {
      locLink.href = cfg.mapUrl;
      locLink.classList.remove("hidden");
    } else {
      locLink.classList.add("hidden");
    }
  }
}

// ============================================================
// Side Menu
// ============================================================
const sideMenu = document.getElementById("sideMenu");
const sideOverlay = document.getElementById("sideOverlay");

function openSide() {
  if (sideMenu) sideMenu.classList.add("open");
  if (sideOverlay) sideOverlay.classList.add("show");
}
function closeSide() {
  if (sideMenu) sideMenu.classList.remove("open");
  if (sideOverlay) sideOverlay.classList.remove("show");
}

const menuBtn = document.getElementById("menuBtn");
if (menuBtn) menuBtn.addEventListener("click", openSide);

const closeMenuBtn = document.getElementById("closeMenu");
if (closeMenuBtn) closeMenuBtn.addEventListener("click", closeSide);

if (sideOverlay) {
  sideOverlay.addEventListener("click", () => {
    closeSide();
    closeCartDrawer();
  });
}

document.querySelectorAll(".side-link").forEach(link => {
  link.addEventListener("click", (e) => {
    const nav = link.dataset.nav;
    if (!nav) return;
    e.preventDefault();
    const aboutBox = document.getElementById("aboutBox");
    const contactBox = document.getElementById("contactBox");
    if (aboutBox) aboutBox.classList.add("hidden");
    if (contactBox) contactBox.classList.add("hidden");

    if (nav === "about" && aboutBox) aboutBox.classList.remove("hidden");
    if (nav === "contact" && contactBox) contactBox.classList.remove("hidden");
    if (nav === "home") { closeSide(); showHome(); }
  });
});

const brandHome = document.getElementById("brandHome");
if (brandHome) brandHome.addEventListener("click", showHome);

// ============================================================
// Navigation
// ============================================================
const viewHome = document.getElementById("view-home");
const viewCategory = document.getElementById("view-category");

let currentView = "home";
let currentState = { view: "home" };
let currentUrl = location.pathname + location.search;

function isOverlayOpen() {
  return (sideMenu && sideMenu.classList.contains("open")) ||
         (cartDrawer && cartDrawer.classList.contains("open"));
}

function setNav(state, url, mode) {
  currentState = state;
  currentUrl = url;
  if (mode === "push") history.pushState(state, "", url);
  else if (mode === "replace") history.replaceState(state, "", url);
}

function showToast(text) {
  let t = document.getElementById("navToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "navToast";
    t.className = "nav-toast";
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

function showHome(skipHistory) {
  closeSide();
  closeCartDrawer();
  if (viewCategory) viewCategory.classList.add("hidden");
  if (viewHome) viewHome.classList.remove("hidden");
  const wasHome = currentView === "home";
  currentView = "home";
  currentCategory = null;
  window.scrollTo(0, 0);
  if (skipHistory === true) return;
  if (!wasHome) setNav({ view: "home" }, location.pathname + location.search, "push");
}

function goBack() {
  if (isOverlayOpen()) { closeSide(); closeCartDrawer(); return; }
  if (currentView === "home") { showToast("أنت في الصفحة الرئيسية"); return; }
  history.back();
}

// ============================================================
// Categories
// ============================================================
function renderCategories() {
  const grid = document.getElementById("catsGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const cats = (STORE_DATA.categories || []).filter(c => c.visible !== false);

  if (cats.length === 0) {
    grid.innerHTML = '<p class="empty-note">لا توجد أقسام حالياً</p>';
    return;
  }

  cats.forEach(cat => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "cat-card";
    const img = cat.homeImg || (cat.products && cat.products[0] && cat.products[0].images[0]) || "";

    card.innerHTML = `
      ${img ? `<img src="${img}" alt="${cat.name_ar}" loading="lazy">` : ""}
      <span class="cat-card-shade"></span>
      <span class="cat-card-text">
        <span class="cat-card-ar">${cat.icon || ""} ${cat.name_ar}</span>
        <span class="cat-card-en">${cat.name_en || ""}</span>
      </span>
      <span class="cat-card-go" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>
      </span>
    `;
    card.addEventListener("click", () => openCategory(cat.id));
    grid.appendChild(card);
  });
}

// ============================================================
// Featured
// ============================================================
function renderFeatured() {
  const wrap = document.getElementById("featuredSlider").parentElement;
  const slider = document.getElementById("featuredSlider");
  if (!slider) return;
  destroySlider(wrap);
  if (!wrap.classList.contains("slider-wrap")) wrap.classList.add("slider-wrap");
  slider.innerHTML = "";

  const featured = STORE_DATA.featured || [];
  if (featured.length === 0) {
    slider.innerHTML = '<p class="empty-note">لا توجد صور مميزة</p>';
    return;
  }

  featured.forEach((imgUrl, idx) => {
    const item = document.createElement("div");
    item.className = "slider-item";
    item.innerHTML = `<img src="${imgUrl}" alt="صورة مميزة ${idx + 1}" loading="lazy">`;
    slider.appendChild(item);
  });

  addDots(wrap, featured.length);
  initCenterSlider(wrap, slider, featured.length, null);
}

function addDots(wrap, total) {
  const oldDots = wrap.querySelector(".slider-dots");
  if (oldDots) oldDots.remove();
  const dotsWrap = document.createElement("div");
  dotsWrap.className = "slider-dots";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("button");
    dot.className = "dot" + (i === 0 ? " active" : "");
    dot.dataset.idx = i;
    dotsWrap.appendChild(dot);
  }
  wrap.appendChild(dotsWrap);
}

// ============================================================
// Swiper
// ============================================================
const SWIPER_CSS = "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css";
const SWIPER_JS  = "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js";
let swiperLoadPromise = null;

function loadSwiperLib() {
  if (window.Swiper) return Promise.resolve();
  if (swiperLoadPromise) return swiperLoadPromise;

  const cssReady = new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = SWIPER_CSS;
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
  const jsReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SWIPER_JS;
    s.onload = resolve;
    s.onerror = () => reject(new Error("فشل تحميل Swiper"));
    document.head.appendChild(s);
  });
  swiperLoadPromise = Promise.all([cssReady, jsReady]).catch((err) => {
    swiperLoadPromise = null;
    throw err;
  });
  return swiperLoadPromise;
}

function destroySlider(wrap) {
  if (wrap && wrap._swiper) {
    try { wrap._swiper.destroy(true, true); } catch (e) {}
    wrap._swiper = null;
  }
}

function initCenterSlider(wrap, slider, total, onItemClick) {
  if (total === 0) return;
  const items = Array.from(slider.querySelectorAll(".slider-item"));
  if (items.length === 0) return;

  destroySlider(wrap);
  const token = (wrap._sliderToken = (wrap._sliderToken || 0) + 1);
  items.forEach((item, i) => { item.dataset.origIdx = i; });

  if (slider._clickHandler) slider.removeEventListener("click", slider._clickHandler);
  slider._clickHandler = (e) => {
    const slide = e.target.closest(".slider-item");
    if (!slide) return;
    const idx = parseInt(slide.dataset.origIdx, 10);
    const sw = wrap._swiper;
    if (sw && !slide.classList.contains("swiper-slide-active")) {
      if (sw.params.loop) sw.slideToLoop(idx); else sw.slideTo(idx);
      return;
    }
    if (onItemClick) onItemClick(idx);
  };
  slider.addEventListener("click", slider._clickHandler);

  loadSwiperLib().then(() => {
    if (wrap._sliderToken !== token || !slider.isConnected) return;
    wrap.classList.add("swiper");
    slider.classList.remove("slider-track");
    slider.classList.add("swiper-wrapper");
    items.forEach((item) => item.classList.add("swiper-slide"));

    const useLoop = total >= 3;
    const swiper = new Swiper(wrap, {
      effect: "coverflow",
      grabCursor: true,
      centeredSlides: true,
      slidesPerView: "auto",
      loop: useLoop,
      loopAdditionalSlides: 2,
      initialSlide: 0,
      speed: 500,
      resistanceRatio: 0.6,
      coverflowEffect: {
        rotate: 15,
        stretch: "55%",
        depth: 120,
        scale: 0.82,
        modifier: 1,
        slideShadows: true
      }
    });
    wrap._swiper = swiper;

    const dots = wrap.querySelectorAll(".slider-dots .dot");
    function syncDots() {
      dots.forEach((dot, i) => dot.classList.toggle("active", i === swiper.realIndex));
    }
    dots.forEach((dot, i) => {
      dot.addEventListener("click", () => {
        if (useLoop) swiper.slideToLoop(i); else swiper.slideTo(i);
      });
    });
    swiper.on("slideChange", syncDots);
    syncDots();
  }).catch((err) => {
    console.warn("تعذر تحميل Swiper:", err);
    slider.classList.add("slider-fallback-track");
  });
}

// ============================================================
// 🔥 العروض والخصومات — قسم مستقل تماماً
// - لو مفيش عروض → القسم كامل يختفي
// - لو فيه عروض → صورة + مستطيل نصي (مفيش فتح أقسام)
// ============================================================
function renderOffersSlider() {
  const slider = document.getElementById("offersSlider");
  if (!slider) return;

  const section = slider.closest(".home-section");
  const wrap = slider.parentElement;

  destroySlider(wrap);
  if (!wrap.classList.contains("slider-wrap")) wrap.classList.add("slider-wrap");
  slider.innerHTML = "";

  const offers = (STORE_DATA.offers || []).filter(o => o && (o.image || o.text));

  // مفيش عروض — نخفي القسم بالكامل
  if (offers.length === 0) {
    if (section) section.style.display = "none";
    return;
  }
  if (section) section.style.display = "";

  offers.forEach((offer, idx) => {
    const item = document.createElement("div");
    item.className = "slider-item offer-slide";

    const imgSrc = offer.image || "";
    const txt = (offer.text || "").trim();

    item.innerHTML = `
      ${imgSrc
        ? `<img src="${imgSrc}" alt="عرض ${idx + 1}" loading="lazy" onerror="this.style.opacity=0.3">`
        : '<div class="offer-img-fallback">🔥</div>'}
      ${txt ? `<div class="offer-text-box">${txt}</div>` : ""}
    `;
    slider.appendChild(item);
  });

  addDots(wrap, offers.length);
  // ← مفيش onItemClick — العروض للعرض فقط
  initCenterSlider(wrap, slider, offers.length, null);
}

function isOfferActive(size) {
  const price = Number(size.price) || 0;
  const offer = Number(size.offerPrice) || 0;
  return offer > 0 && offer < price;
}

// ============================================================
// Open Category
// ============================================================
function openCategory(catId, skipHistory) {
  const cat = STORE_DATA.categories.find(c => c.id === catId);
  if (!cat) return;

  const wasView = currentView;
  const sameCat = wasView === "category" && currentCategory === catId;
  currentCategory = catId;
  currentView = "category";
  closeSide();
  closeCartDrawer();

  if (viewHome) viewHome.classList.add("hidden");
  if (viewCategory) viewCategory.classList.remove("hidden");
  window.scrollTo(0, 0);

  const titleEl = document.getElementById("categoryTitle");
  if (titleEl) titleEl.textContent = `${cat.icon || ""} ${cat.name_ar}`;

  renderProducts(cat);

  if (!skipHistory && !sameCat) {
    setNav({ view: "category", id: catId }, "#category=" + catId, "push");
  } else if (skipHistory) {
    setNav({ view: "category", id: catId }, "#category=" + catId, null);
  }
}

// ============================================================
// Products
// ============================================================
function renderProducts(cat) {
  const list = document.getElementById("productsList");
  if (!list) return;
  list.innerHTML = "";

  if (!cat.products || cat.products.length === 0) {
    list.innerHTML = cat.id
      ? '<p class="empty-note">قريباً .. منتجات جديدة في هذا القسم 🧡</p>'
      : '<p class="empty-note">لا توجد منتجات مطابقة حالياً</p>';
    return;
  }

  cat.products.forEach(prod => {
    list.appendChild(buildProductCard(prod, cat));
  });
}

function buildProductCard(prod, cat) {
  const card = document.createElement("div");
  card.className = "product-card";

  const images = prod.images && prod.images.length ? prod.images : [];
  const firstImg = images[0] || "";
  const hasMultiple = images.length > 1;
  const cardHasOffer = (prod.sizes || []).some(s => isOfferActive(s));

  const paletteColors = (cat && cat.colors && cat.colors.length) ? cat.colors : DEFAULT_PALETTE;

  function colorsAt(i) {
    const raw = (prod.colors || [])[i] || "";
    return raw.split(/[،,]/).map(s => s.trim()).filter(Boolean);
  }

  const allColorsSet = new Set();
  images.forEach((_, i) => colorsAt(i).forEach(c => allColorsSet.add(c)));
  paletteColors.forEach(c => allColorsSet.add(c));
  const allColors = Array.from(allColorsSet);

  const hasColors = images.length > 0 && allColors.length > 0;

  const sizesHtml = (prod.sizes || []).map(s => {
    const onOffer = isOfferActive(s);
    const finalPrice = onOffer ? Number(s.offerPrice) : Number(s.price) || 0;
    return `
    <button class="pc-size-btn${onOffer ? " has-offer" : ""}" data-size="${s.label}" data-price="${finalPrice}">
      <span class="pc-size-label">${s.label}</span>
      <span class="pc-size-price">
        ${onOffer ? `<s class="pc-old-price">${s.price} ج.م</s> <b class="pc-offer-price">${finalPrice} ج.م</b>` : `${finalPrice} ج.م`}
      </span>
    </button>
  `;
  }).join("");

  const dotsHtml = hasMultiple
    ? `<div class="pc-gallery-dots">${images.map((_, i) => `<span class="pc-g-dot${i === 0 ? " active" : ""}" data-idx="${i}"></span>`).join("")}</div>`
    : "";

  const colorChipsHtml = hasColors
    ? allColors.map((c, i) => `<button type="button" class="pc-color-chip${i === 0 ? " active" : ""}" data-color="${c}">${c}</button>`).join("")
    : "";

  card.innerHTML = `
    <div class="pc-img-box" data-gallery-id="${prod.id}">
      ${firstImg
        ? `<img class="pc-img" src="${firstImg}" alt="${prod.name_ar}" loading="lazy" onerror="this.style.opacity=0.3">`
        : '<div class="pc-img" style="background:#1c1c1e;display:flex;align-items:center;justify-content:center;font-size:3rem;">👕</div>'}
      ${dotsHtml}
    </div>
    ${hasColors ? `
      <div class="pc-colors">
        <div class="pc-color-label">الألوان المتاحة: <b class="pc-color-name">${allColors[0]}</b></div>
        <div class="pc-color-chips">${colorChipsHtml}</div>
      </div>
    ` : ""}
    ${cardHasOffer ? '<span class="offer-badge card-offer-badge">عرض خاص</span>' : ""}
    <h3 class="pc-name">${prod.name_ar}</h3>
    ${prod.desc_ar ? `<p class="pc-desc">${prod.desc_ar}</p>` : '<p class="pc-desc"></p>'}
    <div class="pc-selected-info hidden" id="selInfo_${prod.id}">
      <span>المقاس المختار:</span>
      <span id="selText_${prod.id}"></span>
    </div>
    <div class="pc-sizes">
      ${sizesHtml || '<p class="empty-note" style="grid-column:1/-1;">لا توجد مقاسات</p>'}
    </div>
    <p class="pc-hint">اختار اللون و المقاس المناسب قبل الإضافة لسلة المشتريات</p>
    <button class="pc-add-btn" data-prod="${prod.id}" disabled>
      🛒 أضف إلى السلة
    </button>
  `;

  let selectedColorIdx = 0;
  let selectedColorName = allColors[0] || "";

  if (hasColors) {
    const nameEl = card.querySelector(".pc-color-name");
    const chips = card.querySelectorAll(".pc-color-chip");

    nameEl.textContent = allColors[0];
    selectedColorName = allColors[0];

    if (hasMultiple) {
      const firstIdx = images.findIndex((_, i) => colorsAt(i).includes(allColors[0]));
      if (firstIdx > 0) selectedColorIdx = firstIdx;
    }

    chips.forEach(chip => {
      chip.addEventListener("click", () => {
        const wanted = chip.dataset.color;
        chips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        nameEl.textContent = wanted;
        selectedColorName = wanted;

        const idx = images.findIndex((_, i) => colorsAt(i).includes(wanted));
        if (idx >= 0) {
          selectedColorIdx = idx;
          if (card._showImage) card._showImage(idx);
        }
      });
    });

    if (hasMultiple) setupProductGallery(card, prod, images, (newIdx) => {
      selectedColorIdx = newIdx;
      const cs = colorsAt(newIdx);
      if (cs.length) {
        selectedColorName = cs[0];
        nameEl.textContent = cs[0];
        chips.forEach(c => c.classList.toggle("active", c.dataset.color === cs[0]));
      }
    });
  }

  const sizeBtns = card.querySelectorAll(".pc-size-btn");
  const addBtn = card.querySelector(".pc-add-btn");
  const selInfo = card.querySelector(".pc-selected-info");
  const selText = card.querySelector(`#selText_${prod.id}`);

  let selectedSize = null;
  let selectedPrice = null;

  sizeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      sizeBtns.forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedSize = btn.dataset.size;
      selectedPrice = Number(btn.dataset.price) || 0;
      addBtn.disabled = false;
      selInfo.classList.remove("hidden");
      selText.textContent = `${selectedSize} - ${selectedPrice} ج.م`;
    });
  });

  addBtn.addEventListener("click", () => {
    if (!selectedSize) return;
    const cartImg = images[selectedColorIdx] || firstImg;
    addToCart({
      productId: prod.id,
      name: prod.name_ar,
      color: selectedColorName,
      size: selectedSize,
      price: selectedPrice,
      image: cartImg,
      qty: 1
    });
    sizeBtns.forEach(b => b.classList.remove("selected"));
    selectedSize = null;
    selectedPrice = null;
    addBtn.disabled = true;
    selInfo.classList.add("hidden");
  });

  return card;
}

function setupProductGallery(card, prod, images, onChange) {
  const box = card.querySelector(".pc-img-box");
  const img = card.querySelector(".pc-img");
  const dots = card.querySelectorAll(".pc-g-dot");
  if (!box || !img) return;

  let idx = 0;

  function show(i) {
    if (i < 0) i = images.length - 1;
    if (i >= images.length) i = 0;
    idx = i;
    img.src = images[idx];
    dots.forEach((d, di) => d.classList.toggle("active", di === idx));
    if (onChange) onChange(idx);
  }
  card._showImage = show;

  dots.forEach((d, di) => {
    d.addEventListener("click", (e) => { e.stopPropagation(); show(di); });
  });

  let touchStartX = 0;
  box.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  box.addEventListener("touchend", (e) => {
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) < 40) return;
    if (diff > 0) show(idx + 1); else show(idx - 1);
  }, { passive: true });

  let mouseStartX = 0, mouseDown = false;
  box.addEventListener("mousedown", (e) => { mouseStartX = e.screenX; mouseDown = true; });
  box.addEventListener("mouseup", (e) => {
    if (!mouseDown) return;
    mouseDown = false;
    const diff = mouseStartX - e.screenX;
    if (Math.abs(diff) < 40) return;
    if (diff > 0) show(idx + 1); else show(idx - 1);
  });
  box.addEventListener("mouseleave", () => { mouseDown = false; });
}

// ============================================================
// Hero CTA
// ============================================================
const heroCta = document.getElementById("heroCta");
if (heroCta) {
  heroCta.addEventListener("click", () => {
    const target = document.getElementById("catsSection");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

if (brandHome) {
  brandHome.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showHome(); }
  });
}

// ============================================================
// Back/Home
// ============================================================
const backBtnCategory = document.getElementById("backBtnCategory");
if (backBtnCategory) backBtnCategory.addEventListener("click", goBack);

["navBackTop", "navBackBottom"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", goBack);
});
["navHomeTop", "navHomeBottom"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", () => showHome());
});

// ============================================================
// Cart
// ============================================================
const cartDrawer = document.getElementById("cartDrawer");
const cartOverlay = document.getElementById("cartOverlay");

function openCartDrawer() {
  if (cartDrawer) cartDrawer.classList.add("open");
  if (cartOverlay) cartOverlay.classList.add("show");
}
function closeCartDrawer() {
  if (cartDrawer) cartDrawer.classList.remove("open");
  if (cartOverlay) cartOverlay.classList.remove("show");
}

const cartBtn = document.getElementById("cartBtn");
if (cartBtn) cartBtn.addEventListener("click", openCartDrawer);

if (cartOverlay) cartOverlay.addEventListener("click", closeCartDrawer);

const confirmOrderBtn = document.getElementById("confirmOrderBtn");
if (confirmOrderBtn) {
  confirmOrderBtn.addEventListener("click", () => {
    const cartItems = document.getElementById("cartItems");
    if (cartItems) cartItems.scrollTo({ top: cartItems.scrollHeight, behavior: "smooth" });
    const actions = document.querySelector(".cart-confirm-actions");
    if (actions) {
      actions.classList.add("flash");
      setTimeout(() => actions.classList.remove("flash"), 1500);
    }
  });
}

const addMoreBtn = document.getElementById("addMoreBtn");
if (addMoreBtn) addMoreBtn.addEventListener("click", closeCartDrawer);

function addToCart(line) {
  line.id = "c" + (cartLineId++);
  cart.push(line);
  renderCart();
  openCartDrawer();
}

function removeFromCart(id) {
  cart = cart.filter(l => l.id !== id);
  renderCart();
}

function renderCart() {
  const box = document.getElementById("cartItems");
  if (!box) return;
  box.innerHTML = "";

  if (cart.length === 0) {
    box.innerHTML = '<p class="empty-cart">السلة فارغة</p>';
  } else {
    cart.forEach(line => {
      const row = document.createElement("div");
      row.className = "cart-line";
      row.innerHTML = `
        <div class="cart-line-info">
          <strong>${line.qty} × ${line.name}</strong>
          <span class="line-price">${line.color ? `اللون: ${line.color} - ` : ""}المقاس: ${line.size} - ${line.price * line.qty} ج.م</span>
        </div>
        <button class="remove-line" aria-label="remove">✕</button>
      `;
      row.querySelector(".remove-line").onclick = () => removeFromCart(line.id);
      box.appendChild(row);
    });
  }

  const countEl = document.getElementById("cartCount");
  if (countEl) countEl.textContent = cart.reduce((a, l) => a + l.qty, 0);

  const totalEl = document.getElementById("cartTotal");
  if (totalEl) totalEl.textContent = cart.reduce((a, l) => a + l.price * l.qty, 0);

  updateConfirmButtonStates();
}

function buildOrderText() {
  if (cart.length === 0) return "";
  let msg = "🛍️ *طلب جديد من Maxim Casual Wear*\n\n";
  cart.forEach(l => {
    msg += `▪️ ${l.qty} × ${l.name}\n`;
    if (l.color) msg += `   اللون: ${l.color}\n`;
    msg += `   المقاس: ${l.size} - ${l.price * l.qty} ج.م\n\n`;
  });
  const total = cart.reduce((a, l) => a + l.price * l.qty, 0);
  msg += `━━━━━━━━━━━━━━━━\n`;
  msg += `💰 *الإجمالي:* ${total} ج.م`;
  return msg;
}

const sendWhatsappBtn = document.getElementById("sendWhatsappBtn");
if (sendWhatsappBtn) {
  sendWhatsappBtn.addEventListener("click", () => {
    if (cart.length === 0) { alert("السلة فارغة"); return; }
    const waNum = STORE_DATA.config.whatsappNumber;
    if (!waNum) { alert("رقم الواتساب غير مسجل"); return; }
    const msg = encodeURIComponent(buildOrderText());
    window.open(`https://wa.me/${waNum}?text=${msg}`, "_blank");
  });
}

const sendMessengerBtn = document.getElementById("sendMessengerBtn");
if (sendMessengerBtn) {
  sendMessengerBtn.addEventListener("click", (e) => {
    if (cart.length === 0) { e.preventDefault(); alert("السلة فارغة"); return; }
    const msg = buildOrderText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(msg).then(() => {
        const toast = document.createElement("div");
        toast.className = "clipboard-toast";
        toast.textContent = "✅ تم نسخ تفاصيل الطلب — الصقها في الماسنجر";
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add("show"), 50);
        setTimeout(() => {
          toast.classList.remove("show");
          setTimeout(() => toast.remove(), 400);
        }, 3500);
      }).catch(() => {});
    }
  });
}

function updateConfirmButtonStates() {
  const empty = cart.length === 0;
  if (sendWhatsappBtn) sendWhatsappBtn.disabled = empty;
  if (sendMessengerBtn) sendMessengerBtn.style.opacity = empty ? 0.5 : 1;
}

// ============================================================
// History
// ============================================================
function applyState(state) {
  if (!state || state.view === "home") {
    showHome(true);
  } else if (state.view === "category" && state.id) {
    openCategory(state.id, true);
  }
}

window.addEventListener("popstate", (event) => {
  if (isOverlayOpen()) {
    closeSide();
    closeCartDrawer();
    history.pushState(currentState, "", currentUrl);
    return;
  }
  const state = event.state;
  if (!state || state.view === "root") {
    showHome(true);
    setNav({ view: "home" }, location.pathname + location.search, "push");
    return;
  }
  currentState = state;
  currentUrl = location.pathname + location.search + (state.view === "category" ? "#category=" + state.id : "");
  applyState(state);
});

let pendingDeepLink = (location.hash.match(/^#category=(.+)$/) || [])[1] || null;

history.replaceState({ view: "root" }, "", location.pathname + location.search);
setNav({ view: "home" }, location.pathname + location.search, "push");

function tryDeepLink() {
  if (!pendingDeepLink) return;
  const id = decodeURIComponent(pendingDeepLink);
  if ((STORE_DATA.categories || []).some(c => c.id === id)) {
    pendingDeepLink = null;
    openCategory(id);
  }
}
window.addEventListener("storeDataReady", tryDeepLink);

// ============================================================
// Install Prompt
// ============================================================
let deferredPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const lastDismiss = sessionStorage.getItem("installDismissed");
  if (!lastDismiss) {
    const prompt = document.getElementById("installPrompt");
    if (prompt) prompt.classList.remove("hidden");
  }
});

const installNowBtn = document.getElementById("installNowBtn");
if (installNowBtn) {
  installNowBtn.addEventListener("click", async () => {
    const prompt = document.getElementById("installPrompt");
    if (prompt) prompt.classList.add("hidden");
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    }
  });
}

const installLaterBtn = document.getElementById("installLaterBtn");
if (installLaterBtn) {
  installLaterBtn.addEventListener("click", () => {
    const prompt = document.getElementById("installPrompt");
    if (prompt) prompt.classList.add("hidden");
    sessionStorage.setItem("installDismissed", "1");
  });
}

// ============================================================
// Splash
// ============================================================
(function () {
  const splash = document.getElementById("splashScreen");
  if (!splash) return;
  let done = false;
  function closeSplash() {
    if (done) return;
    done = true;
    splash.classList.add("fade-out");
    setTimeout(() => splash.remove(), 900);
  }
  splash.addEventListener("click", closeSplash);
  setTimeout(closeSplash, 6200);
})();

// ============================================================
// التشغيل الأولي
// ============================================================
applySocialLinks();
applyConfig();
renderCategories();
renderFeatured();
renderOffersSlider();
renderCart();
tryDeepLink();

// ============================================================
// Splash dot
// ============================================================
function placeSplashDot() {
  const wm = document.querySelector(".splash-wordmark");
  const iEl = document.querySelector(".wm-i");
  const dot = document.querySelector(".wm-dot");
  if (!wm || !iEl || !dot) return;
  const cs = getComputedStyle(wm);
  const fs = parseFloat(cs.fontSize);
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
  const m = ctx.measureText("\u0131");
  const fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent;
  if (!fa || !m.actualBoundingBoxAscent) return;
  const lh = parseFloat(cs.lineHeight) || fs * 1.05;
  const baseline = (lh - (fa + fd)) / 2 + fa;
  const stem = m.actualBoundingBoxAscent;
  const size = fs * 0.17;
  const top = baseline - stem - size - fs * 0.075;
  dot.style.top = top + "px";
  dot.style.width = dot.style.height = size + "px";
  dot.style.marginLeft = (-size / 2) + "px";
}
placeSplashDot();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeSplashDot);
// ============================================================
// Preload كل الصور للـoffline
// يشتغل في الخلفية بعد تحميل الصفحة
// ============================================================
function preloadAllImages() {
  const urls = new Set();

  // 1) الصور المميزة
  (STORE_DATA.featured || []).forEach(url => urls.add(url));

  // 2) صور العروض
  (STORE_DATA.offers || []).forEach(offer => {
    if (offer.image) urls.add(offer.image);
  });

  // 3) صور كل المنتجات في كل الأقسام
  (STORE_DATA.categories || []).forEach(cat => {
    if (cat.homeImg) urls.add(cat.homeImg);
    (cat.products || []).forEach(prod => {
      (prod.images || []).forEach(img => urls.add(img));
    });
  });

  console.log(`📸 Preloading ${urls.size} images for offline...`);

  // تحميل كل صورة واحدة ورا التانية (ببطء عشان ما يزحمش الشبكة)
  let loaded = 0;
  let failed = 0;
  const total = urls.size;

  urls.forEach(url => {
    const img = new Image();
    img.onload = () => {
      loaded++;
      if (loaded + failed === total) {
        console.log(`✅ Preload complete: ${loaded}/${total} images ready for offline`);
      }
    };
    img.onerror = () => {
      failed++;
      if (loaded + failed === total) {
        console.log(`⚠️ Preload done: ${loaded} loaded, ${failed} failed`);
      }
    };
    img.src = url;
  });
}

// تشغيل الـPreload بعد 3 ثواني من تحميل الموقع
// (عشان ما يعطلش تجربة المستخدم)
window.addEventListener('load', () => {
  setTimeout(preloadAllImages, 3000);
});
console.log("🛍️ Maxim store loaded");
