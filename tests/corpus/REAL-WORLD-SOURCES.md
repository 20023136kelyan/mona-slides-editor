# Real-world PPTX fidelity fixtures

The binary files listed below live in `tests/corpus/private/`. That directory is intentionally gitignored and outside every Vite public directory because the decks contain third-party presentation content or protected NASA branding. They are local parser/rendering fixtures, not project assets, training data, or examples for redistribution.

Retrieved 2026-07-18. Apache POI sources are pinned to commit `913c78891bd0cd20945b050c63abfb8c66c88009` rather than the moving `trunk` branch.

## Selected fixtures

### `real-01-powerpoint-native-charts-stress.pptx`

- Source: [Apache POI test data](https://raw.githubusercontent.com/apache/poi/913c78891bd0cd20945b050c63abfb8c66c88009/test-data/slideshow/aascu.org_workarea_downloadasset.aspx_id%3D5864.pptx)
- Upstream filename: `aascu.org_workarea_downloadasset.aspx_id=5864.pptx`
- SHA-256: `5df09eff2c5fbb2bea72971421dc5507d68cab10ce3af8791969fdee35e76991`
- OOXML authorship metadata: Microsoft Office PowerPoint 12; creator `Ron Ferguson`.
- Coverage: 34 slides, 6 masters, 73 layouts, 8 themes, 8 native chart parts, and 3 embedded workbooks. Charts include a bar/line combo, a standalone line chart, a 3-D bar chart, and multi-series bar charts with up to 5 series and legends. Also contains 2 tables with 18 raw merge attributes, 25 rotated transforms, 26 slides with timing markup, one transition, and footer/slide-number placeholders inherited from its templates.
- Why private: the file is present in the Apache POI repository, but the presentation itself contains identifiable third-party institutional content and branding. Redistribution rights were not independently verified.

### `real-02-powerpoint-native-pie-chart.pptx`

- Source: [Apache POI test data](https://raw.githubusercontent.com/apache/poi/913c78891bd0cd20945b050c63abfb8c66c88009/test-data/slideshow/pie-chart.pptx)
- Upstream filename: `pie-chart.pptx`
- SHA-256: `3b6404b59b24cb79fbb91fc2e92bd8b80cdc340aeed71a1ec1e267db0d8ad444`
- OOXML authorship metadata: Microsoft Office PowerPoint 14; creator `yegor`.
- Coverage: 1 slide with a native pie chart, legend, one series, and an embedded workbook. This is the minimal control fixture for pie-chart import.
- Why private: kept with the other external fixtures until the redistribution status of individual POI test documents is explicitly confirmed.

### `real-03-nasa-sewp-corporate.pptx`

- Source page: [NASA SEWP training files](https://sewp.nasa.gov/documents/training/sewp.shtml)
- Direct source: [SEWP Training Slides dated 2025-05-12](https://sewp.nasa.gov/documents/training/SEWP_Training_Slides_05_12_25.pptx)
- SHA-256: `49393aafa1cc93f8f442ab8aa53d4facd686dcd5259141c78e7f6688ebbabaa5`
- OOXML authorship metadata: Microsoft Office PowerPoint 16.
- Coverage: 18 slides, 2 masters, 8 layouts, 3 themes, repeated branded structure, slide numbers, 48 media files, 28 hyperlink references backed by 9 relationships, 2 tables with merged cells, 5 groups, 8 image crops, 3 notes slides, and 2 transitions.
- Why private: NASA makes the file publicly downloadable for training, but NASA identifiers are protected and the deck may contain third-party media. Use only as a local fidelity fixture; do not imply NASA endorsement.

### `real-04-powerpoint-design-smartart-notes.pptx`

- Source: [Apache POI test data](https://raw.githubusercontent.com/apache/poi/913c78891bd0cd20945b050c63abfb8c66c88009/test-data/slideshow/60810.pptx)
- Upstream filename: `60810.pptx`
- SHA-256: `61afceb0365523ceba6fc00a525157148c2ddbdb3b5d843992ac3c107e9921bf`
- OOXML authorship metadata: Microsoft Office PowerPoint 16; creator `Ellipsis +44 20 76912400`.
- Coverage: 28 slides, 4 SmartArt objects (20 diagram XML parts), 17 notes slides including 6 with substantive speaker notes, bullet levels through `lvl=3`, 1 group, 12 image crops, 5 shadows, 7 alpha effects, 17 media files, and slide-number placeholders.
- Why private: the deck contains identifiable commercial presentation content. Redistribution rights were not independently verified.

## Rights notes

The Apache POI repository is distributed under the [Apache License 2.0](https://github.com/apache/poi/blob/trunk/legal/LICENSE), but some slideshow fixtures appear to originate as real-world bug samples. Their presence in the repository is not treated here as proof that every embedded logo, image, or presentation has separately cleared redistribution rights.

NASA says its content is generally usable for educational or informational purposes, but NASA insignia, logotypes, and identifiers are not public domain, and some NASA pages contain third-party copyrighted material. See the [NASA images and media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).

## Integrity check

Verify all local fixtures from the repository root:

```sh
shasum -a 256 tests/corpus/private/*.pptx
for deck in tests/corpus/private/*.pptx; do unzip -t "$deck"; done
```

Generate the machine-readable package inventory used by Gate 7:

```sh
npm run corpus:inspect
```
