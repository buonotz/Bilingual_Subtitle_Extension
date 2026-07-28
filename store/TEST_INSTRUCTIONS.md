# Reviewer test instructions

## Requirements

- Google Chrome on desktop
- A valid Netflix or Max account supplied by the reviewer
- A title that offers at least two official subtitle languages

No developer credentials are required or provided.

## Test procedure

1. Install the extension and open a supported Netflix or Max playback page.
2. Start a title that offers at least two official subtitle languages.
3. In the platform player, select the first official subtitle language.
4. Select **Bilingual subtitles** in the upper-right corner.
5. The extension briefly opens the platform's official subtitle menu and lists
   the subtitle languages available for the current title.
6. Manually select a different language under **Second subtitle**.
7. Chrome displays a temporary notification that the extension has started
   debugging the browser. This is expected.
8. Confirm that the platform subtitle remains visible and that the extension
   displays the second official subtitle above it.
9. Seek to another point in the video and test fullscreen mode.

## Expected permission behavior

The Debugger API attaches only after step 6, observes subtitle network responses
in the current tab, and disconnects automatically after the capture window. No
captured data is uploaded.

## Notes

- Subtitle availability varies by title, account, and region.
- The extension does not provide or bypass access to Netflix or Max content.
- If a title exposes only one official subtitle track, a second language cannot
  be displayed.
