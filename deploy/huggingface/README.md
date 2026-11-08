---
title: BindSite Explorer
emoji: 🧬
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8080
pinned: false
---

# BindSite Explorer

Residue-level binding-site prediction for metal ions, small molecules, DNA and RNA.

- **Explore** compares AdaBind, bindEmbed21DL and bindNode24 with experimental labels on TestSet300 and TestSetNew46.
- **Predict** runs AdaBind on your sequence or PDB, and can compare it with bindEmbed21DL and bindNode24.

The Space runs the image `<dockerhub-user>/bindsite` (web page and API on port 8080, all models on the CPU).
