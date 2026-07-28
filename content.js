(() => {
  "use strict";

  if (window.top !== window || window.__nbsLoaded) return;
  window.__nbsLoaded = true;

  const STORAGE_KEY = "nbsSecondaryLanguage";
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
  let contentKey = "";
  let reloadTimer = 0;
  let lastDiagnostic = "";
  const isMax = /(^|\.)max\.com$|(^|\.)hbomax\.com$/i.test(location.hostname);
  const platform = isMax ? "max" : "netflix";
  const platformName = isMax ? "Max" : "Netflix";

  const normalize = (value) => String(value || "").trim().toLowerCase().replace("_", "-");
  function canonicalLanguage(value) {
    const key = normalize(value).replace(/[()[\]]/g, " ").replace(/\s+/g, " ").trim();
    const words = key.replace(/[–—-]/g, " ").replace(/\s+/g, " ");
    if (/^zh-(cn|hans)$/.test(key) || /^(chinese simplified|简体中文|中文 简体)$/.test(words)) return "zh-cn";
    if (/^zh-(tw|hant)$/.test(key) || /^(chinese traditional|繁體中文|繁体中文|中文 繁體)$/.test(words)) return "zh-tw";
    return key;
  }

  const LANGUAGE_CODES = new Set([
    "ar", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "es", "et",
    "fa", "fi", "fil", "fr", "he", "hi", "hr", "hu", "id", "is", "it",
    "ja", "ko", "lt", "lv", "ms", "nl", "no", "pl", "pt", "ro", "ru",
    "sk", "sl", "sr", "sv", "sw", "ta", "te", "th", "tr", "uk", "ur",
    "vi", "zh", "zh-cn", "zh-tw", "zh-hans", "zh-hant"
  ]);
  const LANGUAGE_NAMES = new Set([
    "arabic", "العربية", "bulgarian", "বাংলা", "bengali", "catalan",
    "chinese", "chinese simplified", "chinese traditional", "简体中文",
    "繁體中文", "繁体中文", "中文", "croatian", "czech", "danish",
    "deutsch", "german", "dutch", "nederlands", "english", "estonian",
    "farsi", "persian", "filipino", "finnish", "french", "français",
    "greek", "ελληνικά", "hebrew", "עברית", "hindi", "हिन्दी",
    "hungarian", "icelandic", "indonesian", "bahasa indonesia", "italian",
    "italiano", "japanese", "日本語", "korean", "한국어", "latvian",
    "lithuanian", "malay", "bahasa melayu", "norwegian", "norsk",
    "polish", "polski", "portuguese", "português", "romanian", "russian",
    "русский", "serbian", "slovak", "slovenian", "spanish", "español",
    "swedish", "svenska", "thai", "ไทย", "turkish", "türkçe",
    "ukrainian", "українська", "urdu", "vietnamese", "tiếng việt"
  ]);

  function isPlausibleLanguageOption(item) {
    if (!isMax) return true;
    const raw = item.innerText?.trim() || item.textContent?.trim() || "";
    const dataLanguage = item.getAttribute("lang")
      || item.dataset.language || item.dataset.languageCode || item.getAttribute("value") || "";
    const normalizedData = canonicalLanguage(dataLanguage);
    if (LANGUAGE_CODES.has(normalizedData)) return true;
    const cleaned = canonicalLanguage(raw)
      .replace(/\b(cc|sdh|captions?|subtitles?|audio description)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return LANGUAGE_CODES.has(cleaned) || LANGUAGE_NAMES.has(cleaned);
  }
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

  function deepQueryAll(selector, root = document) {
    const results = [...root.querySelectorAll(selector)];
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) results.push(...deepQueryAll(selector, element.shadowRoot));
    }
    return [...new Set(results)];
  }

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
        <button id="nbs-copy-diagnostic" type="button" hidden>${t("copyDiagnostics")}</button>
      </div>`;

    subtitle = document.createElement("div");
    subtitle.id = "nbs-subtitle";
    subtitle.setAttribute("aria-live", "off");

    document.documentElement.append(panel, subtitle);
    select = panel.querySelector("#nbs-language");
    status = panel.querySelector("#nbs-status");
    panel.querySelector("#nbs-copy-diagnostic").addEventListener("click", async (event) => {
      if (!lastDiagnostic) return;
      await navigator.clipboard.writeText(lastDiagnostic).catch(() => {});
      event.currentTarget.textContent = t("diagnosticsCopied");
    });

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
    return selectors
      .flatMap((selector) => isMax ? deepQueryAll(selector) : [document.querySelector(selector)])
      .find(Boolean);
  }

  function subtitleMenuItems() {
    let candidates;
    if (isMax) {
      const selector = [
        "[role='dialog'] [role='radio']",
        "[role='dialog'] [role='option']",
        "[role='menu'] [role='menuitemradio']",
        "[data-testid*='subtitle-option' i]",
        "[data-testid*='caption-option' i]"
      ].join(",");
      candidates = deepQueryAll(selector);

      if (!candidates.length) {
        const headings = deepQueryAll("h1,h2,h3,h4,h5,[role='heading'],span,div")
          .filter((node) => {
            const text = normalize(node.textContent);
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0
              && /^(subtitles?(?:\s*&\s*captions?)?|captions?|untertitel|sous-titres|subtítulos|sottotitoli|字幕)$/.test(text);
          });
        for (const heading of headings) {
          let container = heading.parentElement;
          for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
            const options = [...container.querySelectorAll(
              "button,[role='radio'],[role='option'],[role='menuitem'],li"
            )].filter((item) => {
              const text = item.innerText?.trim() || "";
              const rect = item.getBoundingClientRect();
              return item !== heading && text && text.length <= 100
                && rect.width > 0 && rect.height > 0;
            });
            if (options.length) {
              candidates = options;
              break;
            }
          }
          if (candidates.length) break;
        }
      }

      if (!candidates.length) {
        const menuRoots = deepQueryAll(
          "[role='dialog'],[role='menu'],[aria-modal='true'],[data-testid*='subtitle' i],[data-testid*='caption' i]"
        ).filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0
            && /(subtitles?|captions?|untertitel|sous-titres|subtítulos|sottotitoli|字幕)/i
              .test(node.innerText || "");
        });
        for (const root of menuRoots) {
          const options = [...root.querySelectorAll(
            "button,[role='radio'],[role='option'],[role='menuitem'],li"
          )].filter((item) => {
            const text = item.innerText?.trim() || "";
            const rect = item.getBoundingClientRect();
            return text && text.length <= 100 && rect.width > 0 && rect.height > 0
              && !/(subtitles?|captions?|audio|settings|close|back)$/i.test(text);
          });
          if (options.length) {
            candidates = options;
            break;
          }
        }
      }
    } else {
      candidates = [...document.querySelectorAll("[data-uia^='subtitle-item-']")];
    }

    return candidates.filter((item) => {
      const value = `${item.dataset.uia || ""} ${item.textContent || ""}`.trim();
      const rect = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return rect.width > 0 && rect.height > 0
        && style.display !== "none" && style.visibility !== "hidden"
        && isPlausibleLanguageOption(item)
        && !/(?:subtitle-item-)?(?:off|关闭|aus|none|无字幕|subtitles?|captions?|untertitel)$/i.test(value);
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
      const language = canonicalLanguage(label);
      const id = `menu:${item.dataset.uia || item.dataset.testid || label || index}`;
      const previous = tracks.get(id);
      tracks.set(id, { id, language, label, source: "menu", cues: previous?.cues || [] });
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
    await delay(isMax ? 900 : 350);
    const items = importNetflixMenu();
    button.click();
    menuDiscoveryRunning = false;
    if (!items.length) status.textContent = t("openPlatformSubtitleMenu", platformName);
  }

  async function loadViaNetflixMenu(language) {
    let button = netflixMenuButton();
    if (!subtitleMenuItems().length && button) {
      button.click();
      await delay(isMax ? 900 : 300);
    }
    const items = importNetflixMenu();
    const wanted = canonicalLanguage(language);
    const target = items.find((item) => {
      const label = canonicalLanguage(itemLabel(item));
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
      await delay(isMax ? 900 : 350);
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
      status.textContent = t("restoreFailed", platformName);
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
    const allTracks = [...tracks.values()];
    const hasMenuTracks = allTracks.some((track) => track.source === "menu");
    const optionTracks = hasMenuTracks
      ? allTracks.filter((track) => track.source === "menu" || track.cues?.length)
      : allTracks;
    for (const track of optionTracks) {
      const key = canonicalLanguage(track.label || track.language);
      if (key && !languages.has(key)) languages.set(key, track.label || track.language || key);
    }

    select.replaceChildren(new Option(t("autoSelect"), ""));
    [...languages].sort((a, b) => a[1].localeCompare(b[1])).forEach(([value, label]) => {
      select.add(new Option(label, value));
    });
    const storedKey = canonicalLanguage(selectedLanguage);
    select.value = languages.has(current) ? current : (languages.has(storedKey) ? storedKey : "");
    const loadedCount = [...tracks.values()].filter((track) => track.cues?.length).length;
    status.textContent = loadedCount
      ? t("tracksLoaded", String(loadedCount))
      : (languages.size ? t("selectLanguageHint") : t("noTracksDiscovered", platformName));
  }

  function chooseTrack() {
    const available = [...tracks.values()].filter((track) => track.cues?.length);
    if (!available.length) {
      activeTrackId = "";
      return;
    }

    const wanted = canonicalLanguage(selectedLanguage);
    const primary = getNetflixPrimaryLanguage();
    const exactChoice = available.find((track) => {
      const lang = canonicalLanguage(track.language || track.label);
      return wanted && (lang === wanted || lang.startsWith(`${wanted}-`));
    });
    if (wanted && !exactChoice) {
      activeTrackId = "";
      return;
    }
    const chosen = exactChoice || available.find((track) => {
      const lang = canonicalLanguage(track.language || track.label);
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

  function normalizeCueTimeScale(cues) {
    if (!isMax || !cues.length || !video?.duration || !Number.isFinite(video.duration)) return cues;
    const lastEnd = Math.max(...cues.map((cue) => cue.end || cue.start || 0));
    if (lastEnd <= video.duration * 5) return cues;

    const factors = [1000, 10000, 90000, 10000000];
    const viable = factors
      .map((factor) => ({ factor, scaledEnd: lastEnd / factor }))
      .filter(({ scaledEnd }) => scaledEnd >= video.duration * 0.2 && scaledEnd <= video.duration * 2);
    if (!viable.length) return cues;
    const best = viable.sort((a, b) =>
      Math.abs(Math.log(a.scaledEnd / video.duration))
      - Math.abs(Math.log(b.scaledEnd / video.duration))
    )[0];
    return cues.map((cue) => ({
      ...cue,
      start: cue.start / best.factor,
      end: cue.end / best.factor
    }));
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
    const next = [...document.querySelectorAll("video")]
      .filter((item) => item.duration || item.readyState)
      .sort((a, b) => {
        const score = (item) => (item.paused ? 0 : 1_000_000)
          + item.clientWidth * item.clientHeight;
        return score(b) - score(a);
      })[0];
    if (!next || next === video) return;
    video = next;
    video.addEventListener("timeupdate", render, { passive: true });
    video.addEventListener("seeking", render, { passive: true });
    video.addEventListener("play", render, { passive: true });
  }

  function currentContentKey() {
    const source = video?.currentSrc || video?.src || "";
    return `${location.pathname}|${source.slice(0, 180)}`;
  }

  function handleContentChange() {
    if (!video) return;
    const nextKey = currentContentKey();
    if (!nextKey || nextKey === contentKey) return;
    const isFirstContent = !contentKey;
    contentKey = nextKey;
    if (isFirstContent) return;
    tracks.clear();
    activeTrackId = "";
    lastText = "";
    lastMenuSignature = "";
    subtitle.hidden = true;
    refreshOptions();
    if (!selectedLanguage) return;

    clearTimeout(reloadTimer);
    status.textContent = t("newVideoDetected");
    reloadTimer = setTimeout(() => {
      if (select && selectedLanguage) {
        select.value = selectedLanguage;
        select.dispatchEvent(new Event("change"));
      }
    }, 1800);
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
        tracks.set(track.id, { ...track, source: "catalog", cues: previous?.cues || [] });
      });
      refreshOptions();
      return;
    }
    if (event.data?.type === "parse-status") {
      if (event.data.sample) {
        lastDiagnostic = [
          `platform=${platform}`,
          `url=${event.data.url || ""}`,
          `format=${event.data.format || "unknown"}`,
          event.data.sample
        ].join("\n");
      }
      if (event.data.statusKey !== "parsed" || !activeTrackId) {
        status.textContent = event.data.statusKey === "parsed"
          ? t("parsedSubtitleCues", String(event.data.count || 0))
          : t("subtitleTimeParseFailed", event.data.format || "unknown");
      }
      const diagnosticButton = panel.querySelector("#nbs-copy-diagnostic");
      diagnosticButton.hidden = !lastDiagnostic;
      diagnosticButton.textContent = t("copyDiagnostics");
      return;
    }
    if (event.data?.type !== "track") return;
    const detail = event.data.track;
    if (!detail?.id || !Array.isArray(detail.cues) || !detail.cues.length) return;
    const normalizedCues = normalizeCueTimeScale(detail.cues);
    tracks.set(detail.id, { ...detail, cues: normalizedCues, source: "captured" });
    const diagnosticButton = panel.querySelector("#nbs-copy-diagnostic");
    if (diagnosticButton) diagnosticButton.hidden = !lastDiagnostic;
    refreshOptions();
    chooseTrack();
    const firstCue = normalizedCues[0];
    const lastCue = normalizedCues[normalizedCues.length - 1];
    status.textContent = t("parsedSubtitleTimeline", [
      String(normalizedCues.length),
      Number(firstCue.start).toFixed(1),
      Number(lastCue.end).toFixed(1),
      Number(video?.currentTime || 0).toFixed(1)
    ]);
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
    lastDiagnostic = [
      `platform=${platform}`,
      `url=${message.url || ""}`,
      `mime=${message.mime || ""}`,
      `language=${message.language || ""}`,
      body.slice(0, 3000)
    ].join("\n");
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
    handleContentChange();
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
