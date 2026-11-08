---
title: BindSite Explorer
emoji: 🧬
colorFrom: blue
colorTo: indigo
sdk: static
app_file: index.html
pinned: false
---

# BindSite Explorer

Residue-level binding-site prediction for metal ions, small molecules, DNA and RNA.

- **Explore** compares AdaBind, bindEmbed21DL and bindNode24 with experimental labels on TestSet300 (300 proteins)
  and TestSetNew46 (46 proteins), with the 3D structures.
- **Benchmarks** and **ROC & PR** show the test-set metrics.
- **Predict** runs the models on a new sequence. It needs the AI server; `config.json` says where it is
  (`"apiBaseUrl": null` here: not connected).

All data on this site are static files: the experimental labels and the frozen predictions of the three models.
