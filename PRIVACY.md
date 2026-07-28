# Privacy Policy

**Streaming Bilingual Subtitles**  
Effective date: July 28, 2026

## Summary

Streaming Bilingual Subtitles processes subtitle information locally in the
user's browser so that two official subtitle tracks can be displayed at the
same time on supported streaming websites.

The extension does not collect, store, sell, share, or transmit personal data,
browsing history, account information, subtitle text, or usage analytics to the
developer or to third parties.

## Information accessed

When the user manually selects a second subtitle language, the extension:

- reads the subtitle languages displayed by the current Netflix or Max player;
- temporarily uses the Chrome Debugger API to inspect the current tab's network
  responses and identify the selected official subtitle response;
- parses the subtitle response locally and displays it over the current video;
- reads the current video's playback time to synchronize subtitle cues.

This access is limited to supported Netflix and Max pages and is used only to
provide the extension's bilingual subtitle feature.

## Data storage and transmission

- Subtitle text and playback information are processed in memory on the user's
  device.
- No user data is sent to a developer-operated server.
- No analytics, advertising, tracking, or fingerprinting services are used.
- The extension does not sell or share user data.
- The extension does not retain subtitle text after the page or extension
  session ends.

## Chrome Debugger API

The Debugger API is activated only after the user manually selects a second
subtitle. Chrome may display a notification while it is active. The extension
uses it only to inspect subtitle network responses in the current supported
streaming tab and disconnects automatically after the short capture period.

## Third-party services

The extension operates on Netflix and Max pages. Use of those services remains
subject to their respective terms and privacy policies. The extension does not
send additional information to those services beyond requests already required
by their web players to load official subtitles.

## User choices

Users can stop all extension processing by leaving the supported playback page,
disabling the extension, or uninstalling it from Chrome.

## Changes

Material changes to this policy will be published in this repository and, where
required, disclosed in the Chrome Web Store listing before the changed data
practice is introduced.

## Contact

For privacy questions or deletion requests, open an issue at:

https://github.com/buonotz/Bilingual_Subtitle_Extension/issues

## Limited Use statement

The use of information received from Chrome APIs adheres to the Chrome Web Store
User Data Policy, including the Limited Use requirements.
