# Beta release checklist

## Developer account

- [ ] Chrome Web Store developer registration completed
- [ ] Contact email verified
- [ ] Google Account two-step verification enabled
- [ ] Trusted tester Google Account emails collected

## Package

- [ ] `manifest.json` version increased
- [ ] Extension name ends with `BETA`
- [ ] 16, 32, 48, and 128 px PNG icons added under `icons/`
- [ ] `manifest.json` includes the icon paths
- [ ] Local unpacked build tested on Netflix
- [ ] Local unpacked build tested on Max
- [ ] Fullscreen and seeking tested
- [ ] `scripts/package-beta.ps1` completes successfully
- [ ] Generated ZIP opens with `manifest.json` at its root

## Store listing

- [ ] English listing copied from `LISTING_EN.md`
- [ ] Simplified Chinese listing copied from `LISTING_ZH_CN.md`
- [ ] Category confirmed in the dashboard
- [ ] At least one 1280×800 or 640×400 screenshot uploaded
- [ ] 128×128 store icon uploaded
- [ ] 440×280 small promotional tile uploaded
- [ ] Screenshots contain no private account details
- [ ] Netflix/Max trademarks are not presented as endorsement

## Privacy and review

- [ ] `PRIVACY.md` published at a publicly accessible URL
- [ ] Privacy form completed using `PRIVACY_FORM.md`
- [ ] Single-purpose statement entered
- [ ] Debugger permission justification entered
- [ ] Host-permission justification entered
- [ ] Reviewer instructions copied from `TEST_INSTRUCTIONS.md`
- [ ] All declarations rechecked against the submitted ZIP

## Distribution

- [ ] Visibility set to **Private**
- [ ] Only trusted testers selected
- [ ] Geographic distribution selected
- [ ] Submit for review
