/*
 * Standalone translate page logic.
 *
 * - DeepL-style translator is the default view.
 * - The old two-sided conversation practice lives in a secondary tab.
 * - The browser never holds a key or a prompt; it only calls TRANSLATE_ENDPOINT.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'koreanSite_zhcn_draft_v01';
  var ACCOUNTS_KEY = STORAGE_KEY + '_accounts';
  var THEME_KEY = 'koreanSite_theme_v1';
  var MAX_TEXT = 4000;
  var DEBOUNCE_MS = 500;
  var UI_LANG_ORDER = ['zh', 'ko', 'en'];
  var UI_LANG_LABELS = { zh: '中文', ko: '한국어', en: 'English' };
  var LANGS = ['zh', 'ko', 'en'];
  var PUBLIC_ENDPOINT = 'https://korean-site-zhcn.vercel.app/api/translate';

  var I18N = {
    zh: {
      brandName: '与你同行',
      brandSub: 'v0.1',
      draftBadge: '国内版初稿',
      nav_translate: '翻译',
      nav_practice: '练习',
      nav_video: '视频学习',
      nav_daily: '每日复习',
      nav_favorites: '收藏',
      nav_ai: 'AI 导师',
      nav_settings: '设置',
      nav_grammar: '语法',
      nav_browse: '词库',
      authTopLogin: '登录 / 注册',
      lang_zh: '中文',
      lang_ko: '韩语',
      lang_en: '英语',
      trPageTitle: '翻译',
      trPageHint: '中文与韩语互译，也可切换英语。服务器不可达时会明确报错，不会编造译文。',
      trTabTranslate: '翻译',
      trTabConversation: '对话练习',
      trSourceLang: '源语言',
      trTargetLang: '目标语言',
      trSwap: '交换语言和文本',
      trHonorific: '敬语',
      trTranslate: '翻译',
      trSourcePh: '输入要翻译的内容…',
      trTargetPh: '译文会显示在这里',
      trClear: '清空',
      trSpeak: '朗读',
      trCopy: '复制',
      trCopied: '已复制',
      trCopyFail: '复制失败',
      trFav: '收藏',
      trUnfav: '取消收藏',
      trFavSaved: '已加入收藏',
      trTranslating: '正在翻译…',
      trAutoHint: '停止输入后自动翻译',
      trDone: '已翻译',
      trFailed: '翻译失败',
      trNetworkError: '网络或服务器错误',
      trEmptyResult: '服务器没有返回译文',
      trSourceEmpty: '请先输入内容',
      trChars: '{n} / 4000',
      trRoma: '罗马音',
      trNoSpeech: '当前浏览器不支持朗读',
      trConvTitle: '对话练习',
      trConvHint: '两边各写一句，原文永久保留；翻译由服务器返回。首次设置不会挡住翻译。',
      trSideA: '侧 A',
      trSideB: '侧 B',
      trSend: '发送',
      trTypePh: '在此输入…',
      trOriginal: '原文',
      trTranslation: '译文',
      trClearFeed: '清空此侧',
      trHonorificOn: '敬语',
      trHonorificOff: '非敬语',
      trEmptyFeed: '还没有句子。',
      footerNote: '© 2026 동행 · Together · 同行',
      footerHome: '返回首页'
    },
    ko: {
      brandName: '당신과 동행',
      brandSub: 'v0.1',
      draftBadge: '국내판 초고',
      nav_translate: '번역',
      nav_practice: '연습',
      nav_video: '영상',
      nav_daily: '매일 복습',
      nav_favorites: '즐겨찾기',
      nav_ai: 'AI 튜터',
      nav_settings: '설정',
      nav_grammar: '문법',
      nav_browse: '목록',
      authTopLogin: '로그인 / 가입',
      lang_zh: '중국어',
      lang_ko: '한국어',
      lang_en: '영어',
      trPageTitle: '번역',
      trPageHint: '중국어와 한국어를 양방향으로 번역하고 영어도 선택할 수 있습니다. 서버에 연결할 수 없으면 오류를 분명히 보여 주며 번역을 지어내지 않습니다.',
      trTabTranslate: '번역',
      trTabConversation: '대화 연습',
      trSourceLang: '출발어',
      trTargetLang: '도착어',
      trSwap: '언어와 텍스트 바꾸기',
      trHonorific: '존댓말',
      trTranslate: '번역',
      trSourcePh: '번역할 내용을 입력하세요…',
      trTargetPh: '번역문이 여기에 표시됩니다',
      trClear: '지우기',
      trSpeak: '읽기',
      trCopy: '복사',
      trCopied: '복사됨',
      trCopyFail: '복사하지 못했습니다',
      trFav: '즐겨찾기',
      trUnfav: '즐겨찾기 해제',
      trFavSaved: '즐겨찾기에 저장됨',
      trTranslating: '번역 중…',
      trAutoHint: '입력을 멈추면 자동으로 번역합니다.',
      trDone: '번역됨',
      trFailed: '번역 실패',
      trNetworkError: '네트워크 또는 서버 오류',
      trEmptyResult: '서버가 번역문을 반환하지 않았습니다',
      trSourceEmpty: '먼저 내용을 입력하세요',
      trChars: '{n} / 4000',
      trRoma: '로마자',
      trNoSpeech: '이 브라우저는 읽기를 지원하지 않습니다',
      trConvTitle: '대화 연습',
      trConvHint: '양쪽에 한 문장씩 입력하세요. 원문은 항상 남고 번역은 서버가 돌려줍니다. 첫 설정이 번역을 막지 않습니다.',
      trSideA: '쪽 A',
      trSideB: '쪽 B',
      trSend: '보내기',
      trTypePh: '여기에 입력…',
      trOriginal: '원문',
      trTranslation: '번역',
      trClearFeed: '이쪽 비우기',
      trHonorificOn: '존댓말',
      trHonorificOff: '반말',
      trEmptyFeed: '아직 문장이 없습니다.',
      footerNote: '© 2026 동행 · Together · 同行',
      footerHome: '홈으로'
    },
    en: {
      brandName: 'Together With You',
      brandSub: 'v0.1',
      draftBadge: 'CN draft',
      nav_translate: 'Translate',
      nav_practice: 'Practice',
      nav_video: 'Video',
      nav_daily: 'Daily Review',
      nav_favorites: 'Favorites',
      nav_ai: 'AI Tutor',
      nav_settings: 'Settings',
      nav_grammar: 'Grammar',
      nav_browse: 'Browse',
      authTopLogin: 'Log in / Sign up',
      lang_zh: 'Chinese',
      lang_ko: 'Korean',
      lang_en: 'English',
      trPageTitle: 'Translate',
      trPageHint: 'Translate between Chinese and Korean, with English as an optional direction. If the server is unreachable the page shows a clear error and never invents a translation.',
      trTabTranslate: 'Translate',
      trTabConversation: 'Conversation practice',
      trSourceLang: 'Source language',
      trTargetLang: 'Target language',
      trSwap: 'Swap languages and texts',
      trHonorific: 'Honorific',
      trTranslate: 'Translate',
      trSourcePh: 'Type or paste text to translate…',
      trTargetPh: 'The translation appears here',
      trClear: 'Clear',
      trSpeak: 'Read aloud',
      trCopy: 'Copy',
      trCopied: 'Copied',
      trCopyFail: 'Copy failed',
      trFav: 'Favorite',
      trUnfav: 'Unfavorite',
      trFavSaved: 'Saved to favorites',
      trTranslating: 'Translating…',
      trAutoHint: 'Translates automatically after you stop typing.',
      trDone: 'Translated',
      trFailed: 'Translation failed',
      trNetworkError: 'Network or server error',
      trEmptyResult: 'The server returned no translation',
      trSourceEmpty: 'Enter some text first',
      trChars: '{n} / 4000',
      trRoma: 'Romanization',
      trNoSpeech: 'This browser does not support read-aloud',
      trConvTitle: 'Conversation practice',
      trConvHint: 'Write one sentence on each side. The original is always kept and the server returns the translation. First-run setup never blocks translation.',
      trSideA: 'Side A',
      trSideB: 'Side B',
      trSend: 'Send',
      trTypePh: 'Type here…',
      trOriginal: 'Original',
      trTranslation: 'Translation',
      trClearFeed: 'Clear this side',
      trHonorificOn: 'Honorific',
      trHonorificOff: 'Casual',
      trEmptyFeed: 'No sentences yet.',
      footerNote: '© 2026 동행 · Together · 同行',
      footerHome: 'Back to home'
    }
  };

  var NAV = [
    { id: 'translate', href: 'translate.html', icon: '💬', key: 'nav_translate' },
    { id: 'practice', href: 'index.html', icon: '✏️', key: 'nav_practice' },
    { id: 'video', href: 'index.html?panel=video', icon: '🎬', key: 'nav_video' },
    { id: 'daily', href: 'index.html?panel=daily', icon: '📅', key: 'nav_daily' },
    { id: 'favorites', href: 'index.html?panel=favorites', icon: '⭐', key: 'nav_favorites' },
    { id: 'ai', href: 'index.html?panel=ai', icon: '🤖', key: 'nav_ai' },
    { id: 'settings', href: 'index.html?panel=settings', icon: '⚙️', key: 'nav_settings' },
    { spacer: true },
    { id: 'grammar', href: 'index.html?panel=grammar', icon: '🧩', key: 'nav_grammar' },
    { id: 'browse', href: 'index.html?panel=browse', icon: '📚', key: 'nav_browse' }
  ];

  function defaultSides() {
    return {
      a: { lang: 'ko', other: 'zh', utterances: [] },
      b: { lang: 'zh', other: 'ko', utterances: [] }
    };
  }

  function mergeSide(base, raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      lang: LANGS.indexOf(source.lang) >= 0 ? source.lang : base.lang,
      other: LANGS.indexOf(source.other) >= 0 ? source.other : base.other,
      utterances: Array.isArray(source.utterances) ? source.utterances : []
    };
  }

  function mergeSides(raw) {
    var base = defaultSides();
    var source = raw && typeof raw === 'object' ? raw : {};
    return { a: mergeSide(base.a, source.a), b: mergeSide(base.b, source.b) };
  }

  function defaultSetup() {
    return { done: false, nativeLang: 'zh', goal: '', level: 'beginner', voiceOn: true };
  }

  function activeStorageKey() {
    try {
      var raw = localStorage.getItem(ACCOUNTS_KEY);
      var accounts = raw ? JSON.parse(raw) : null;
      if (accounts && accounts.current && accounts.accounts && accounts.accounts[accounts.current]) {
        return STORAGE_KEY + '_acct_' + accounts.current;
      }
    } catch (error) { /* local storage unavailable */ }
    return STORAGE_KEY;
  }

  function readStored() {
    try {
      var raw = localStorage.getItem(activeStorageKey());
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  var stored = readStored();
  var state = {
    uiLang: UI_LANG_ORDER.indexOf(stored.uiLang) >= 0 ? stored.uiLang : 'zh',
    translateSetup: Object.assign(defaultSetup(), stored.translateSetup && typeof stored.translateSetup === 'object' ? stored.translateSetup : {}),
    translateSides: mergeSides(stored.translateSides),
    translateFavorites: Array.isArray(stored.translateFavorites) ? stored.translateFavorites : []
  };

  var autoTimer = 0;
  var requestSeq = 0;
  var activeAbort = null;
  var convDrafts = { a: '', b: '' };
  var lastRoma = '';
  var els = {};

  function $(id) { return document.getElementById(id); }

  function t(key, vars) {
    var table = I18N[state.uiLang] || I18N.zh;
    var text = table[key];
    if (text == null) text = I18N.en[key];
    if (text == null) return key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.replace(new RegExp('\\{' + name + '\\}', 'g'), String(vars[name]));
      });
    }
    return text;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function persist(syncLanguageFlags) {
    try {
      var raw = readStored();
      raw.uiLang = state.uiLang;
      if (syncLanguageFlags) {
        if (state.uiLang === 'ko') { raw.showKO = true; raw.showEN = false; raw.showZH = false; }
        else if (state.uiLang === 'en') { raw.showEN = true; raw.showKO = false; raw.showZH = false; }
        else { raw.showZH = true; raw.showEN = true; raw.showKO = false; }
      }
      raw.translateSetup = state.translateSetup;
      raw.translateSides = state.translateSides;
      raw.translateFavorites = state.translateFavorites;
      localStorage.setItem(activeStorageKey(), JSON.stringify(raw));
    } catch (error) {
      toast('localStorage error');
    }
  }

  function toast(message, ms) {
    var node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { node.classList.remove('show'); }, ms || 2200);
  }

  function translateEndpoint() {
    try {
      var host = String(location.hostname || '').toLowerCase();
      if (!host) return PUBLIC_ENDPOINT;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return '/api/translate';
      if (/\.vercel\.app$/.test(host)) return '/api/translate';
      return PUBLIC_ENDPOINT;
    } catch (error) {
      return PUBLIC_ENDPOINT;
    }
  }

  function syncHtmlLang() {
    var map = { zh: 'zh-CN', ko: 'ko', en: 'en' };
    document.documentElement.lang = map[state.uiLang] || 'zh-CN';
  }

  function renderHeader() {
    var brand = $('brand-name');
    var sub = $('brand-sub');
    var badge = $('draft-badge');
    var auth = $('auth-top-btn');
    if (brand) brand.textContent = t('brandName');
    if (sub) sub.textContent = t('brandSub');
    if (badge) badge.textContent = t('draftBadge');
    if (auth) {
      auth.textContent = t('authTopLogin');
      auth.onclick = function () { location.href = 'auth/preview.html'; };
    }
    document.title = t('trPageTitle') + ' · 동행 · Together · 同行';
    syncHtmlLang();
  }

  function renderNav() {
    var nav = $('main-nav');
    if (!nav) return;
    nav.setAttribute('aria-label', state.uiLang === 'en' ? 'Main navigation' : (state.uiLang === 'ko' ? '주요 메뉴' : '主导航'));
    nav.innerHTML = NAV.map(function (item) {
      if (item.spacer) return '<div class="nav-spacer"></div>';
      var active = item.id === 'translate';
      return '<a class="nav-link' + (active ? ' active' : '') + '" href="' + esc(item.href) + '"'
        + ' data-panel="' + esc(item.id) + '"'
        + (active ? ' aria-current="page"' : '') + '>'
        + '<span class="ico">' + item.icon + '</span><span>' + esc(t(item.key)) + '</span></a>';
    }).join('');
    nav.querySelectorAll('a.nav-link').forEach(function (link) {
      link.addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    });
  }

  function paintLangThumb() {
    var seg = $('ui-lang-seg');
    if (!seg) return;
    var buttons = Array.prototype.slice.call(seg.querySelectorAll('button[data-lang]'));
    if (!buttons.length) return;
    var segRect = seg.getBoundingClientRect();
    var style = getComputedStyle(seg);
    var originX = segRect.left + (parseFloat(style.borderLeftWidth) || 0);
    var activeIndex = Math.max(0, UI_LANG_ORDER.indexOf(state.uiLang));
    var activeButton = buttons[activeIndex] || buttons[0];
    var rect = activeButton.getBoundingClientRect();
    seg.style.setProperty('--lang-pos', String(activeIndex));
    seg.style.setProperty('--lang-x', (rect.left - originX).toFixed(2) + 'px');
    seg.style.setProperty('--lang-w', rect.width.toFixed(2) + 'px');
    buttons.forEach(function (button, index) {
      var selected = button.dataset.lang === state.uiLang;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function renderLangSeg() {
    var seg = $('ui-lang-seg');
    if (!seg) return;
    if (!seg.querySelector('.lang-thumb')) {
      seg.insertAdjacentHTML('afterbegin', '<span class="lang-thumb" aria-hidden="true"></span>');
    }
    seg.querySelectorAll('button[data-lang]').forEach(function (button) { button.remove(); });
    seg.insertAdjacentHTML('beforeend', UI_LANG_ORDER.map(function (lang) {
      var selected = state.uiLang === lang;
      return '<button type="button" data-lang="' + lang + '" class="' + (selected ? 'active' : '') + '"'
        + ' aria-pressed="' + (selected ? 'true' : 'false') + '">' + esc(UI_LANG_LABELS[lang] || lang) + '</button>';
    }).join(''));
    seg.querySelectorAll('button[data-lang]').forEach(function (button) {
      button.addEventListener('click', function () { selectUiLang(button.dataset.lang); });
    });
    requestAnimationFrame(paintLangThumb);
  }

  function selectUiLang(lang) {
    if (UI_LANG_ORDER.indexOf(lang) < 0) return;
    state.uiLang = lang;
    persist(true);
    applyI18n();
    renderHeader();
    renderNav();
    renderLangSeg();
    renderFooter();
    syncPairLabels();
    updateFavoriteButton();
    if (els.viewConversation && !els.viewConversation.hidden) renderConversation();
    var status = $('tr-status');
    if (status && !status.textContent) status.textContent = t('trAutoHint');
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (node) {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-ph')));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (node) {
      var value = t(node.getAttribute('data-i18n-aria'));
      node.setAttribute('aria-label', value);
      node.setAttribute('title', value);
    });
  }

  function renderFooter() {
    var foot = $('site-foot');
    if (!foot) return;
    foot.innerHTML = '<p>' + esc(t('footerNote')) + ' · <a href="index.html">' + esc(t('footerHome')) + '</a></p>';
  }

  function updateCount() {
    var counter = $('tr-count');
    if (!counter || !els.source) return;
    counter.textContent = t('trChars', { n: els.source.value.length });
  }

  function syncPairLabels() {
    if (!els.from || !els.to) return;
    var from = els.from.value;
    var to = els.to.value;
    if (els.sourceLabel) els.sourceLabel.textContent = t('lang_' + from);
    if (els.targetLabel) els.targetLabel.textContent = t('lang_' + to);
    if (els.source) els.source.setAttribute('aria-label', t('trSourceLang') + ': ' + t('lang_' + from));
    if (els.target) els.target.setAttribute('aria-label', t('trTargetLang') + ': ' + t('lang_' + to));
    if (els.from) els.from.setAttribute('aria-label', t('trSourceLang'));
    if (els.to) els.to.setAttribute('aria-label', t('trTargetLang'));
    updateCount();
  }

  function clearError() {
    if (!els.error) return;
    els.error.hidden = true;
    els.error.textContent = '';
  }

  function showError(message) {
    if (!els.error) return;
    els.error.hidden = false;
    els.error.textContent = message;
    if (els.status) els.status.textContent = t('trFailed');
  }

  function setBusy(busy) {
    if (!els.translateBtn) return;
    els.translateBtn.disabled = !!busy;
    els.translateBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function showRoma(roma) {
    lastRoma = typeof roma === 'string' ? roma.trim() : '';
    if (!els.roma) return;
    if (lastRoma) {
      els.roma.hidden = false;
      els.roma.textContent = t('trRoma') + ': ' + lastRoma;
    } else {
      els.roma.hidden = true;
      els.roma.textContent = '';
    }
  }

  async function translateText(payload) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (activeAbort && activeAbort.abort) activeAbort.abort();
    activeAbort = controller;
    var options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.text,
        from: payload.from,
        to: payload.to,
        honorific: !!payload.honorific,
        profile: state.translateSetup || null
      })
    };
    if (controller) options.signal = controller.signal;
    var response;
    try {
      response = await fetch(translateEndpoint(), options);
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      var network = new Error(t('trNetworkError'));
      network.cause = error;
      throw network;
    }
    if (!response.ok) {
      var detail = '';
      try {
        var failure = await response.json();
        if (failure && typeof failure.error === 'string') detail = failure.error;
      } catch (error) { /* non-JSON error body */ }
      throw new Error(detail || ('HTTP ' + response.status));
    }
    var data = await response.json().catch(function () { return null; });
    var text = data && (data.text || data.translation);
    if (typeof text !== 'string' || !text.trim()) throw new Error(t('trEmptyResult'));
    return {
      text: text,
      roma: data && typeof data.roma === 'string' ? data.roma : ''
    };
  }

  async function runTranslation() {
    clearTimeout(autoTimer);
    autoTimer = 0;
    if (!els.source || !els.target) return;
    var text = els.source.value.trim();
    if (!text) {
      els.target.value = '';
      showRoma('');
      clearError();
      if (els.status) els.status.textContent = t('trAutoHint');
      updateFavoriteButton();
      return;
    }
    var from = els.from.value || 'zh';
    var to = els.to.value || 'ko';
    if (from === to) {
      els.target.value = text;
      showRoma('');
      clearError();
      if (els.status) els.status.textContent = t('trDone');
      updateFavoriteButton();
      return;
    }
    var seq = ++requestSeq;
    clearError();
    setBusy(true);
    if (els.status) els.status.textContent = t('trTranslating');
    try {
      var result = await translateText({
        text: text,
        from: from,
        to: to,
        honorific: !!(els.honorific && els.honorific.checked)
      });
      if (seq !== requestSeq) return;
      els.target.value = result.text;
      showRoma(result.roma);
      if (els.status) els.status.textContent = t('trDone');
      updateFavoriteButton();
    } catch (error) {
      if (seq !== requestSeq || (error && error.name === 'AbortError')) return;
      els.target.value = '';
      showRoma('');
      var detail = error && error.message ? error.message : t('trNetworkError');
      showError(t('trFailed') + ': ' + detail);
      updateFavoriteButton();
    } finally {
      if (seq === requestSeq) setBusy(false);
    }
  }

  function scheduleTranslation() {
    clearTimeout(autoTimer);
    var text = els.source ? els.source.value.trim() : '';
    if (!text) {
      if (els.target) els.target.value = '';
      showRoma('');
      clearError();
      if (els.status) els.status.textContent = t('trAutoHint');
      updateFavoriteButton();
      return;
    }
    if (els.status) els.status.textContent = t('trAutoHint');
    autoTimer = setTimeout(function () { runTranslation(); }, DEBOUNCE_MS);
  }

  function swapTexts() {
    if (!els.from || !els.to) return;
    var from = els.from.value;
    var to = els.to.value;
    var source = els.source.value;
    var target = els.target.value;
    els.from.value = to;
    els.to.value = from;
    els.source.value = target;
    els.target.value = source;
    clearTimeout(autoTimer);
    autoTimer = 0;
    showRoma('');
    clearError();
    if (els.status) els.status.textContent = t('trAutoHint');
    syncPairLabels();
    updateFavoriteButton();
  }

  async function copyValue(text) {
    var value = String(text || '');
    if (!value) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error('clipboard unavailable');
      }
      toast(t('trCopied'));
    } catch (error) {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        if (document.execCommand('copy')) toast(t('trCopied'));
        else toast(t('trCopyFail'));
      } catch (copyError) {
        toast(t('trCopyFail'));
      }
      document.body.removeChild(area);
    }
  }

  function speakValue(text, lang) {
    var value = String(text || '').trim();
    if (!value) return;
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      toast(t('trNoSpeech'));
      return;
    }
    var map = { ko: 'ko-KR', zh: 'zh-CN', en: 'en-US' };
    try {
      window.speechSynthesis.cancel();
      var utterance = new SpeechSynthesisUtterance(value);
      utterance.lang = map[lang] || 'ko-KR';
      utterance.rate = 0.9;
      utterance.pitch = 1;
      var voice = (window.speechSynthesis.getVoices() || []).find(function (item) {
        return String(item.lang || '').toLowerCase().indexOf(String(utterance.lang).slice(0, 2).toLowerCase()) === 0;
      });
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      toast(t('trNoSpeech'));
    }
  }

  function favoriteIndexFor(sourceText, targetText, from, to) {
    return (state.translateFavorites || []).findIndex(function (item) {
      return item && item.original === sourceText && item.translation === targetText
        && item.from === from && item.to === to;
    });
  }

  function updateFavoriteButton() {
    if (!els.favBtn || !els.source || !els.target) return;
    var active = favoriteIndexFor(els.source.value.trim(), els.target.value.trim(), els.from.value, els.to.value) >= 0;
    els.favBtn.classList.toggle('active', active);
    els.favBtn.textContent = (active ? '★ ' : '☆ ') + t(active ? 'trUnfav' : 'trFav');
  }

  function toggleFavoriteCurrent() {
    if (!els.source || !els.target) return;
    var original = els.source.value.trim();
    var translation = els.target.value.trim();
    if (!original || !translation) {
      toast(t('trSourceEmpty'));
      return;
    }
    var from = els.from.value;
    var to = els.to.value;
    var index = favoriteIndexFor(original, translation, from, to);
    if (index >= 0) {
      state.translateFavorites.splice(index, 1);
    } else {
      state.translateFavorites.push({
        id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        sourceId: '',
        original: original,
        translation: translation,
        roma: lastRoma,
        from: from,
        to: to,
        honorific: !!(els.honorific && els.honorific.checked),
        at: new Date().toISOString()
      });
      toast(t('trFavSaved'));
    }
    persist();
    updateFavoriteButton();
  }

  function langOptions(selected) {
    return LANGS.map(function (lang) {
      return '<option value="' + lang + '"' + (lang === selected ? ' selected' : '') + '>'
        + esc(t('lang_' + lang)) + '</option>';
    }).join('');
  }

  function convCardHTML(card, sideKey) {
    var translationClass = 'conv-trans' + (card.pending ? ' pending' : '') + (card.error ? ' failed' : '');
    var translation = card.error ? t('trFailed') : (card.translation || t('trTranslating'));
    var favorite = false;
    try {
      favorite = (state.translateFavorites || []).some(function (item) { return item && item.sourceId === card.id; });
    } catch (error) { /* ignore */ }
    return '<div class="conv-card" data-card="' + esc(card.id) + '">'
      + '<div class="conv-meta">' + esc(t('trOriginal')) + ' · ' + esc(t('lang_' + card.from)) + '</div>'
      + '<div class="conv-orig">' + esc(card.original) + '</div>'
      + (card.roma ? '<div class="conv-meta">' + esc(t('trRoma')) + ': ' + esc(card.roma) + '</div>' : '')
      + '<div class="conv-meta">' + esc(t('trTranslation')) + ' · ' + esc(t('lang_' + card.to)) + '</div>'
      + '<div class="' + translationClass + '">' + esc(translation) + '</div>'
      + '<div class="conv-actions">'
      + '<button type="button" class="tr-mini" data-act="speak" data-text="' + esc(card.original) + '" data-lang="' + esc(card.from) + '">🔊 ' + esc(t('trSpeak')) + '</button>'
      + '<button type="button" class="tr-mini" data-act="copy" data-text="' + esc(card.translation || '') + '">' + esc(t('trCopy')) + '</button>'
      + '<button type="button" class="tr-mini' + (favorite ? ' active' : '') + '" data-act="fav" data-side="' + esc(sideKey || '') + '" data-id="' + esc(card.id) + '">'
      + (favorite ? '★ ' : '☆ ') + esc(t(favorite ? 'trUnfav' : 'trFav')) + '</button>'
      + '<button type="button" class="tr-mini' + (card.honorific ? ' active' : '') + '" data-act="hon" data-side="' + esc(sideKey || '') + '" data-id="' + esc(card.id) + '">'
      + esc(t('trHonorific')) + ': ' + esc(card.honorific ? t('trHonorificOn') : t('trHonorificOff')) + '</button>'
      + '</div></div>';
  }

  function convSideHTML(key) {
    var side = state.translateSides[key];
    var cards = (side.utterances || []).slice(-30).map(function (card) {
      return convCardHTML(card, key);
    }).join('');
    return '<div class="conv-side" data-side="' + key + '">'
      + '<div class="conv-side-head"><strong>' + esc(t(key === 'a' ? 'trSideA' : 'trSideB')) + '</strong>'
      + '<button type="button" class="tr-mini" data-act="clear" data-side="' + key + '">' + esc(t('trClearFeed')) + '</button></div>'
      + '<div class="conv-langs">'
      + '<select data-act="lang" data-side="' + key + '" aria-label="' + esc(t('trSourceLang')) + '">' + langOptions(side.lang) + '</select>'
      + '<span class="arrow" aria-hidden="true">→</span>'
      + '<select data-act="other" data-side="' + key + '" aria-label="' + esc(t('trTargetLang')) + '">' + langOptions(side.other) + '</select>'
      + '</div>'
      + '<textarea id="conv-input-' + key + '" data-conv-input="' + key + '" spellcheck="false" placeholder="' + esc(t('trTypePh')) + '">' + esc(convDrafts[key] || '') + '</textarea>'
      + '<div class="conv-actions"><button type="button" class="btn" data-act="send" data-side="' + key + '">' + esc(t('trSend')) + '</button></div>'
      + '<div class="conv-feed" id="conv-feed-' + key + '">'
      + (cards || '<div class="conv-empty">' + esc(t('trEmptyFeed')) + '</div>')
      + '</div></div>';
  }

  function renderConversation() {
    var mount = $('conv-mount');
    if (!mount) return;
    ['a', 'b'].forEach(function (key) {
      var field = $('conv-input-' + key);
      if (field) convDrafts[key] = field.value;
    });
    mount.innerHTML = '<div class="tr-conv-grid">' + convSideHTML('a') + convSideHTML('b') + '</div>';
    mount.querySelectorAll('[data-conv-input]').forEach(function (field) {
      field.addEventListener('input', function () { convDrafts[field.dataset.convInput] = field.value; });
    });
  }

  function findConversationCard(sideKey, id) {
    var side = state.translateSides[sideKey];
    if (!side) return null;
    return (side.utterances || []).find(function (card) { return card.id === id; }) || null;
  }

  async function sendConversation(sideKey) {
    var field = $('conv-input-' + sideKey);
    if (!field) return;
    var text = field.value.trim();
    if (!text) return;
    var side = state.translateSides[sideKey];
    var card = {
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      original: text,
      translation: '',
      pending: true,
      error: false,
      from: side.lang,
      to: side.other,
      honorific: true,
      roma: '',
      at: new Date().toISOString()
    };
    side.utterances.push(card);
    convDrafts[sideKey] = '';
    persist();
    renderConversation();
    try {
      var result = await translateText({
        text: text,
        from: card.from,
        to: card.to,
        honorific: card.honorific
      });
      card.translation = result.text;
      card.roma = result.roma || '';
      card.pending = false;
      card.error = false;
    } catch (error) {
      card.translation = '';
      card.pending = false;
      card.error = true;
    }
    persist();
    renderConversation();
  }

  async function retranslateConversation(sideKey, id) {
    var card = findConversationCard(sideKey, id);
    if (!card) return;
    card.pending = true;
    card.error = false;
    persist();
    renderConversation();
    try {
      var result = await translateText({
        text: card.original,
        from: card.from,
        to: card.to,
        honorific: card.honorific
      });
      card.translation = result.text;
      card.roma = result.roma || '';
      card.pending = false;
      card.error = false;
    } catch (error) {
      card.pending = false;
      card.error = true;
    }
    persist();
    renderConversation();
  }

  function bindConversation() {
    var mount = $('conv-mount');
    if (!mount) return;
    mount.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('button[data-act]') : null;
      if (!button) return;
      var action = button.dataset.act;
      var sideKey = button.dataset.side;
      if (action === 'send') {
        sendConversation(sideKey);
      } else if (action === 'clear') {
        state.translateSides[sideKey].utterances = [];
        persist();
        renderConversation();
      } else if (action === 'speak') {
        speakValue(button.dataset.text, button.dataset.lang || 'ko');
      } else if (action === 'copy') {
        copyValue(button.dataset.text);
      } else if (action === 'fav') {
        toggleConversationFavorite(sideKey, button.dataset.id);
      } else if (action === 'hon') {
        var card = findConversationCard(sideKey, button.dataset.id);
        if (!card) return;
        card.honorific = !card.honorific;
        persist();
        retranslateConversation(sideKey, card.id);
      }
    });
    mount.addEventListener('change', function (event) {
      var select = event.target.closest ? event.target.closest('select[data-act]') : null;
      if (!select) return;
      var side = state.translateSides[select.dataset.side];
      if (!side) return;
      if (select.dataset.act === 'lang') side.lang = select.value;
      else if (select.dataset.act === 'other') side.other = select.value;
      persist();
      renderConversation();
    });
  }

  function toggleConversationFavorite(sideKey, id) {
    var card = findConversationCard(sideKey, id);
    if (!card) return;
    var index = (state.translateFavorites || []).findIndex(function (item) {
      return item && (item.sourceId === card.id || item.id === card.id);
    });
    if (index >= 0) {
      state.translateFavorites.splice(index, 1);
    } else {
      state.translateFavorites.push({
        id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        sourceId: card.id,
        original: card.original,
        translation: card.translation,
        roma: card.roma,
        from: card.from,
        to: card.to,
        honorific: card.honorific,
        at: new Date().toISOString()
      });
      toast(t('trFavSaved'));
    }
    persist();
    renderConversation();
  }

  function setTab(name) {
    var conversation = name === 'conversation';
    if (els.tabTranslator) {
      els.tabTranslator.classList.toggle('active', !conversation);
      els.tabTranslator.setAttribute('aria-selected', conversation ? 'false' : 'true');
    }
    if (els.tabConversation) {
      els.tabConversation.classList.toggle('active', conversation);
      els.tabConversation.setAttribute('aria-selected', conversation ? 'true' : 'false');
    }
    if (els.viewTranslator) els.viewTranslator.hidden = conversation;
    if (els.viewConversation) els.viewConversation.hidden = !conversation;
    if (conversation) {
      renderConversation();
    } else {
      clearTimeout(autoTimer);
      autoTimer = 0;
      if (activeAbort && activeAbort.abort) activeAbort.abort();
    }
  }

  function bindTranslator() {
    if (els.source) {
      els.source.addEventListener('input', function () {
        updateCount();
        clearError();
        scheduleTranslation();
      });
      els.source.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          runTranslation();
        }
      });
    }
    if (els.translateBtn) {
      els.translateBtn.addEventListener('click', function () { runTranslation(); });
    }
    if (els.swap) els.swap.addEventListener('click', swapTexts);
    if (els.from) {
      els.from.addEventListener('change', function () {
        syncPairLabels();
        scheduleTranslation();
      });
    }
    if (els.to) {
      els.to.addEventListener('change', function () {
        syncPairLabels();
        scheduleTranslation();
      });
    }
    if (els.honorific) {
      els.honorific.addEventListener('change', function () {
        if (els.source && els.source.value.trim()) scheduleTranslation();
      });
    }
    if (els.clearBtn) {
      els.clearBtn.addEventListener('click', function () {
        els.source.value = '';
        els.target.value = '';
        showRoma('');
        clearError();
        updateCount();
        updateFavoriteButton();
        if (els.status) els.status.textContent = t('trAutoHint');
      });
    }
    if (els.copySource) els.copySource.addEventListener('click', function () { copyValue(els.source.value); });
    if (els.copyTarget) els.copyTarget.addEventListener('click', function () { copyValue(els.target.value); });
    if (els.speakSource) els.speakSource.addEventListener('click', function () { speakValue(els.source.value, els.from.value); });
    if (els.speakTarget) els.speakTarget.addEventListener('click', function () { speakValue(els.target.value, els.to.value); });
    if (els.favBtn) els.favBtn.addEventListener('click', toggleFavoriteCurrent);
    if (els.tabTranslator) els.tabTranslator.addEventListener('click', function () { setTab('translator'); });
    if (els.tabConversation) els.tabConversation.addEventListener('click', function () { setTab('conversation'); });
  }

  function cacheElements() {
    els = {
      source: $('tr-source'),
      target: $('tr-target'),
      from: $('tr-from'),
      to: $('tr-to'),
      honorific: $('tr-honorific'),
      translateBtn: $('tr-translate-btn'),
      swap: $('tr-swap'),
      clearBtn: $('tr-clear'),
      copySource: $('tr-copy-source'),
      copyTarget: $('tr-copy-target'),
      speakSource: $('tr-speak-source'),
      speakTarget: $('tr-speak-target'),
      favBtn: $('tr-fav-target'),
      status: $('tr-status'),
      error: $('tr-error'),
      roma: $('tr-roma'),
      sourceLabel: $('tr-source-label'),
      targetLabel: $('tr-target-label'),
      tabTranslator: $('tab-translator'),
      tabConversation: $('tab-conversation'),
      viewTranslator: $('view-translator'),
      viewConversation: $('view-conversation')
    };
  }

  function init() {
    cacheElements();
    applyI18n();
    renderHeader();
    renderNav();
    renderLangSeg();
    renderFooter();
    syncPairLabels();
    if (els.source) {
      els.source.value = '';
      updateCount();
    }
    if (els.target) els.target.value = '';
    if (els.status) els.status.textContent = t('trAutoHint');
    updateFavoriteButton();
    bindTranslator();
    bindConversation();
    renderConversation();
    setTab(location.hash === '#conversation' ? 'conversation' : 'translator');

    var toggle = $('nav-toggle');
    var backdrop = $('nav-backdrop');
    if (toggle) toggle.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    if (backdrop) backdrop.addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    window.addEventListener('resize', function () { requestAnimationFrame(paintLangThumb); }, { passive: true });
    window.addEventListener('koreansthemechange', function () { requestAnimationFrame(paintLangThumb); });
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { requestAnimationFrame(paintLangThumb); }).catch(function () {});
    }
    requestAnimationFrame(paintLangThumb);

    window.__translatePage = {
      getState: function () { return state; },
      endpoint: translateEndpoint,
      runTranslation: runTranslation,
      swap: swapTexts,
      t: t
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
