(() => {
  "use strict";

  if (window.__nbsBridgeLoaded) return;
  window.__nbsBridgeLoaded = true;

  const seen = new Set();
  let requestedLanguage = "";
  const isMediaSegment = (url) => /media\.max\.com\/[^?]*\/[va]\/[^?]*\.mp4(?:\?|$)/i.test(url);
  const cleanText = (value) => String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();

  function seconds(value) {
    if (typeof value === "number") return value > 100000 ? value / 1000 : value;
    const text = String(value || "").trim();
    if (!text) return NaN;
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const numeric = Number(text);
      return numeric > 100000 ? numeric / 1000 : numeric;
    }
    if (/^\d+(\.\d+)?(ms|s)$/.test(text)) {
      return text.endsWith("ms") ? parseFloat(text) / 1000 : parseFloat(text);
    }
    const parts = text.replace(",", ".").split(":").map(Number);
    if (parts.some(Number.isNaN)) return NaN;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  function languageFromUrl(url) {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/(?:lang(?:uage)?|locale)[=/:%_-]+([a-z]{2,3}(?:-[A-Z]{2})?)/i)
      || decoded.match(/[/?&]([a-z]{2}(?:-[A-Z]{2})?)(?:[/?&._-]|$)/);
    return match?.[1] || "";
  }

  function parseVtt(text) {
    const cues = [];
    const normalized = text.replace(/\r/g, "").replace(/\\r?\\n/g, "\n");
    const blocks = normalized.split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split("\n");
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;
      const [from, to] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s/)[0]);
      const start = seconds(from);
      const end = seconds(to);
      const cueText = cleanText(lines.slice(timingIndex + 1).join("\n"));
      if (Number.isFinite(start) && Number.isFinite(end) && cueText) cues.push({ start, end, text: cueText });
    }
    if (cues.length) return cues;

    // Some Max WebVTT segments omit blank lines between cues. Parse timing
    // lines directly and collect text until the next timing line.
    const lines = normalized.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes("-->")) continue;
      const [from, to] = lines[index].split("-->").map((part) => part.trim().split(/\s/)[0]);
      const start = seconds(from);
      const end = seconds(to);
      const textLines = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].includes("-->")) break;
        if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[next])) continue;
        if (lines[next].trim()) textLines.push(lines[next]);
        index = next;
      }
      const cueText = cleanText(textLines.join("\n"));
      if (Number.isFinite(start) && Number.isFinite(end) && cueText) {
        cues.push({ start, end, text: cueText });
      }
    }
    return cues;
  }

  function parseXml(text) {
    const xml = new DOMParser().parseFromString(text, "text/xml");
    const cues = [];
    const root = xml.documentElement;
    const tickRate = Number(
      root?.getAttribute("ttp:tickRate")
      || root?.getAttributeNS("http://www.w3.org/ns/ttml#parameter", "tickRate")
      || root?.getAttribute("tickRate")
      || 0
    );
    const xmlSeconds = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return NaN;
      if (raw.endsWith("t")) {
        const ticks = Number(raw.slice(0, -1));
        return tickRate ? ticks / tickRate : ticks / 10_000_000;
      }
      if (tickRate && /^\d+(?:\.\d+)?$/.test(raw)) return Number(raw) / tickRate;
      return seconds(raw);
    };
    const nodes = [
      ...xml.getElementsByTagNameNS("*", "p"),
      ...xml.getElementsByTagName("p")
    ].filter((node, index, all) => all.indexOf(node) === index);
    for (const node of nodes) {
      const start = xmlSeconds(node.getAttribute("begin") || node.getAttribute("t"));
      let end = xmlSeconds(node.getAttribute("end"));
      const duration = xmlSeconds(node.getAttribute("dur") || node.getAttribute("d"));
      if (!Number.isFinite(end) && Number.isFinite(duration)) end = start + duration;
      const cueText = cleanText(node.innerHTML);
      if (Number.isFinite(start) && cueText) cues.push({ start, end, text: cueText });
    }
    if (!cues.length) {
      const cuePattern = /<(?:[\w-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?p\s*>/gi;
      let match;
      while ((match = cuePattern.exec(text))) {
        const attributes = match[1];
        const attribute = (name) => {
          const found = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, "i"));
          return found?.[1] || "";
        };
        const start = xmlSeconds(attribute("begin") || attribute("t"));
        let end = xmlSeconds(attribute("end"));
        const duration = xmlSeconds(attribute("dur") || attribute("d"));
        if (!Number.isFinite(end) && Number.isFinite(duration)) end = start + duration;
        const cueText = cleanText(match[2]);
        if (Number.isFinite(start) && cueText) cues.push({ start, end, text: cueText });
      }
    }
    cues.sort((a, b) => a.start - b.start);
    cues.forEach((cue, index) => {
      if (!Number.isFinite(cue.end) || cue.end <= cue.start) {
        cue.end = cues[index + 1]?.start || cue.start + 5;
      }
    });
    return cues;
  }

  function nestedText(value, depth = 0) {
    if (depth > 5 || value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((item) => nestedText(item, depth + 1)).filter(Boolean).join("\n");
    }
    if (typeof value !== "object") return "";
    const direct = value.text ?? value.utf8 ?? value.content ?? value.payload
      ?? value.value ?? value.caption;
    if (typeof direct === "string") return direct;
    return ["lines", "spans", "segments", "segs", "fragments", "children"]
      .map((key) => nestedText(value[key], depth + 1))
      .filter(Boolean)
      .join("\n");
  }

  function walkJson(value, output, embedded) {
    if (!value || typeof value !== "object") return;
    const startIsMs = value.startTimeMs != null || value.tStartMs != null;
    const endIsMs = value.endTimeMs != null;
    const durationIsMs = value.durationMs != null || value.dDurationMs != null;
    const startValue = value.startTimeMs ?? value.tStartMs ?? value.startTime ?? value.start
      ?? value.begin ?? value.beginTime ?? value.tStartMs ?? value.t;
    const endValue = value.endTimeMs ?? value.endTime ?? value.end;
    const durationValue = value.durationMs ?? value.dDurationMs ?? value.duration ?? value.d;
    const directText = value.text ?? value.payload ?? value.content ?? value.line;
    const textValue = typeof directText === "string" ? directText : nestedText(value);
    const start = startIsMs ? Number(startValue) / 1000 : seconds(startValue);
    let end = endIsMs ? Number(endValue) / 1000 : seconds(endValue);
    const duration = durationIsMs ? Number(durationValue) / 1000 : seconds(durationValue);
    if (!Number.isFinite(end) && Number.isFinite(start) && Number.isFinite(duration)) end = start + duration;
    if (Number.isFinite(start) && Number.isFinite(end) && typeof textValue === "string") {
      const text = cleanText(textValue);
      if (text) output.push({ start, end, text });
    }
    Object.values(value).forEach((child) => {
      if (typeof child === "string"
        && (child.includes("-->") || /<(?:tt|p)[\s>]/i.test(child))) {
        embedded.push(child);
      } else if (child && typeof child === "object") {
        walkJson(child, output, embedded);
      }
    });
  }

  function publish(url, body) {
    if (!body || body.length > 15_000_000) return;
    let cues = [];
    const embedded = [];
    let trimmed = body.trim();
    // Max can package TTML subtitles in fragmented MP4 (stpp/mdat). Keep only
    // the embedded XML document and discard the surrounding ISO-BMFF bytes.
    if (/\.mp4(?:\?|$)/i.test(url) || /[\u0000-\u0008]/.test(trimmed.slice(0, 100))) {
      const ttStart = trimmed.search(/<tt(?:\s|>)/i);
      const ttEndMatch = /<\/tt\s*>/ig;
      let ttEnd = -1;
      let closing;
      while ((closing = ttEndMatch.exec(trimmed))) ttEnd = closing.index + closing[0].length;
      if (ttStart >= 0 && ttEnd > ttStart) trimmed = trimmed.slice(ttStart, ttEnd);
    }
    let format = "unknown";
    try {
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        format = "JSON";
        walkJson(JSON.parse(trimmed), cues, embedded);
        embedded.forEach((payload) => {
          if (payload.includes("-->")) cues.push(...parseVtt(payload));
          else cues.push(...parseXml(payload));
        });
      } else if (trimmed.includes("-->")) {
        format = "WebVTT";
        cues = parseVtt(trimmed);
      } else if (/<tt(?:\s|>)[^>]*(?:xmlns|xml:lang|ttp:)|<(?:[\w-]+:)?p\b[^>]*(?:begin|end|dur|t)=/i.test(trimmed)) {
        format = "TTML";
        cues = parseXml(trimmed);
      }
    } catch (_) {
      return;
    }
    if (!cues.length && (trimmed.includes("-->")
      || /<tt(?:\s|>)[^>]*(?:xmlns|xml:lang|ttp:)|<(?:[\w-]+:)?p\b[^>]*(?:begin|end|dur|t)=/i.test(trimmed))) {
      window.postMessage({
        source: "netflix-bilingual-subtitles",
        type: "parse-status",
        statusKey: "parseFailed",
        format,
        url,
        sample: trimmed.slice(0, 3000)
      }, "*");
    }
    if (!cues.length) return;
    cues.sort((a, b) => a.start - b.start);
    const language = requestedLanguage || languageFromUrl(url);
    const id = `${language || "unknown"}:${url.replace(/[?#].*$/, "").slice(-100)}`;
    const signature = `${id}:${cues.length}:${cues[0].start}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    window.postMessage({
      source: "netflix-bilingual-subtitles",
      type: "track",
      track: { id, language, label: language || "Official subtitle", cues }
    }, "*");
    window.postMessage({
      source: "netflix-bilingual-subtitles",
      type: "parse-status",
      statusKey: "parsed",
      count: cues.length,
      format,
      url,
      sample: trimmed.slice(0, 3000)
    }, "*");
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = response.url || String(args[0]?.url || args[0] || "");
    if (!isMediaSegment(url)) {
      response.clone().text().then((body) => publish(url, body)).catch(() => {});
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__nbsUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const url = this.responseURL || this.__nbsUrl;
        if (isMediaSegment(url)) return;
        if (!this.responseType || this.responseType === "text") {
          publish(url, this.responseText);
        } else if (this.responseType === "arraybuffer" && this.response) {
          publish(url, new TextDecoder("utf-8").decode(this.response));
        } else if (this.responseType === "blob" && this.response) {
          this.response.text().then((body) => publish(url, body)).catch(() => {});
        } else if (this.responseType === "json" && this.response) {
          publish(url, JSON.stringify(this.response));
        }
      } catch (_) {}
    });
    return originalSend.apply(this, args);
  };

  // Newer Netflix builds may perform the original media request below the
  // JavaScript fetch/XHR layer. Resource Timing still exposes the signed URL.
  // Re-read only small fetch/XHR resources; subtitle files are small, while
  // normal video segments are intentionally excluded.
  const retriedResources = new Set();
  function retryTimedTextResource(entry) {
    const url = String(entry?.name || "");
    if (!url || retriedResources.has(url)) return;
    if (!/nflxvideo\.net|netflix\.com|max\.com|hbomax\.com/i.test(url)) return;
    if (!["fetch", "xmlhttprequest", "other"].includes(entry.initiatorType)) return;
    const size = entry.encodedBodySize || entry.transferSize || 0;
    if (!size || size > 1_500_000) return;
    retriedResources.add(url);
    originalFetch(url, { credentials: "include" })
      .then((response) => response.text())
      .then((body) => publish(url, body))
      .catch(() => {});
  }

  try {
    performance.getEntriesByType("resource").forEach(retryTimedTextResource);
    new PerformanceObserver((list) => {
      list.getEntries().forEach(retryTimedTextResource);
    }).observe({ type: "resource", buffered: true });
  } catch (_) {}

  function playerAndTracks() {
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
      const sessionId = api?.getAllPlayerSessionIds?.()?.[0];
      const player = sessionId && api.getVideoPlayerBySessionId(sessionId);
      const list = player?.getTimedTextTrackList?.() || [];
      return { player, list };
    } catch (_) {
      return { player: null, list: [] };
    }
  }

  function trackLanguage(track) {
    return track?.bcp47 || track?.language || track?.languageCode
      || track?.id?.match?.(/[a-z]{2,3}(?:-[A-Z]{2})?/i)?.[0] || "";
  }

  function trackLabel(track) {
    return track?.displayName || track?.label || track?.name || trackLanguage(track) || "Netflix 官方字幕";
  }

  function publishCatalog() {
    const { list } = playerAndTracks();
    const catalog = [...list].map((track, index) => ({
      id: `catalog:${track?.trackId || track?.id || index}`,
      language: trackLanguage(track),
      label: trackLabel(track),
      source: "catalog"
    })).filter((track) => track.language);
    if (catalog.length) {
      window.postMessage({
        source: "netflix-bilingual-subtitles",
        type: "catalog",
        tracks: catalog
      }, "*");
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window
      || event.data?.source !== "netflix-bilingual-subtitles-content") return;
    if (event.data?.type === "raw-response") {
      requestedLanguage = String(event.data.language || "");
      publish(String(event.data.url || ""), String(event.data.body || ""));
      return;
    }
    if (event.data?.type === "restore-language") {
      const wantedLabel = String(event.data.language || "").toLowerCase();
      const { player, list } = playerAndTracks();
      const original = [...list].find((track) => {
        const label = trackLabel(track).toLowerCase();
        const language = trackLanguage(track).toLowerCase();
        return label === wantedLabel || label.startsWith(`${wantedLabel} `)
          || language === wantedLabel;
      });
      try {
        if (player && original) player.setTimedTextTrack(original);
      } catch (_) {}
      return;
    }
    if (event.data?.type === "end-language-capture") {
      requestedLanguage = "";
      return;
    }
    if (event.data?.type !== "load-language") return;

    const wanted = String(event.data.language || "").toLowerCase();
    if (!wanted) return;
    requestedLanguage = String(event.data.language || "");
    setTimeout(() => { requestedLanguage = ""; }, 5000);
  });

  setInterval(publishCatalog, 2000);
})();
