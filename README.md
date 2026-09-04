# ToolTrace

A local, browser-only tool for tracing physical tools into scaled SVGs.

Workflow: print the marker template page ("Print template") at 100% scale
(no "fit to page"), place a tool inside the working area, photograph it so
all four ArUco corner markers are visible, then upload the photo in the app.
ToolTrace detects the markers in your browser (via OpenCV.js), computes a
homography to rectify the photo into true millimetre coordinates, extracts
the tool's outline, and lets you export a 1:1 mm-scaled SVG — with optional
clearance offset, auto-alignment, and manual vertex editing. Everything runs
client-side; no photo ever leaves your machine.

## Development

```sh
npm install
npm run dev
```
