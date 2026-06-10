// OTAKULT shared navigation component
// Usage: add <script src="/components/nav.js"></script> in <head>,
//        then place <otakult-nav></otakult-nav> at the top of <body>.
// Auto-detects active page from window.location.pathname.

(function () {
  const STYLE_ID = 'otakult-nav-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '@keyframes wobble{0%,100%{transform:rotate(-2deg);}50%{transform:rotate(2deg);}}',
      '@keyframes marquee{from{transform:translateX(0);}to{transform:translateX(-50%);}}',
      '.animate-marquee{animation:marquee 30s linear infinite;}',
      '.animate-wobble{animation:wobble 2.5s ease-in-out infinite;}',

      // Header shell
      'header{position:sticky;top:0;z-index:50;',
      '  border-top:3px solid var(--ink);border-left:3px solid var(--ink);border-right:3px solid var(--ink);',
      '  box-shadow:-3px 0 0 0 var(--ink),3px 0 0 0 var(--ink),0 -3px 0 0 var(--ink);',
      '  background:rgba(251,245,223,0.95);backdrop-filter:blur(8px);}',

      // Nav structure
      '.nav-inner{max-width:1280px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:12px 24px;}',
      '.nav-logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--ink);}',
      '.logo-badge{width:40px;height:40px;border-radius:50%;background:var(--hot);color:#fff;',
      '  display:grid;place-items:center;font-family:var(--font-display);font-size:20px;',
      '  border:3px solid var(--ink);animation:wobble 2.5s ease-in-out infinite;}',
      '.logo-text{font-family:var(--font-display);font-size:24px;letter-spacing:-.025em;}',
      '.logo-text .dot{color:var(--hot);}',
      '.nav-links{display:flex;align-items:center;gap:8px;}',

      // Nav links — interior-page defaults (no border on all links)
      '.nav-link{font-family:var(--font-display);font-size:14px;padding:6px 12px;',
      '  text-decoration:none;color:var(--ink);transition:background .1s;}',
      '.nav-link:hover{background:var(--acid);}',
      '.nav-link.active{background:var(--acid);border:3px solid var(--ink);}',

      // CTA — interior default (ink bg)
      '.nav-cta{font-family:var(--font-display);font-size:14px;padding:8px 16px;',
      '  text-decoration:none;background:var(--ink);color:var(--cream);',
      '  border:3px solid var(--ink);box-shadow:4px 4px 0 0 var(--hot);transition:background .1s;}',
      '.nav-cta:hover{background:var(--hot);}',

      // Home-page overrides: border on ALL links, hot CTA
      'header[data-page="home"] .nav-link{border:3px solid var(--ink);}',
      'header[data-page="home"] .nav-link:hover,',
      'header[data-page="home"] .nav-link.active{background:var(--acid);}',
      'header[data-page="home"] .nav-cta{background:var(--hot);color:#fff;box-shadow:4px 4px 0 0 var(--ink);}',
      'header[data-page="home"] .nav-cta:hover{background:var(--acid);color:var(--ink);}',

      // Marquee
      '.marquee-bar{overflow:hidden;background:var(--ink);border-top:3px solid var(--ink);padding:6px 0;}',
      '.marquee-track{display:flex;width:max-content;animation:marquee 30s linear infinite;}',
      '.marquee-item{font-family:var(--font-display);font-size:11px;color:var(--cream);',
      '  letter-spacing:.15em;padding:0 24px;white-space:nowrap;}',
      '.marquee-item .sep{color:var(--hot);}',

      // Responsive
      '@media(max-width:600px){.nav-link.hidden-sm{display:none;}}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // Build a single marquee item, optionally with an id (for dynamic ticker population)
  function mi(text, id) {
    var idAttr = id ? ' id="' + id + '"' : '';
    return '<span class="marquee-item"' + idAttr + '>' + text + ' <span class="sep">✦</span></span>';
  }

  function buildMarquee(page) {
    var half, half2;
    if (page === 'home') {
      // Home marquee has 4 dynamic ticker slots populated by index.html's JS
      half = [
        mi('NO FILLER'),
        mi('♥', 'ticker-hot-1'),
        mi('SWIPE YOUR TASTE CLUSTERS'),
        mi('NOW STREAMING', 'ticker-airing-1'),
        mi('JOIN THE CULT'),
        mi('BUILT AT 2AM OUT OF SPITE'),
      ].join('');
      half2 = [
        mi('NO FILLER'),
        mi('♥', 'ticker-hot-2'),
        mi('SWIPE YOUR TASTE CLUSTERS'),
        mi('NOW STREAMING', 'ticker-airing-2'),
        mi('JOIN THE CULT'),
        mi('BUILT AT 2AM OUT OF SPITE'),
      ].join('');
      return half + half2;
    }
    if (page === 'browse') {
      half = [
        mi('17,000+ ANIME AND COUNTING'),
        mi('EVERY SHOW HAS A PAGE'),
        mi('SWIPE YOUR TASTE CLUSTERS'),
        mi('BUILT BY A DISGRUNTLED FAN'),
        mi('JOIN THE CULT'),
      ].join('');
      return half + half;
    }
    // slug / default
    half = [
      mi('17,000+ ANIME AND COUNTING'),
      mi('TASTE-MATCHED IN 60 SECONDS'),
      mi('JOIN THE CULT'),
      mi('BUILT BY A DISGRUNTLED FAN'),
    ].join('');
    return half + half;
  }

  class OtakultNav extends HTMLElement {
    connectedCallback() {
      injectStyles();

      var path      = window.location.pathname;
      var isHome    = (path === '/' || path === '/index.html');
      var isDir     = (path === '/browse' || path === '/browse/');
      var page      = isHome ? 'home' : (isDir ? 'browse' : 'slug');

      var ctaText   = isHome ? 'SWIPE →' : 'GET THE APP →';
      var homeClass = 'nav-link' + (isHome ? ' active hidden-sm' : '');
      var dirClass  = 'nav-link' + (isDir  ? ' active' : '');

      var header = document.createElement('header');
      if (isHome) header.dataset.page = 'home';

      header.innerHTML =
        '\n  <div class="nav-inner">' +
        '\n    <a href="/" class="nav-logo">' +
        '\n      <div class="logo-badge">O!</div>' +
        '\n      <span class="logo-text">OTAKULT<span class="dot">.</span></span>' +
        '\n    </a>' +
        '\n    <nav class="nav-links">' +
        '\n      <a href="/"       class="' + homeClass + '">HOME</a>' +
        '\n      <a href="/browse" class="' + dirClass  + '">DIRECTORY</a>' +
        '\n      <a href="/discover" class="nav-cta">' + ctaText + '</a>' +
        '\n    </nav>' +
        '\n  </div>' +
        '\n  <div class="marquee-bar">' +
        '\n    <div class="marquee-track">' +
        '\n      ' + buildMarquee(page) +
        '\n    </div>' +
        '\n  </div>\n';

      this.replaceWith(header);
    }
  }

  customElements.define('otakult-nav', OtakultNav);
})();
