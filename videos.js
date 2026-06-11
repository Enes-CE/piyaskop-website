/**
 * videos.js — Piyaskop YouTube otomatik içerik güncelleme
 *
 * Sayfa açıldığında kanalın son videolarını YouTube Data API v3'ten çeker ve
 * şu bölümleri günceller:
 *   - Öne çıkan video (en yeni uzun video)
 *   - Son Videolar kartları (son 3 uzun video)
 *   - Shorts satırı (son 4 short)
 *   - Duyurular listesi (son 3 uzun video)
 *   - Hero görseli (kanal kapağı) ve Hakkımda fotoğrafı (kanal avatarı)
 *
 * API anahtarı yoksa veya istek başarısız olursa HTML'deki mevcut içerik
 * olduğu gibi kalır — site asla boş görünmez.
 *
 * Kurulum:
 *   1. https://console.cloud.google.com adresinde proje açın.
 *   2. "YouTube Data API v3"ü etkinleştirin.
 *   3. API anahtarı oluşturun, "HTTP yönlendiren (web sitesi)" kısıtı ile
 *      kendi alan adınıza kilitleyin (ör. https://piyaskop.com/*).
 *   4. Anahtarı Piyaskop.html içindeki PIYASKOP_CONFIG.ytApiKey alanına yazın.
 *
 * Önizleme: API anahtarı olmadan denemek için sayfayı ?piyaskop-mock
 * parametresiyle açın (örnek verilerle doldurur).
 */
(function () {
  'use strict';

  var CHANNEL_ID = 'UCVybFs3ZzhjTUnlHPMODBGw'; // @piyaskop
  var UPLOADS_PLAYLIST = 'UU' + CHANNEL_ID.slice(2);
  var API_BASE = 'https://www.googleapis.com/youtube/v3';
  var CACHE_KEY = 'piyaskop-videos-v2';
  var CACHE_TTL_MS = 60 * 60 * 1000; // 1 saat
  var MAX_FETCH = 20;
  // 3 dakikaya kadar olan videolar Shorts olabilir; başlıktaki #shorts
  // etiketiyle birlikte değerlendirilir.
  var SHORT_MAX_SECONDS = 183;

  function apiKey() {
    return (window.PIYASKOP_CONFIG && window.PIYASKOP_CONFIG.ytApiKey) || '';
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────

  function cleanTitle(title) {
    return title
      .replace(/#[^\s#,]+/g, '')   // hashtag'leri at
      .replace(/[,\s]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function inferTag(video) {
    var hay = (video.title + ' ' + (video.tags || []).join(' ')).toLowerCase();
    if (/yapay zek|claude|gpt|openai|anthropic|\bai\b|deepseek|gemini/.test(hay)) return 'Yapay Zekâ';
    if (/nvidia|meta|apple|google|amazon|tesla|microsoft|şirket|sirket/.test(hay)) return 'Şirketler';
    if (/borsa|piyasa|dolar|enflasyon|fed|faiz|bitcoin|kripto/.test(hay)) return 'Piyasalar';
    return 'Analiz';
  }

  function monthLabel(publishedAt) {
    try {
      var d = new Date(publishedAt);
      var s = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
      return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
    } catch (e) { return ''; }
  }

  function shortDescription(desc, fallbackTitle) {
    var line = (desc || '').split('\n').map(function (l) { return l.trim(); })
      .filter(function (l) { return l && !/^https?:\/\//.test(l) && !/^#/.test(l); })[0] || '';
    line = line.replace(/https?:\/\/\S+/g, '').trim();
    if (!line) line = fallbackTitle + ' — yeni video kanalda.';
    if (line.length > 120) line = line.slice(0, 117).replace(/\s+\S*$/, '') + '…';
    return line;
  }

  function watchUrl(v) {
    return v.isShort
      ? 'https://www.youtube.com/shorts/' + v.id
      : 'https://www.youtube.com/watch?v=' + v.id;
  }

  function bestThumb(v) {
    var t = v.thumbnails || {};
    return (t.maxres && t.maxres.url) || (t.standard && t.standard.url) ||
           (t.high && t.high.url) || 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
  }

  // Shorts için dikey (9:16) kapak: oardefault her videoda bulunmayabilir,
  // bu yüzden yüklenip yüklenmediği denenir, olmazsa yatay kapağa düşülür.
  function verticalThumb(v) {
    return new Promise(function (resolve) {
      var vertical = 'https://i.ytimg.com/vi/' + v.id + '/oardefault.jpg';
      var img = new Image();
      // i.ytimg.com eksik varyant için 120x90 gri kare döndürür — onu da ele.
      img.onload = function () {
        resolve(img.naturalWidth > 120 ? vertical : bestThumb(v));
      };
      img.onerror = function () { resolve(bestThumb(v)); };
      img.src = vertical;
    });
  }

  function parseISODuration(iso) {
    var m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
    if (!m) return 0;
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  }

  // ── Veri çekme ───────────────────────────────────────────────────────────

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (Date.now() - c.t > CACHE_TTL_MS) return null;
      return c;
    } catch (e) { return null; }
  }

  function writeCache(videos, channel) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), videos: videos, channel: channel }));
    } catch (e) {}
  }

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('YouTube API ' + r.status);
      return r.json();
    });
  }

  function fetchChannel() {
    var url = API_BASE + '/channels?part=snippet,brandingSettings&id=' + CHANNEL_ID +
      '&key=' + apiKey();
    return fetchJson(url).then(function (data) {
      var ch = (data.items || [])[0];
      if (!ch) return null;
      var thumbs = (ch.snippet && ch.snippet.thumbnails) || {};
      var banner = ch.brandingSettings && ch.brandingSettings.image &&
        ch.brandingSettings.image.bannerExternalUrl;
      return {
        avatar: (thumbs.high && thumbs.high.url) || (thumbs.medium && thumbs.medium.url) || '',
        banner: banner ? banner + '=w1707' : '',
      };
    });
  }

  function fetchVideos() {
    var key = apiKey();
    var listUrl = API_BASE + '/playlistItems?part=snippet&maxResults=' + MAX_FETCH +
      '&playlistId=' + UPLOADS_PLAYLIST + '&key=' + key;

    return fetchJson(listUrl).then(function (data) {
      var items = (data.items || []).map(function (it) {
        var sn = it.snippet || {};
        return {
          id: sn.resourceId && sn.resourceId.videoId,
          title: sn.title || '',
          description: sn.description || '',
          publishedAt: sn.publishedAt || '',
          thumbnails: sn.thumbnails || {},
        };
      }).filter(function (v) { return v.id; });

      if (!items.length) return [];

      var ids = items.map(function (v) { return v.id; }).join(',');
      var detailUrl = API_BASE + '/videos?part=contentDetails,snippet&id=' + ids + '&key=' + key;

      return fetchJson(detailUrl).then(function (det) {
        var byId = {};
        (det.items || []).forEach(function (d) { byId[d.id] = d; });
        items.forEach(function (v) {
          var d = byId[v.id];
          var dur = d ? parseISODuration(d.contentDetails && d.contentDetails.duration) : 0;
          v.tags = (d && d.snippet && d.snippet.tags) || [];
          v.isShort = /#shorts/i.test(v.title) || (dur > 0 && dur <= SHORT_MAX_SECONDS);
          v.title = cleanTitle(v.title);
        });
        return items;
      });
    });
  }

  // ── DOM güncelleme ───────────────────────────────────────────────────────

  function setSlot(slot, url) {
    if (slot && url) slot.setAttribute('src', url);
  }

  function applyChannel(channel) {
    if (!channel) return;
    setSlot(document.getElementById('hero-banner'), channel.banner);
    setSlot(document.getElementById('portrait'), channel.avatar);
  }

  function applyVideos(videos) {
    var longs = videos.filter(function (v) { return !v.isShort; });
    var shorts = videos.filter(function (v) { return v.isShort; });

    // Öne çıkan video — en yeni uzun video
    var featured = document.querySelector('.featured');
    if (featured && longs[0]) {
      var f = longs[0];
      featured.href = watchUrl(f);
      setSlot(featured.querySelector('image-slot'), bestThumb(f));
      var fTag = featured.querySelector('.video-tag');
      if (fTag) fTag.textContent = inferTag(f);
      var fTitle = featured.querySelector('.featured-info h3');
      if (fTitle) fTitle.textContent = f.title;
    }

    // Son Videolar kartları
    var cards = document.querySelectorAll('.video-grid .video-card');
    Array.prototype.forEach.call(cards, function (card, i) {
      var v = longs[i];
      if (!v) { card.style.display = 'none'; return; }
      card.style.display = '';
      var link = card.querySelector('a');
      if (link) link.href = watchUrl(v);
      setSlot(card.querySelector('image-slot'), bestThumb(v));
      var tag = card.querySelector('.video-tag');
      if (tag) tag.textContent = inferTag(v);
      var h3 = card.querySelector('h3');
      if (h3) h3.textContent = v.title;
    });

    // Shorts satırı
    var shortCards = document.querySelectorAll('.shorts-row .short-card');
    Array.prototype.forEach.call(shortCards, function (card, i) {
      var v = shorts[i];
      if (!v) { card.style.display = 'none'; return; }
      card.style.display = '';
      card.href = watchUrl(v);
      card.setAttribute('aria-label', v.title);
      card.title = v.title;
      var slot = card.querySelector('image-slot');
      verticalThumb(v).then(function (url) { setSlot(slot, url); });
    });

    // Duyurular — son 3 uzun video
    var newsItems = document.querySelectorAll('.news-list .news-item');
    Array.prototype.forEach.call(newsItems, function (item, i) {
      var v = longs[i];
      if (!v) { item.style.display = 'none'; return; }
      item.style.display = '';
      var date = item.querySelector('.news-date');
      if (date) date.textContent = monthLabel(v.publishedAt);
      var h3 = item.querySelector('h3');
      if (h3) h3.textContent = v.title;
      var p = item.querySelector('p');
      if (p) p.textContent = shortDescription(v.description, v.title);
    });
  }

  // ── Başlatma ─────────────────────────────────────────────────────────────

  function init() {
    if (/[?&]piyaskop-mock/.test(location.search)) {
      applyVideos(MOCK_VIDEOS);
      applyChannel(MOCK_CHANNEL);
      return;
    }
    if (!apiKey()) return; // anahtar yoksa HTML'deki içerik kalır

    var cached = readCache();
    if (cached) {
      applyVideos(cached.videos || []);
      applyChannel(cached.channel);
      return;
    }

    Promise.all([
      fetchVideos(),
      fetchChannel().catch(function () { return null; }),
    ]).then(function (res) {
      var videos = res[0], channel = res[1];
      if (videos.length) {
        writeCache(videos, channel);
        applyVideos(videos);
        applyChannel(channel);
      }
    }).catch(function (err) {
      console.warn('Piyaskop: video listesi alınamadı, mevcut içerik korunuyor.', err);
    });
  }

  // API anahtarı olmadan tasarımı önizlemek için örnek veriler.
  var MOCK_VIDEOS = [
    { id: 'aMaEGYuZStQ', title: '1 Dakikada iOS 27 ile Gelecek Yenilikler! Siri AI, Fotoğraflar ve Daha Fazlası', description: '', publishedAt: '2026-06-09T22:12:47Z', tags: [], isShort: true },
    { id: 'ELEhq22OVP4', title: "Meta'dan İçerik Üreticilerine Yeni Yapay Zeka Aracı", description: '', publishedAt: '2026-06-07T07:00:08Z', tags: [], isShort: true },
    { id: '0-2iDf25oHE', title: 'Meta Bir Yapay Zeka Şirketine mi Dönüşüyor?', description: "Rekor kâr, yapay zekâ planı ve 8.000 kişilik işten çıkarma — Meta'nın dönüşümünü inceliyoruz.", publishedAt: '2026-06-02T17:23:18Z', tags: ['meta'], isShort: false },
    { id: 'I-GIiVNFeLI', title: 'Meta 8.000 Kişiyi Kovdu, Kalanlar İşlerini Kurtardı mı?', description: '', publishedAt: '2026-05-24T20:48:20Z', tags: [], isShort: true },
    { id: '0hcNmAdFl4g', title: "OpenAI'dan Ayrıldı, 2.5 Milyar Dolarlık Araç Yaptı Kim Bu Adam?", description: '', publishedAt: '2026-05-22T07:00:24Z', tags: [], isShort: true },
    { id: 'mAYqBto1ans', title: 'Claude Code: Yazılım Dünyasının Yeni Kırılma Anı', description: 'Yazılım dünyasının en büyük dönüşümü — kodun arkasındaki yeni sistem.', publishedAt: '2026-05-20T14:37:15Z', tags: ['claude', 'ai'], isShort: false },
    { id: 'cIRNLOEykdk', title: "Nvidia'yı Ekran Kartı Şirketi Sananlar Yanılıyor", description: "AI çağının petrolü mü? Nvidia'nın asıl sattığı şeyi inceliyoruz.", publishedAt: '2026-05-14T11:01:00Z', tags: ['nvidia'], isShort: false },
  ];

  var MOCK_CHANNEL = {
    avatar: 'https://yt3.ggpht.com/sWhRFEZMEx5D9BHU_AWGspu5cuOhPt1wad8R-t1f5oUKrUpbiP9E9uYRRIfd84LrOqegeX9k3A=s800-c-k-c0x00ffffff-no-rj',
    banner: 'https://yt3.googleusercontent.com/T5SwYJ3DjBo9OAuq84_-L1-tXQ3DUovykluCpogCEGFJVXgpHNFL10-UZSXNs8bl2Bh4mj-9Sg=w1707',
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
