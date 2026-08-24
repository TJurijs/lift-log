# Browser support policy

Lift Log targets evergreen browsers with native ES modules, dynamic import, modern Grid/Flexbox, `dvh`, safe-area environment variables, and current form/accessibility behavior.

Minimum supported versions for the current review target:

| Platform | Minimum |
| --- | --- |
| iPhone/iPad Safari | iOS/iPadOS 17.4 |
| Android Chrome | Chrome 120 |
| Desktop Chrome / Edge | 120 |
| Desktop Firefox | 121 |
| Desktop Safari | 17.4 |

The normal pull-request gate runs the repository's pinned Playwright Chromium, Firefox, and WebKit engines. Before a release, test the oldest supported iOS Safari and Android Chrome versions on real devices plus the current stable versions. Include touch, safe areas, soft keyboard, browser Back, offline/reconnect, reduced motion, 200% text/zoom reflow where available, VoiceOver, and TalkBack.

Internet Explorer, legacy EdgeHTML, Android WebView shells that do not meet the Chrome floor, and embedded in-app browsers are not supported. Unsupported browsers should still receive the sign-in page where possible, but critical training/session behavior is not guaranteed.
