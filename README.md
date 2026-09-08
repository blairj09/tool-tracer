# ToolTrace

ToolTrace turns a photo of a tool into a flat outline you can use to design a holder for it. You print a page, put your tool on it, take a photo, and ToolTrace traces the outline and gives you an SVG file sized to the real tool, in millimeters.

Everything happens in your web browser. Your photo is never sent anywhere — all the work happens on your own computer.

## How to use it

1. **Print the template.** Click "Print template" and print the page at 100% size (do not let your printer "fit to page" — that changes the size).
2. **Check the scale bar.** The page has a line marked "100 mm". Measure it with a ruler and type in what you measured. This fixes any small stretching from your printer.
3. **Take a photo.** Put your tool inside the gray box on the page. Take the photo from straight above, with good light, and make sure all four corner squares are visible.
4. **Upload the photo.** ToolTrace finds the four corner squares and uses them to figure out the exact scale and straighten out the photo. If it can't find them, you can pick two points on the photo yourself and type in the real distance between them instead.
5. **Adjust the outline if needed.** A "Threshold" slider controls what counts as the tool versus the background — it's usually set automatically. A "Cleanup" slider smooths out rough edges. A "Show mask" button lets you see exactly what's being traced.
6. **Fix small mistakes by hand.** Turn on "Edit vertices" to drag points on the outline, add new points, or remove ones you don't want.
7. **Download your file.** Set how much extra space (clearance) you want around the tool, then download the SVG file.

Don't have a tool and printer handy? Click "Load sample photo" to try the whole process with a built-in example.

### Tracing more than one tool

You can put several tools on one page. ToolTrace finds each one automatically. Click any tool in the photo to add it if it was missed, or remove ones you don't want.

You can also trace a smaller part *inside* a tool — like a pocket clip on a knife — by clicking inside it or drawing around it by hand.

Before downloading, you can drag and rotate each tool to arrange them however you like. This doesn't change their size — it just changes where they sit in the final file.

### How accurate is it?

In testing, an 80 × 30 mm rectangle was traced at 80.19 × 30.05 mm, and a 12 mm circle came out at 11.7 mm. Close enough for building a snug holder.

## Running it yourself

You'll need [Node.js](https://nodejs.org) installed. Then:

```sh
npm install
npm run dev
```

This starts the app on your computer. Open the address it prints in your browser.

To run the automated tests:

```sh
npm test
```
