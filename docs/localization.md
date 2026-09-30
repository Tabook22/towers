# Arabic and English interface

The language control is available on the login page and in the main toolbar, including on phones. The selection is stored in this browser as `iip_language`; a first visit follows an Arabic browser preference or defaults to English. Switching changes labels and layout without remounting the inspection form or submitting its draft.

Arabic uses right-to-left document direction, the MUI RTL styling cache and Arabic component messages. Date displays use the chosen language with Latin digits; saved dates, measurements and identifiers retain their existing formats. The noticeboard follows the same interface language; its individual notice language remains a content setting.

## Translation boundaries

- Translate interface labels and known choices at display time with `tr` from `src/i18n`.
- Keep English API enum values, database fields, position identities, tower names, filenames, report references and user-entered content unchanged. A translated option's `value` must remain canonical.
- Use `inspectionValue(field, value)` in change reviews so a note or manufacturer named “Normal” is never mistaken for a screening choice.
- Use positional placeholders for variable data. Never translate or rewrite interpolated user content.
- The customer-owned term `shed pending` is intentionally retained verbatim pending clarification.
- Existing customer report templates and generated document content are not translated by changing the interface language. Word previews retain the document's reading direction. Stored branding coordinates are physical coordinates and must not be mirrored.

## Terminology

| English | Arabic |
| --- | --- |
| Inspection position | موضع الفحص |
| Insulator string | سلسلة العوازل |
| Phase | الطور |
| Hotspot | بقعة ساخنة |
| Severity | درجة الخطورة |
| Confidence | درجة الثقة |
| Emissivity | معامل الانبعاثية |
| Thermal image | صورة حرارية |
| Visual / RGB image | صورة مرئية |

The Arabic catalog is `frontend/src/i18n/ar.json`. Unknown text falls back to its original text, including unrecognized server errors, rather than inventing a translation. Server diagnostics and user-authored notices, messages and documents may consequently appear in their original language.

Run `npm test` and `npm run build` in `frontend` when changing translations. The localization tests check static translation coverage, placeholder preservation, language persistence, the glossary and the boundary between translated choices and inspection data. Also verify a draft survives switching languages, Arabic menus open on the correct side, narrow layouts fit, and the original values are submitted by translated dropdowns.
