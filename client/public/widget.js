/* CeramicBot floating chat widget — embed on any site:
 *   <script src="https://your-host/widget.js" data-client="demo" defer></script>
 *
 * Injects a floating button (bottom-right) that opens an iframe with the
 * CeramicBot chat. Reads optional branding from /api/public/widget-config.
 */
(function () {
  if (window !== window.top) return; // never run inside our own iframe

  var scriptTag =
    document.currentScript || document.querySelector('script[src*="widget.js"]');

  var WIDGET_BASE = "";
  if (scriptTag && scriptTag.src) {
    try {
      WIDGET_BASE = new URL(scriptTag.src).origin;
    } catch (e) {
      WIDGET_BASE = window.location.origin;
    }
  } else {
    WIDGET_BASE = window.location.origin;
  }

  // data-client identifies the tenant (slug). Optional in single-tenant mode.
  var clientSlug = scriptTag && scriptTag.getAttribute("data-client");

  var CHAT_URL = WIDGET_BASE + "/chat";
  if (clientSlug) {
    CHAT_URL += "?client=" + encodeURIComponent(clientSlug);
  }

  function luminance(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function init() {
    if (document.getElementById("ceramicbot-widget-container")) return;

    var widgetColor = "#e85d04"; // Aurex coral default

    // Best-effort fetch of branding before mounting (synchronous XHR keeps
    // the script tag tiny — it's a 1-off ~50 ms call on page load).
    try {
      var configUrl = WIDGET_BASE + "/api/public/widget-config";
      if (clientSlug) configUrl += "?client=" + encodeURIComponent(clientSlug);
      var xhr = new XMLHttpRequest();
      xhr.open("GET", configUrl, false);
      xhr.send();
      if (xhr.status === 200) {
        var config = JSON.parse(xhr.responseText);
        if (config.color) widgetColor = config.color;
      }
    } catch (e) {
      /* keep default */
    }

    var textColor = luminance(widgetColor) > 0.5 ? "#000000" : "#ffffff";

    var container = document.createElement("div");
    container.id = "ceramicbot-widget-container";

    var style = document.createElement("style");
    style.textContent = [
      "#ceramicbot-widget-button {",
      "  position: fixed;",
      "  bottom: 24px;",
      "  right: 24px;",
      "  width: 60px;",
      "  height: 60px;",
      "  border-radius: 50%;",
      "  background: " + widgetColor + ";",
      "  border: 2px solid rgba(255,255,255,0.3);",
      "  cursor: pointer;",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  box-shadow: 0 4px 14px " + widgetColor + "66, 0 0 0 3px " + widgetColor + "26;",
      "  z-index: 2147483646;",
      "  transition: transform 0.2s ease, box-shadow 0.2s ease;",
      "  padding: 0;",
      "  outline: none;",
      "}",
      "#ceramicbot-widget-button:hover {",
      "  transform: scale(1.08);",
      "  box-shadow: 0 6px 20px " + widgetColor + "80, 0 0 0 3px " + widgetColor + "33;",
      "}",
      "#ceramicbot-widget-button svg {",
      "  width: 28px;",
      "  height: 28px;",
      "  fill: " + textColor + ";",
      "  pointer-events: none;",
      "}",
      "#ceramicbot-widget-backdrop {",
      "  position: fixed;",
      "  top: 0;",
      "  left: 0;",
      "  width: 100%;",
      "  height: 100%;",
      "  background: rgba(0, 0, 0, 0.25);",
      "  z-index: 2147483646;",
      "  display: none;",
      "}",
      "#ceramicbot-widget-iframe-wrap {",
      "  position: fixed;",
      "  bottom: 24px;",
      "  right: 24px;",
      "  width: 400px;",
      "  height: 620px;",
      "  z-index: 2147483647;",
      "  display: none;",
      "  border-radius: 16px;",
      "  overflow: hidden;",
      "  border: 1px solid rgba(0, 0, 0, 0.12);",
      "  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.35), 0 10px 20px rgba(0, 0, 0, 0.2);",
      "  background: #ffffff;",
      "}",
      "#ceramicbot-widget-close {",
      "  position: absolute;",
      "  top: 8px;",
      "  right: 8px;",
      "  width: 28px;",
      "  height: 28px;",
      "  border-radius: 50%;",
      "  background: rgba(0,0,0,0.4);",
      "  color: #fff;",
      "  border: none;",
      "  cursor: pointer;",
      "  font-size: 18px;",
      "  line-height: 1;",
      "  z-index: 1;",
      "}",
      "#ceramicbot-widget-iframe {",
      "  width: 100%;",
      "  height: 100%;",
      "  border: none;",
      "  background: #ffffff;",
      "}",
      "@media (max-width: 480px) {",
      "  #ceramicbot-widget-iframe-wrap {",
      "    width: 100%;",
      "    height: 100%;",
      "    bottom: 0;",
      "    right: 0;",
      "    border-radius: 0;",
      "  }",
      "  #ceramicbot-widget-backdrop { display: none !important; }",
      "}",
    ].join("\n");

    var backdrop = document.createElement("div");
    backdrop.id = "ceramicbot-widget-backdrop";

    var button = document.createElement("button");
    button.id = "ceramicbot-widget-button";
    button.setAttribute("aria-label", "Open chat");
    // Speech-bubble icon
    button.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';

    var iframeWrap = document.createElement("div");
    iframeWrap.id = "ceramicbot-widget-iframe-wrap";

    var closeBtn = document.createElement("button");
    closeBtn.id = "ceramicbot-widget-close";
    closeBtn.setAttribute("aria-label", "Close chat");
    closeBtn.innerHTML = "&times;";

    var iframe = document.createElement("iframe");
    iframe.id = "ceramicbot-widget-iframe";
    iframe.title = "CeramicBot Chat";
    iframe.src = CHAT_URL;

    iframeWrap.appendChild(closeBtn);
    iframeWrap.appendChild(iframe);

    container.appendChild(style);
    container.appendChild(backdrop);
    container.appendChild(button);
    container.appendChild(iframeWrap);

    document.body.appendChild(container);

    var isOpen = false;

    function open() {
      if (isOpen) return;
      isOpen = true;
      button.style.display = "none";
      backdrop.style.display = "block";
      iframeWrap.style.display = "block";
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      button.style.display = "flex";
      backdrop.style.display = "none";
      iframeWrap.style.display = "none";
    }

    button.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", close);

    // Allow the embedded chat to ask its parent to close.
    window.addEventListener("message", function (event) {
      if (event.data && event.data.type === "ceramicbot-close") close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
