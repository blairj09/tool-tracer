# ToolTrace

A local, browser-only tool for tracing physical tools into scaled SVGs.

## Workflow

1. **Print the template.** Click "Print template", choose your paper size,
   and print at 100% scale ("Actual size" / no "Fit to page") — scaling the
   print will scale the markers and break the mm calibration.
2. **Verify the scale bar.** The template includes a 100 mm scale bar.
   Measure it with a ruler once your printer settles, and enter the value
   you measured back into the template page. ToolTrace divides that by 100
   to get a printer correction factor and applies it to future renders and
   to the rectification math, so a printer that runs slightly long or short
   doesn't throw off the final mm measurements.
3. **Place and photograph the tool.** Put it inside the grey working area,
   photograph straight down with all four ArUco corner markers visible,
   even lighting, no harsh shadows.
4. **Upload the photo.** ToolTrace detects the markers in your browser (via
   OpenCV.js), computes a homography, and rectifies the photo into true
   millimetre coordinates. If marker detection fails, fall back to the
   manual two-point scale flow (click two points a known distance apart).
5. **Tune the outline.** Adjust threshold/blur/morphology/simplify
   parameters until the traced outline matches the tool; click a specific
   blob in the photo to pick it out if more than one contour qualifies.
6. **Fix small tracing errors by hand.** Turn on "Edit vertices" (step 4)
   to drag points, click an edge to insert a new point, or alt-click /
   right-click a point to delete it — directly on the rectified photo, in
   mm coordinates. "Reset edits" discards hand edits and reverts to the
   traced outline.
7. **Export.** Set clearance offset, auto-alignment (rotates the tool so
   its long axis is horizontal), and margin, then download or copy the
   1:1 mm-scaled SVG.

No photo ever leaves your machine — everything (marker detection,
rectification, outline extraction, SVG export) runs client-side.

Don't have a printed template and tool handy? Step 2 has a **"Load sample
photo"** button that fetches a synthetic test image (an 80 × 30 mm
rectangle and a 12 mm circle on a template) and runs it through the same
pipeline, so you can try the whole flow immediately.

### Accuracy

Measured against the synthetic test image (`npm run synthetic-photo`),
end to end through marker detection, rectification, and outline
extraction:

- 80 × 30 mm target rectangle traced at 80.19 × 30.05 mm
- 12 mm target circle traced at 11.7 mm diameter
- mean marker-corner reprojection error: 0.28 px

## Development

```sh
npm install
npm run dev
```

### Development notes

- `npm test` — runs the pipeline unit/e2e tests (`test/**/*.test.ts`),
  headless, against a Node build of OpenCV.
- `npm run synthetic-photo` — not a real test; writes the synthetic test
  photo used by `test/pipeline.e2e.test.ts` to a BMP file so it can also be
  uploaded by hand through the UI. Needs `OUT=/path/to/photo.bmp`, e.g.:

  ```sh
  OUT=/tmp/synthetic.bmp npm run synthetic-photo
  ```

- `scripts/memory-probe.test.ts` — also not a real test; runs the pipeline
  a few times and logs the WASM heap size after each stage. Run it with
  `npm run synthetic-photo -- scripts/memory-probe.test.ts` (both are
  driven by `vitest.scripts.config.ts`, which is kept separate from
  `npm test` so these utilities never run as part of the real suite).

- **The React-dev-profiler/ImageData gotcha.** React 19.2's development
  build records a "Components" performance track. On every render where a
  component's props changed, it diffs old vs new props and recursively
  enumerates object values up to 3 levels deep, pushing one entry per key
  it walks. `Viewer` and `StepPanel` hold props containing `ImageData`
  (`rectified.image`, `outline.mask`, `photo.image`) and, once vertex
  editing is involved, polygons with hundreds of points — passed as plain
  props, the profiler ends up enumerating the pixel arrays themselves: one
  measured run hit 31,279,406 property entries for a single `Viewer`
  render and 15,840,034 for `StepPanel`, taking the heap from 84 MB to
  2.2 GB on one photo upload and crashing React with `DataCloneError:
  Failed to execute 'measure' on 'Performance': out of memory` followed by
  `Should not already be working`. This only happens under `npm run dev`
  (the profiler is stripped from production builds), but that's the
  intended way to run the app, so it has to be fixed rather than ignored.
  The fix is `src/lib/box.ts`: an opaque `Box<T>` wrapper (private field,
  so it has nothing enumerable) that every large buffer or big array is
  wrapped in before it's passed as a prop — components unwrap it with
  `.value`. See the comment above the `Box` usages in `src/App.tsx` for
  the full writeup.

## Multiple tools, components, arrange

A photo isn't limited to one tool anymore. Every blob above the "Min area"
threshold (Outline step) is auto-traced as its own tool, largest first;
click any untraced blob in the photo to add it by hand, and "Remove" on a
tool's row in the **Tools** step drops it (re-clicking its blob adds it
back). Selecting a tool highlights it in its own colour, both in the photo
overlay and on the arrange canvas — the same palette index is used
everywhere so a tool's colour never changes as you work.

**Components** are sub-regions of a tool — a knife's pocket clip, a
handle's grip — and live inside the selected tool's group in the export:

- **From photo** — click a point inside the tool and ToolTrace
  auto-thresholds a region around it (own threshold/invert/open/close/
  simplify controls, independent of the tool's own outline settings).
- **Draw** — click points directly on the photo to trace a component by
  hand; click the first point again (or double-click, or Enter) to close
  it.

Each component gets its own clearance offset (defaults to 0, so a tight
component like a pocket-clip pocket can stay untouched while the tool
outline gets its usual clearance). "Edit vertices" and "Reset edits" (Tools
step) act on whichever is currently selected — the tool itself, or one of
its components.

The mode bar above the photo viewer always shows what a click will do
(select, add a component from a photo point, draw a component, or edit
vertices) — Escape always returns to plain selection.

**Arrange** (new step, between Tools and Export) turns the export preview
into an interactive canvas: drag a tool to move it, drag its rotation
handle to spin it (hold Shift to snap to 15°), and optionally snap
movement to a 1 mm grid. "Auto-align" rotates the selected tool so its
long axis is horizontal; "Rotate 90°" and "Reset position" are also
per-tool. The combined SVG preserves whatever layout you leave the tools
in — the original photographed positions are just the starting point, not
the final word. Canvas size is "Auto" (fits the arranged tools plus
margin) or a fixed size in mm, e.g. to match a holder's footprint; a fixed
canvas that's too small warns in red both around the canvas rectangle and
in the Arrange step.

**Export** downloads the combined SVG (every tool as a named group, with
components nested inside it) or, once there's more than one tool, just
the selected tool re-exported and auto-centred on its own — handy for
CAD software that expects one part per file.
