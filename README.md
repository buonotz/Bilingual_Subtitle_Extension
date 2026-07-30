# Streaming Bilingual Subtitles

A Chrome extension that displays a second official subtitle track alongside the
subtitle already selected in Netflix or Max.

The extension does not translate subtitles. Both subtitle tracks must be
officially available for the current title, account, and region.

## Install from Chrome Web Store

[Install Streaming Bilingual Subtitles BETA](https://chromewebstore.google.com/detail/streaming-bilingual-subti/nmfpfghjmjekknbbilcpiioohkdjimfo)

## Supported platforms

- Netflix web player
- Max web player, including supported `hbomax.com` domains

## Install for local testing

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository folder.
5. Reload the Netflix or Max playback page.

## Use

1. Select the first subtitle normally in the streaming service.
2. Open **Bilingual subtitles** in the upper-right corner.
3. The extension briefly opens the platform subtitle menu to discover the
   subtitle languages available for that title.
4. Manually select the second subtitle in the extension.

Chrome displays a temporary debugging notification while the extension captures
the selected official subtitle response. The debugger is disconnected
automatically after capture.

## Privacy

Subtitle data is processed locally in the browser. The extension does not send
subtitle text, browsing history, account data, or usage analytics to the
developer or any third party. See [PRIVACY.md](PRIVACY.md).

## Beta release

Chrome Web Store submission materials are in [`store/`](store/). Run
`powershell -ExecutionPolicy Bypass -File scripts/package-beta.ps1` to validate
and create the upload ZIP after the required icons have been added.

## Limitations

- Available languages depend on the title, account, and region.
- Streaming platforms can change their player UI or subtitle delivery format.
- The extension does not bypass subscriptions, authentication, DRM, or regional
  restrictions and does not download video.

Netflix and Max are trademarks of their respective owners. This project is not
affiliated with or endorsed by either service.
