const sessions = new Map();

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const session = sessions.get(source.tabId);
  if (!session) return;

  if (method === "Network.responseReceived") {
    const response = params.response || {};
    const url = String(response.url || "");
    const mime = String(response.mimeType || "").toLowerCase();
    const netflixResource = /nflxvideo\.net|netflix\.com/i.test(url)
      && /text|xml|json|vtt|ttml|octet-stream/.test(mime);
    const maxVideoOrAudio = /\/[va]\/[^?]*\.mp4(?:\?|$)/i.test(url)
      || /(?:\?|&)CMCD=[^&]*(?:ot%3D|ot=)[av](?:%2C|,|&)/i.test(url);
    const maxResource = session.platform === "max" && !maxVideoOrAudio
      && (/vtt|ttml|xml|application\/mp4/.test(mime)
        || /\/t\/[^?]*\.mp4(?:\?|$)|subtitle|caption|timed.?text|\.vtt(?:\?|$)|\.ttml(?:\?|$)/i.test(url));
    const likelySubtitle = netflixResource || maxResource;
    const elapsedSinceTarget = session.targetStartedAt
      ? Date.now() - session.targetStartedAt
      : -1;
    const inTargetWindow = elapsedSinceTarget >= 0 && elapsedSinceTarget < 20000;
    if (likelySubtitle && inTargetWindow) {
      session.requests.set(params.requestId, { url, mime });
    }
    return;
  }

  if (method !== "Network.loadingFinished") return;
  const request = session.requests.get(params.requestId);
  if (!request) return;
  session.requests.delete(params.requestId);
  if (params.encodedDataLength > 2_000_000) return;

  try {
    const result = await chrome.debugger.sendCommand(
      { tabId: source.tabId },
      "Network.getResponseBody",
      { requestId: params.requestId }
    );
    if (!result?.body) return;
    await chrome.tabs.sendMessage(source.tabId, {
      type: "nbs-debugger-response",
      url: request.url,
      body: result.body,
      base64Encoded: Boolean(result.base64Encoded),
      mime: request.mime,
      language: session.language
    });
  } catch (_) {}
});

chrome.debugger.onDetach.addListener((source) => {
  sessions.delete(source.tabId);
});

async function stopCapture(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  clearTimeout(session.timer);
  sessions.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "nbs-start-capture" || !sender.tab?.id) return;
  const tabId = sender.tab.id;

  (async () => {
    try {
      if (sessions.has(tabId)) await stopCapture(tabId);
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
        maxTotalBufferSize: 20_000_000,
        maxResourceBufferSize: 5_000_000
      });
      await chrome.debugger.sendCommand({ tabId }, "Network.setCacheDisabled", {
        cacheDisabled: true
      });
      const session = {
        language: String(message.language || ""),
        platform: String(message.platform || ""),
        requests: new Map(),
        targetStartedAt: 0,
        timer: setTimeout(() => stopCapture(tabId), 25_000)
      };
      sessions.set(tabId, session);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "nbs-mark-target" || !sender.tab?.id) return;
  const session = sessions.get(sender.tab.id);
  if (!session) {
    sendResponse({ ok: false });
    return;
  }
  session.requests.clear();
  session.targetStartedAt = Date.now();
  sendResponse({ ok: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "nbs-end-target" || !sender.tab?.id) return;
  const session = sessions.get(sender.tab.id);
  if (session) {
    session.targetStartedAt = 0;
    session.requests.clear();
  }
  sendResponse({ ok: Boolean(session) });
});
