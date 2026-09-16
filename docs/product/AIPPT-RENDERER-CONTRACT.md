# AIPPT HTML Renderer Element Contract

The HTML renderer is the source of truth for Designer hit targets. `buildHtmlDeck()` always normalizes the incoming `DeckPlan` with `normalizePlanLayouts(plan, config)` before rendering, so callers cannot bypass Spec Lock route writeback.

Structured templates emit stable semantic anchors where the element exists in the final HTML:

- `data-aippt-element="eyebrow"`
- `data-aippt-element="title"`
- `data-aippt-element="headline"`
- `data-aippt-element="bullets"`
- `data-aippt-element="visual"`

`slide.design.elements[key].visible === false` removes that semantic element from structured HTML. Safe style fields are applied inline when present: `zIndex`, `fontSize`, `color`, `fontWeight`, and `align`. `locked` is metadata only and is emitted as `data-aippt-locked="true|false"`; it must not change browser behavior.

Current structured coverage includes cover, section, metrics, compare/matrix, diagram/architecture, process, timeline, checklist, quote, and the default two-column branch.
