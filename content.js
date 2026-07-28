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
  const isMax = /(^|\.)max\.com$|(^|\.)hbomax\.com$/i.test(location.hostname);
  const platform = isMax ? "max" : "netflix";
  const platformName = isMax ? "Max" : "Netflix";

  const normalize = (value) => String(value || "").trim().toLowerCase().replace("_", "-");
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

  function createUi() {
    if (panel?.isConnected) return;

    panel = document.createElement("div");
    panel.id = "nbs-panel";
    panel.innerHTML = `
      <button id="nbs-toggle" type="button" aria-label="${t("configureSecondarySubtitle")}">${t("bilingualSubtitles")}</button>
      <div id="nbs-menu" hidden>
        <label for="nbs-language">${t("secondarySubtitle")}</label>
        <select id="nbs-language">
          <option value="">${t("autoSelect")}</option>
        </select>
        <div id="nbs-status">${t("waitingForPlatformSubtitles", platformName)}</div>
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
          language: selectedLanguage,
          platform
        }).catch((error) => ({ ok: false, error: error.message }));
        if (!capture?.ok) {
          status.textContent = t("captureFailed", capture?.error || t("unknownError"));
          return;
        }
        window.postMessage({
          source: "netflix-bilingual-subtitles-content",
          type: "load-language",
          language: selectedLanguage
        }, "*");
        status.textContent = t("loadingSelectedSubtitle");
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
    const selectors = isMax ? [
      "button[aria-label*='audio and subtitles' i]",
      "button[aria-label*='audio & subtitles' i]",
      "button[aria-label*='subtitles' i]",
      "button[aria-label*='captions' i]",
      "[data-testid*='audio-subtitle' i]",
      "[data-testid*='subtitle-button' i]",
      "[data-testid*='caption-button' i]"
    ] : [
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
    const selector = isMax
      ? "[role='dialog'] [role='radio'], [role='menu'] [role='menuitemradio'], [data-testid*='subtitle-option' i]"
      : "[data-uia^='subtitle-item-']";
    return [...document.querySelectorAll(selector)].filter((item) => {
      const value = `${item.dataset.uia || ""} ${item.textContent || ""}`.trim();
      return !/(?:subtitle-item-)?(?:off|关闭|aus|none|无字幕)$/i.test(value);
    });
  }

  function itemLabel(item) {
    return item.innerText?.trim()
      || decodeURIComponent((item.dataset.uia || "").replace(/^subtitle-item-/, ""))
      || t("officialPlatformSubtitle", platformName);
  }

  function importNetflixMenu() {
    const items = subtitleMenuItems();
    const signature = items.map((item) => `${item.dataset.uia}:${itemLabel(item)}`).join("|");
    if (signature === lastMenuSignature) return items;
    lastMenuSignature = signature;
    items.forEach((item, index) => {
      const label = itemLabel(item);
      const language = normalize(label);
      const id = `menu:${item.dataset.uia || item.dataset.testid || label || index}`;
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
      status.textContent = t("controlsNotFound");
      return;
    }
    menuDiscoveryRunning = true;
    button.click();
    await delay(350);
    const items = importNetflixMenu();
    button.click();
    menuDiscoveryRunning = false;
    if (!items.length) status.textContent = t("openPlatformSubtitleMenu", platformName);
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
      status.textContent = t("switchLanguageManually");
      if (button) button.click();
      return;
    }
    const previous = items.find((item) =>
      item.getAttribute("aria-selected") === "true"
      || item.querySelector("[aria-checked='true'], [data-uia*='selected']")
    );
    if (!previous) {
      status.textContent = t("primarySubtitleNotDetected");
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
      status.textContent = t("secondaryLoadedPrimaryRestored");
    } else {
      window.postMessage({
        source: "netflix-bilingual-subtitles-content",
        type: "restore-language",
        language: previousLabel
      }, "*");
      status.textContent = t("restoreFailed");
    }
    await delay(250);
    button = netflixMenuButton();
    if (button && subtitleMenuItems().length) button.click();
  }

  function getNetflixPrimaryLanguage() {
    const nodes = document.querySelectorAll(nativeSubtitleSelector());
    for (const node of nodes) {
      const lang = node.closest("[lang]")?.lang || node.lang;
      if (lang) return normalize(lang);
    }
    return "";
  }

  function nativeSubtitleSelector() {
    return isMax
      ? "[data-testid*='subtitle' i]:not(#nbs-subtitle), [data-testid*='caption' i], [class*='subtitle' i]:not(#nbs-subtitle), [class*='caption' i]"
      : ".player-timedtext-text-container, [data-uia='player-subtitle-text']";
  }

  function refreshOptions() {
    if (!select) return;
    const current = select.value;
    const languages = new Map();
    for (const track of tracks.values()) {
      const key = normalize(track.language || track.label);
      if (key && !languages.has(key)) languages.set(key, track.label || track.language || key);
    }

    select.replaceChildren(new Option(t("autoSelect"), ""));
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
      ? t("tracksLoaded", String(loadedCount))
      : t("selectLanguageHint");
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
    const netflixText = [...document.querySelectorAll(nativeSubtitleSelector())]
      .filter((node) => node !== panel && !panel?.contains(node) && node !== subtitle)
      .map((node) => node.textContent || "").join(" ").replace(/\s+/g, " ").trim();
    const normalizedCue = text.replace(/\s+/g, " ").trim();
    if (netflixText && (netflixText === normalizedCue || netflixText.includes(normalizedCue))) {
      subtitle.hidden = true;
      status.textContent = t("waitingForSecondarySubtitle");
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
      nativeSubtitleSelector()
    )].filter((node) => {
      if (node === subtitle || node === panel || panel?.contains(node)) return false;
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
        label: native.label || native.language || t("subtitleNumber", String(index + 1)),
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
      status.textContent = event.data.statusKey === "parsed"
        ? t("parsedSubtitleCues", String(event.data.count || 0))
        : t("subtitleTimeParseFailed");
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
