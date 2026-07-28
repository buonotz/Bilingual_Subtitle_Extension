# Chrome Web Store privacy form

Use these answers as a draft and verify every dashboard question against the
submitted build.

## Single purpose

Display a second official subtitle track alongside the subtitle already selected
by the user in supported Netflix and Max web players.

## Permission justification: debugger

The extension temporarily attaches the Chrome Debugger API only after the user
manually selects a second subtitle language. It uses the Network domain to read
the selected official subtitle response from the current supported streaming
tab, parses it locally, and detaches automatically after a short capture period.
It does not inspect unrelated tabs, execute remote code, or transmit captured
data.

## Host permission justification

Access to the listed Netflix, Max, and HBO Max domains is required to discover
the official subtitle languages shown by their web players, synchronize subtitle
cues with the current video, and render the second subtitle on the playback page.
The extension does not run on other websites.

## Data-use declarations

- Personally identifiable information: not collected
- Health information: not collected
- Financial and payment information: not collected
- Authentication information: not collected
- Personal communications: not collected
- Location: not collected
- Web history: not collected or transmitted; the current supported page is
  accessed only to provide the user-facing subtitle feature
- User activity: current playback time is processed locally and not retained or
  transmitted
- Website content: official subtitle responses are processed locally, are not
  retained after the session, and are not transmitted
- Analytics, advertising, profiling, or sale of data: none

## Remote code

No. All executable JavaScript is packaged with the extension. Network subtitle
responses are treated only as subtitle data and are not executed as code.

## Limited Use

The extension's use of information received from Chrome APIs complies with the
Chrome Web Store User Data Policy, including the Limited Use requirements.
