// Web-only third-party embeds: Google Analytics (gtag.js) and the GetTerms
// cookie/terms widget. Moved out of index.html so that:
//   1. the desktop shell never loads remote scripts into the renderer — they
//      would run with the same access to window.electronAPI (SQLite IPC) as the
//      app itself; the desktop CSP (script-src 'self') would block them anyway;
//   2. index.html has no inline scripts, which the CSP would also block.
// window.electronAPI is exposed by the preload before any page script runs, so
// its presence is a reliable "inside Electron" signal here.
(function () {
  if (window.electronAPI) return;

  // --- Google tag (gtag.js) ---------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-5Q1VS7MNJ9');
  var ga = document.createElement('script');
  ga.async = true;
  ga.src = 'https://www.googletagmanager.com/gtag/js?id=G-5Q1VS7MNJ9';
  document.head.appendChild(ga);

  // --- GetTerms embed ---------------------------------------------------------
  function loadGetTerms() {
    if (document.getElementById('getterms-embed-js')) return;
    var js = document.createElement('script');
    js.id = 'getterms-embed-js';
    js.src = 'https://app.getterms.io/dist/js/embed.js';
    document.body.appendChild(js);
  }
  if (document.body) loadGetTerms();
  else document.addEventListener('DOMContentLoaded', loadGetTerms);
})();
