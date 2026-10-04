// ============================================================
// Maxim Casual Wear - Data Loader
// ============================================================

(async function loadSiteData() {
  try {
    const res = await fetch('site-data.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const converted = {
      config: data.config || {},
      social: data.social || {},
      featured: data.featured || [],
      offers: Array.isArray(data.offers) ? data.offers : [],
      categories: (data.categories || []).map(function(cat) {
        return {
          id: cat.id,
          icon: cat.icon || '🛍️',
          name_ar: cat.name_ar,
          name_en: cat.name_en,
          homeImg: cat.homeImg || '',
          visible: cat.visible !== false,
          colors: cat.colors || [],
          products: (cat.products || []).map(function(p) {
            return {
              id: p.id,
              name_ar: p.name_ar,
              name_en: p.name_en,
              desc_ar: p.desc_ar || '',
              desc_en: p.desc_en || '',
              images: p.images || [],
              colors: p.colors || [],
              sizes: p.sizes || []
            };
          })
        };
      })
    };

    // ←←← اسم المفتاح الجديد (v2)
    localStorage.setItem('maximStoreData_v2', JSON.stringify(converted));
    console.log('✅ site-data.json loaded:', converted.categories.length, 'categories,', converted.offers.length, 'offers');

    window.dispatchEvent(new Event('storeDataReady'));

  } catch (e) {
    console.warn('⚠️ site-data.json failed:', e.message);
    const fallback = {
      config: {
        brand_ar: 'Maxim',
        brand_en: 'Maxim Casual Wear',
        tagline_ar: 'أناقه بلا حدود',
        tagline_en: 'Elegance without limits',
        about_ar: 'إختيارك ل Maxim .. إختيار الجوده و الشياكه.',
        whatsappNumber: '',
        phones: [],
        address_ar: 'Online Store',
        mapUrl: ''
      },
      social: {},
      featured: [],
      offers: [],
      categories: []
    };
    localStorage.setItem('maximStoreData_v2', JSON.stringify(fallback));
    window.dispatchEvent(new Event('storeDataReady'));
  }
})();