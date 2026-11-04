---
title: BindSite Explorer
emoji: 🧬
colorFrom: blue
colorTo: indigo
sdk: static
pinned: false
---

# BindSite Explorer

## AdaBind — Protein Binding Residue Prediction Explorer

An interactive platform for exploring protein structures, residue-level binding predictions, and benchmark performance across metal ions, nucleic acids, and small molecules.

### Features

- 🔬 **3D Protein Visualization** - Mol* viewer with residue-level confidence and binding-site overlays
- 📈 **ROC & Precision–Recall** - Compare reported method metrics by ligand class and benchmark set
- 🧬 **Sequence or PDB Prediction** - Paste a sequence or upload a PDB structure (chain A)
- 🎯 **Binding Site Analysis** - Residue-level prediction, confidence, and experimental labels
- 🌓 **Theme Support** - Dark mode by default, with a light-mode option
- 📊 **Benchmark Datasets** - TestSet300 and TestSetNew46

### Technology Stack

- Angular 22
- Mol* for 3D visualization
- ECharts for data visualization
- RxJS for reactive programming

### Data and deployment notes

- Explore structures and residue-level predictions are demonstration data; they should not be interpreted as experimentally validated predictions.
- TestSet300 ROC/PR curves are reconstructed from the reported AUPRC/AUROC values. TestSetNew46 curves are approximate visual reconstructions from the reference figure because raw per-residue benchmark scores are not included.
- The Predict page requires the FastAPI backend in `backend/`; a static Hugging Face Space does not run that API. Configure a reachable API service/proxy to enable sequence prediction and PDB upload in the hosted app.

### Usage

Navigate through the platform to explore protein structures, compare prediction methods, and analyze binding sites.

---

Built with Angular | Deployed on Hugging Face Spaces
