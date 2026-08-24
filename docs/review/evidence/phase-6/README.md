# Phase 6 mobile and visual evidence

Captured on 2026-08-24 from the loopback nonproduction app connected to the audited hosted-development Supabase project. The reproducible read-only capture entry point is `node scripts/capture-review-evidence.mjs`; it refuses non-loopback app origins and does not emit credentials.

- [Calendar desktop, 1440 × 900](calendar-desktop-1440x900.png)
- [Calendar mobile, 360 × 800](calendar-mobile-360x800.png)
- [Exercise library mobile with native filters, 360 × 800](exercises-mobile-native-filters-360x800.png)

Deliberate differences from Phase 0:

- Calendar cells are no longer nested interactive controls.
- Touch/coarse layouts use a full-size native day target and an identifiable selected-day agenda.
- Calendar and bottom-navigation text is larger, and frequent touch controls use a 44 px minimum.
- Signed-in content, bottom navigation, dialogs, and toasts account for safe-area insets.
- Exercise category and planned/actual RPE controls use native selects with explicit accessible names.

Automated viewport coverage passed at 320, 360, 390, 430, and 768 CSS pixels in mobile Chromium and iPhone/WebKit. Real iPhone Safari/VoiceOver and Android Chrome/TalkBack/soft-keyboard checks remain a manual release gap.
