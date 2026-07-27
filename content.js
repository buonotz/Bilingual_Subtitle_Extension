(() => {
  "use strict";

  if (window.top !== window || window.__nbsLoaded) return;
  window.__nbsLoaded = true;

  const STORAGE_KEY = "nbsSecondaryLanguage";
  const FALLBACK_LANGUAGES = [
    ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"], ["en", "English"],
    ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"],
    ["it", "Italiano"], ["ja", "日本語"], ["ko", "한국어"],
    ["pt", "Português"], ["ru", "Русский"], ["ar", "العربية"],
    ["hi", "हिन्दी"], ["th", "ไทย"], ["vi", "Tiếng Việt"],
    ["id", "Bahasa Indonesia"], ["tr", "Türkçe"], ["pl", "Polski"],
    ["nl", "Nederlands"], ["sv", "Svenska"], ["da", "Dansk"],
    ["no", "Norsk"], ["fi", "Suomi"]
  ];
  const tracks = new Map();
  let selectedLanguage = "";
  let activeTrackId = "";
  let lastText = "";
  let panel;
  let subtitle;
  let select;
  let status;
  let video;
  let menuDiscoveryRunning = false;
  let lastMenuSignature = "";

  const normalize = (value) => String(value || "").trim().toLowerCase().replace("_", "-");

  function createUi() {
    if (panel?.isConnected) return;

    panel = document.createElement("div");
    panel.id = "nbs-panel";
    panel.innerHTML = `
      <button id="nbs-toggle" type="button" aria-label="设置第二字幕">双语字幕</button>
      <div id="nbs-menu" hidden>
        <label for="nbs-language">第二字幕</label>
        <select id="nbs-language">
          <option value="">自动选择</option>
        </select>
        <div id="nbs-status">正在等待 Netflix 字幕…</div>
      </div>`;

    subtitle = document.createElement("div");
    subtitle.id = "nbs-subtitle";
    subtitle.setAttribute("aria-live", "off");

    document.documentElement.append(panel, subtitle);
    select = panel.querySelector("#nbs-language");
    status = panel.querySelector("#nbs-status");

    panel.querySelector("#nbs-toggle").addEventListener("click", () => {
      const menu = panel.querySelector("#nbs-menu");
      menu.hidden = !menu.hidden;
      if (!menu.hidden) discoverNetflixTracks();
    });

    select.addEventListener("change", async () => {
      selectedLanguage = select.value;
      activeTrackId = "";
      chrome.storage.local.set({ [STORAGE_KEY]: selectedLanguage });
      if (selectedLanguage) {
        const capture = await chrome.runtime.sendMessage({
          type: "nbs-start-capture",
          language: selectedLanguage
        }).catch((error) => ({ ok: false, error: error.message }));
        if (!capture?.ok) {
          status.textContent = `无法捕获字幕网络响应：${capture?.error || "未知错误"}`;
          return;
        }
        window.postMessage({
          source: "netflix-bilingual-subtitles-content",
          type: "load-language",
          language: selectedLanguage
        }, "*");
        status.textContent = "正在加载所选官方字幕…";
        await loadViaNetflixMenu(selectedLanguage);
      }
      chooseTrack();
      render();
    });
    refreshOptions();
  }

  function mountUiForFullscreen() {
    if (!panel || !subtitle) return;
    const fullscreenHost = document.fullscreenElement
      || document.webkitFullscreenElement
      || document.documentElement;
    if (panel.parentElement !== fullscreenHost) fullscreenHost.appendChild(panel);
    if (subtitle.parentElement !== fullscreenHost) fullscreenHost.appendChild(subtitle);
    requestAnimationFrame(render);
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function netflixMenuButton() {
    const selectors = [
      "[data-uia='control-audio-subtitle']",
      "[data-uia='control-audio-subtitles']",
      "[data-uia='audio-subtitle-controller']",
      "[data-uia*='audio-subtitle']",
      "button[aria-label*='subtitle' i]",
      "button[aria-label*='字幕']",
      "button[aria-label*='Untertitel' i]"
    ];
    return selectors.map((selector) => document.querySelector(selector)).find(Boolean);
  }

  function subtitleMenuItems() {
    return [...document.querySelectorAll("[data-uia^='subtitle-item-']")]
      .filter((item) => !/subtitle-item-(off|关闭|aus)$/i.test(item.dataset.uia || ""));
  }

  function itemLabel(item) {
    return item.innerText?.trim()
      || decodeURIComponent((item.dataset.uia || "").replace(/^subtitle-item-/, ""))
      || "Netflix 官方字幕";
  }

  function importNetflixMenu() {
    const items = subtitleMenuItems();
    const signature = items.map((item) => `${item.dataset.uia}:${itemLabel(item)}`).join("|");
    if (signature === lastMenuSignature) return items;
    lastMenuSignature = signature;
    items.forEach((item, index) => {
      const label = itemLabel(item);
      const language = normalize(label);
      const id = `menu:${item.dataset.uia || index}`;
      const previous = tracks.get(id);
      tracks.set(id, { id, language, label, cues: previous?.cues || [] });
    });
    if (items.length) refreshOptions();
    return items;
  }

  async function discoverNetflixTracks() {
    if (menuDiscoveryRunning || subtitleMenuItems().length) {
      importNetflixMenu();
      return;
    }
    const button = netflixMenuButton();
    if (!button) {
      status.textContent = "未识别控制栏；仍可先从列表选择语言";
      return;
    }
    menuDiscoveryRunning = true;
    button.click();
    await delay(350);
    const items = importNetflixMenu();
    button.click();
    menuDiscoveryRunning = false;
    if (!items.length) status.textContent = "请先打开一次 Netflix 的“音频与字幕”菜单";
  }

  async function loadViaNetflixMenu(language) {
    let button = netflixMenuButton();
    if (!subtitleMenuItems().length && button) {
      button.click();
      await delay(300);
    }
    const items = importNetflixMenu();
    const wanted = normalize(language);
    const target = items.find((item) => {
      const label = normalize(itemLabel(item));
      return label === wanted || label.startsWith(`${wanted} `) || wanted.startsWith(`${label} `);
    });
    if (!target) {
      status.textContent = "请在 Netflix 原生菜单切到该语言一次，然后再切回第一语言";
      if (button) button.click();
      return;
    }
    const previous = items.find((item) =>
      item.getAttribute("aria-selected") === "true"
      || item.querySelector("[aria-checked='true'], [data-uia*='selected']")
    );
    if (!previous) {
      status.textContent = "无法识别当前第一字幕；请先在 Netflix 菜单中选定第一字幕";
      if (button && subtitleMenuItems().length) button.click();
      return;
    }
    const previousUia = previous.dataset.uia || "";
    const previousLabel = normalize(itemLabel(previous));
    await chrome.runtime.sendMessage({ type: "nbs-mark-target" }).catch(() => {});
    target.click();
    await delay(1500);

    // Netflix closes and rebuilds the menu after a track change, so the old
    // element reference is no longer usable. Reopen and find the original item.
    button = netflixMenuButton();
    if (button && !subtitleMenuItems().length) {
      button.click();
      await delay(350);
    }
    const rebuiltItems = subtitleMenuItems();
    const restored = rebuiltItems.find((item) =>
      (previousUia && item.dataset.uia === previousUia)
      || normalize(itemLabel(item)) === previousLabel
    );
    if (restored && restored !== target) {
      restored.click();
      status.textContent = "第二字幕已加载，第一字幕已恢复";
    } else {
      window.postMessage({
        source: "netflix-bilingual-subtitles-content",
        type: "restore-language",
        language: previousLabel
      }, "*");
      status.textContent = "未能自动恢复，请在 Netflix 菜单切回原来的第一字幕";
    }
    await delay(250);
    button = netflixMenuButton();
    if (button && subtitleMenuItems().length) button.click();
  }

  function getNetflixPrimaryLanguage() {
    const nodes = document.querySelectorAll(
      ".player-timedtext-text-container, [data-uia='player-subtitle-text']"
    );
    for (const node of nodes) {
      const lang = node.closest("[lang]")?.lang || node.lang;
      if (lang) return normalize(lang);
    }
    return "";
  }

  function refreshOptions() {
    if (!select) return;
    const current = select.value;
    const languages = new Map();
    for (const track of tracks.values()) {
      const key = normalize(track.language || track.label);
      if (key && !languages.has(key)) languages.set(key, track.label || track.language || key);
    }

    select.replaceChildren(new Option("自动选择", ""));
    FALLBACK_LANGUAGES.forEach(([value, label]) => {
      const key = normalize(value);
      if (!languages.has(key)) languages.set(key, label);
    });
    [...languages].sort((a, b) => a[1].localeCompare(b[1])).forEach(([value, label]) => {
      select.add(new Option(label, value));
    });
    select.value = languages.has(current) ? current : selectedLanguage;
    const loadedCount = [...tracks.values()].filter((track) => track.cues?.length).length;
    status.textContent = loadedCount
      ? `已加载 ${loadedCount} 条官方字幕轨`
      : "选择语言后，扩展会尝试加载该官方字幕";
  }

  function chooseTrack() {
    const available = [...tracks.values()].filter((track) => track.cues?.length);
    if (!available.length) {
      activeTrackId = "";
      return;
    }

    const wanted = normalize(selectedLanguage);
    const primary = getNetflixPrimaryLanguage();
    const exactChoice = available.find((track) => {
      const lang = normalize(track.language || track.label);
      return wanted && (lang === wanted || lang.startsWith(`${wanted}-`));
    });
    if (wanted && !exactChoice) {
      activeTrackId = "";
      return;
    }
    const chosen = exactChoice || available.find((track) => {
      const lang = normalize(track.language || track.label);
      return !primary || (lang !== primary && !lang.startsWith(`${primary}-`));
    }) || available[0];
    activeTrackId = chosen.id;
  }

  function activeCue(cues, time) {
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const cue = cues[mid];
      if (time < cue.start) high = mid - 1;
      else if (time > cue.end) low = mid + 1;
      else return cue;
    }
    return null;
  }

  function render() {
    if (!subtitle || !video || !activeTrackId) {
      if (subtitle) subtitle.hidden = true;
      return;
    }
    const track = tracks.get(activeTrackId);
    const cue = track && activeCue(track.cues, video.currentTime);
    const text = cue?.text?.trim() || "";
    if (!text) {
      subtitle.hidden = true;
      lastText = "";
      return;
    }
    const netflixText = [...document.querySelectorAll(
      ".player-timedtext-text-container, [data-uia='player-subtitle-text']"
    )].map((node) => node.textContent || "").join(" ").replace(/\s+/g, " ").trim();
    const normalizedCue = text.replace(/\s+/g, " ").trim();
    if (netflixText && (netflixText === normalizedCue || netflixText.includes(normalizedCue))) {
      subtitle.hidden = true;
      status.textContent = "捕获到的是第一字幕，正在等待第二字幕";
      return;
    }
    positionAboveNetflixSubtitle();
    if (text !== lastText) {
      subtitle.textContent = text;
      lastText = text;
    }
    subtitle.hidden = false;
  }

  function positionAboveNetflixSubtitle() {
    const nativeNodes = [...document.querySelectorAll(
      ".player-timedtext-text-container, [data-uia='player-subtitle-text']"
    )].filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0
        && style.display !== "none" && style.visibility !== "hidden";
    });

    if (!nativeNodes.length) {
      subtitle.style.bottom = "17%";
      return;
    }

    const nativeTop = Math.min(...nativeNodes.map((node) => node.getBoundingClientRect().top));
    const gap = 14;
    const bottom = Math.max(90, window.innerHeight - nativeTop + gap);
    subtitle.style.bottom = `${bottom}px`;
  }

  function bindVideo() {
    const next = [...document.querySelectorAll("video")].find((item) => item.duration || item.readyState);
    if (!next || next === video) return;
    video = next;
    video.addEventListener("timeupdate", render, { passive: true });
    video.addEventListener("seeking", render, { passive: true });
    video.addEventListener("play", render, { passive: true });
  }

  function importNativeTracks() {
    if (!video?.textTracks) return;
    [...video.textTracks].forEach((native, index) => {
      if (!native.cues?.length) return;
      const id = `native:${native.language || native.label || index}`;
      tracks.set(id, {
        id,
        language: native.language,
        label: native.label || native.language || `字幕 ${index + 1}`,
        cues: [...native.cues].map((cue) => ({
          start: cue.startTime,
          end: cue.endTime,
          text: cue.text
        }))
      });
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window
      || event.data?.source !== "netflix-bilingual-subtitles") return;
    if (event.data?.type === "catalog") {
      event.data.tracks.forEach((track) => {
        const previous = tracks.get(track.id);
        tracks.set(track.id, { ...track, cues: previous?.cues || [] });
      });
      refreshOptions();
      return;
    }
    if (event.data?.type === "parse-status") {
      status.textContent = event.data.status;
      return;
    }
    if (event.data?.type !== "track") return;
    const detail = event.data.track;
    if (!detail?.id || !Array.isArray(detail.cues) || !detail.cues.length) return;
    tracks.set(detail.id, detail);
    refreshOptions();
    chooseTrack();
    render();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "nbs-debugger-response" || !message.body) return;
    let body = message.body;
    if (message.base64Encoded) {
      try {
        const binary = atob(body);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        body = new TextDecoder("utf-8").decode(bytes);
      } catch (_) {
        return;
      }
    }
    window.postMessage({
      source: "netflix-bilingual-subtitles-content",
      type: "raw-response",
      url: message.url,
      body,
      language: message.language
    }, "*");
  });

  function tick() {
    createUi();
    bindVideo();
    importNetflixMenu();
    importNativeTracks();
    if (!activeTrackId) chooseTrack();
    render();
  }

  chrome.storage.local.get(STORAGE_KEY, (value) => {
    selectedLanguage = value[STORAGE_KEY] || "";
    tick();
  });
  window.addEventListener("resize", render, { passive: true });
  document.addEventListener("fullscreenchange", mountUiForFullscreen);
  document.addEventListener("webkitfullscreenchange", mountUiForFullscreen);
  // Netflix frequently mutates the subtitle menu while it is open. Observing the
  // entire document here creates a feedback loop because our own selector also
  // changes the DOM. A modest polling interval is sufficient for video discovery.
  setInterval(tick, 2000);
})();
