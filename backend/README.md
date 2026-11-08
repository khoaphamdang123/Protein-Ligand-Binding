# BindSite backend

API dự đoán residue binding cho trang **Predict** của BindSite Explorer. Model: gói `adabind/`
(`pbind` + 140 checkpoint). Hợp đồng API: mục 5 của `adabind/docs/APP_INTEGRATION.md`. Trang **Explore** không cần
backend (xem [Dữ liệu trang Explore](#dữ-liệu-trang-explore)).

Nhãn ligand trên cả hai trang là **metal, small molecule, DNA, RNA**. Backend vẫn nhận `nuclear` (DNA hoặc RNA) qua API,
nhưng giao diện không hiện lựa chọn đó.

```
UI (Angular :4200, /predict) ──/api──▶ dev-server proxy ──▶ FastAPI :8000
  ├─ kiểm tra input (30–1000 aa, 20 amino acid chuẩn)
  ├─ cấu trúc, dừng ở nguồn đầu tiên có kết quả, chain A luôn phải trùng sequence:
  │    1. foundation_models/esmfold_files (tra theo sequence), rồi cấu trúc đã fold trước đó (backend/cache/esmfold)
  │    2. ESM Atlas API (≤ 400 aa)
  │    3. ESMFold v1 tự host. Trên máy này và trong Docker: CPU (BINDSITE_DEVICE_ESMFOLD=cpu), fold nền từng protein
  │       một, request trả ngay 202 STRUCTURE_FOLDING và UI hỏi lại mỗi 10 s. Trên GPU: trong request, chỉ khi GPU
  │       còn đủ chỗ
  │    4. không nguồn nào được: lỗi STRUCTURE_UNAVAILABLE, UI mời tự fold rồi upload PDB
  ├─ embedding: ESM-2 650M, ProtT5-XL (nuclear/small/dna/rna)  — trong .venv
  │             ESM-IF1                                         — worker chạy lâu trong .venv-esmif
  └─ pbind.Predictor: feature + checkpoint của loại ligand → xác suất từng residue → so ngưỡng manifest
```

| `binding_type` | nghĩa | ckpt | ngưỡng |
|---|---|---|---|
| `metal` | ion kim loại | 5 | 0,9148 |
| `small` | phân tử nhỏ | 40 | 0,4901 |
| `nuclear` | DNA **hoặc** RNA | 35 | 0,7079 |
| `dna` | riêng DNA (dòng model riêng) | 30 | 0,5643 |
| `rna` | riêng RNA (dòng model riêng) | 30 | 0,7772 |

## Cài (Linux, một lần)

```bash
cd /home/hien/Protein_Ligand_Binding_newest/Protein-Ligand-Binding_New
unzip adabind_*.zip -d adabind          # nếu chưa giải nén
unzip baselines_2124_*.zip -d .         # bindEmbed21DL + bindNode24: kết quả đóng băng, weight, script (Explore)
bash backend/setup_env.sh               # .venv (torch 2.14.1+cu126) + .venv-esmif (python 3.10 qua conda, torch 2.4.1+cu121)
npm ci --legacy-peer-deps               # frontend (Node ≥ 22.22 / 24.15; máy này: ~/.local/bin/node 24.22)
```

`setup_env.sh --cuda cpu` cho máy không có GPU NVIDIA. Thư mục model và dữ liệu (đều không commit):

```
Protein-Ligand-Binding_New/
├── adabind/final_model/        140 checkpoint + manifest.json   (BINDSITE_FINAL_MODEL_DIR)
├── adabind/golden_set/         12 protein kiểm tra              (BINDSITE_GOLDEN_DIR)
├── baselines_2124/             21 + 24: frozen_predictions/, results_frozen/, canonical/, weight
├── explore_sources/            file gốc cho Explore, tải bằng fetch_sources.py (31 file, 20 MB)
└── foundation_models/          (BINDSITE_WEIGHTS_DIR)
    ├── esm2_t33_650M_UR50D/  prot_t5_xl_half_uniref50-enc/  esm_if1/  torch_home/
    ├── esmfold_files/          4080 PDB ESMFold lúc train (BINDSITE_ESMFOLD_FILES_DIR)
    └── esmfold_v1/             tự host ESMFold (8,4 GB), nguồn cấu trúc thứ ba (CPU trên máy này)
```

| Cần | Lấy ở đâu |
|---|---|
| `foundation_models/esmfold_files` | Drive `esmFold_pdb_files` (id `1rFsO2hJG7zby2K_FMI-VBoKI-t2aw-Q6`), 702 MB. Thiếu thì chỉ mất bước 1 của chuỗi cấu trúc. |
| `baselines_2124_*.zip` | Drive, file `1ekif5bZzysLAP5qvUAg82IBPYEbHYspR` (đã có sẵn ở thư mục gốc repo) |
| `explore_sources/` | `fetch_sources.py`, kiểm sha256 từng file |

## So sánh 3 model trên trang Predict

Sau khi có kết quả AdaBind, chọn **Compare with bindEmbed21DL and bindNode24**: trang gọi `POST /compare` với đúng sequence
và cấu trúc của kết quả đó, rồi hiện AdaBind ở trên, hai model kia chia đôi ở dưới, xoay chung và chọn residue chung.
Chạy thật, không có ground truth, nên trang chỉ cho thấy các model đồng ý ở đâu. Explore thì khác: dùng dự đoán đóng băng.

```bash
bash backend/setup_env.sh --only baselines   # .venv-baselines: torch 2.2.2 CPU, torch-geometric 2.5.0, numpy<2 (1,2 GB)
```

`baselines_2124/` giữ weight (5 checkpoint bindEmbed21DL, 5 state_dict bindNode24). Hai model chạy trong
`scripts/baseline_worker.py`, khởi động ở lần so sánh đầu (~2 s), mỗi protein dưới 1 s trên CPU. ProtT5 dùng chung với AdaBind:
với metal, AdaBind không cần ProtT5 nên lần so sánh đầu mất thêm vài giây. Thiếu môi trường thì nút Compare không hiện,
dịch vụ vẫn chạy.

Đầu ra của hai model theo ligand: metal → metal, small → small, DNA và RNA → đầu ra nucleic-acid (không tách được DNA/RNA).
Ngưỡng 0,5.

Cấu trúc cho bindNode24 (bindEmbed21DL chỉ dùng sequence; AdaBind giữ ESMFold vì được train trên ESMFold):

1. **AlphaFold DB**, tra theo đúng sequence (`/api/sequence/summary`). Có thì dùng: bindNode24 được công bố trên cấu trúc
   AlphaFold. Chỉ khớp khi trùng tuyệt đối (đổi 1 residue là không có); nhiều entry cùng sequence thì chọn cố định: entry
   của chính accession UniProt trong header FASTA (`>sp|P0CG48|…`, `>Q9K943 …`) trước, rồi mã UniProt, rồi model cũ trước.
   Đo trên 40 protein TestSet300, entry của chính accession gần file AlphaFold mà bindNode24 được chấm nhất (trung vị
   0,79 Å Cα RMSD; entry gần nhất có thể 0,77 Å; không entry nào trùng khít, vì file đó cũ hơn model AlphaFold DB hiện tại).
   Cache ở `backend/cache/alphafold`, cả "không có" (1 tuần).
2. Không có, mạng lỗi, hoặc người dùng upload PDB → cấu trúc của kết quả AdaBind.

Cấu trúc AlphaFold được chồng (Kabsch theo Cα) lên khung toạ độ của cấu trúc AdaBind trước khi hiển thị, để 3 khung xoay
cùng nhau; khoảng cách không đổi nên đồ thị 17 Å của bindNode24 không đổi. Panel ghi entry đã dùng. AlphaFold DB không fold
sequence mới: không có API công khai nào cho việc đó. Tắt bước tra: `BINDSITE_ALPHAFOLD_DB=0`.

```bash
cd backend && BINDSITE_DEVICE=cpu .venv/bin/python scripts/verify_baselines.py --split TestSet300 --alphafold-dir <thư mục PDB AlphaFold>
```

So worker với `baselines_2124/frozen_predictions` theo tiêu chí của gói đó (Spearman ≥ 0,999). PDB AlphaFold lấy ở Drive
`repos/bindnode24/dataset/AlphaFold_predictions`. Kết quả đo trên TestSet300 (06/11/2026):

| | Spearman | residue đổi kết luận ở 0,5 |
|---|---|---|
| bindEmbed21DL (300 protein) | ≥ 0,99999 | ≤ 0,002 % |
| bindNode24 trên AlphaFold (177 protein) | 1,00000 | ≤ 0,003 % |
| bindNode24 trên ESMFold (300 protein, tức cách trang Predict chạy) | 0,994–0,995 | 0,04–0,25 % |

Dòng cuối không phải lỗi: cùng code nhưng khác cấu trúc đầu vào, nên số live của bindNode24 lệch nhẹ so với số công bố.

## Chạy

```bash
# terminal 1 — backend, mọi model trên CPU
cd backend && BINDSITE_DEVICE=cpu .venv/bin/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
# terminal 2 — frontend
npm start
```

Mở http://127.0.0.1:4200/predict. VS Code: **Terminal → Run Task → `dev: backend + frontend`** (đã đặt `BINDSITE_DEVICE=cpu`).

Lúc khởi động, backend trả lời `/health` ngay, rồi chạy **self-test ở nền** (~30 s): lập chỉ mục `esmfold_files`
(lần đầu ~5 s, sau đó đọc lại, chỉ dựng lại khi thư mục đổi), load ESM-2 / ProtT5 / worker ESM-IF / 140 checkpoint và so
1 protein golden với embedding + dự đoán tham chiếu. Request `/predict` gửi trong lúc đó sẽ chờ cho xong.

- Self-test của model binding **không đạt** → `/health` = `degraded`, `/predict` trả 503 (số sai mà không báo lỗi
  còn tệ hơn không có số).
- ESMFold local không phải điều kiện để dịch vụ chạy. Lần đầu được dùng, nó load và fold thử 1 protein golden (so RMSD
  Cα với PDB lúc train); fold thử sai → tắt hẳn đến lần khởi động sau. Trên CPU việc này chạy *sau* self-test của model
  binding (~3,5 phút, trong lúc đó Predict vẫn dùng được); trên GPU thì chạy trước, và GPU bận thì bỏ qua.

## Chọn GPU / CPU cho từng model

Trên máy này mọi thứ chạy CPU, không bao giờ dùng GPU (máy được mượn CPU 128 luồng + 128 GB RAM; GPU của job khác):
`scripts/app.sh` đặt `BINDSITE_DEVICE=cpu`, `BINDSITE_DEVICE_ESMFOLD=cpu` và `CUDA_VISIBLE_DEVICES=""`; Docker image đặt
hai biến đầu. Mỗi model có biến riêng; không đặt thì lấy `BINDSITE_DEVICE`; không đặt nữa thì `cuda` nếu có, ngược lại
`cpu`. Giá trị: `cpu`, `cuda`, `cuda:N`.

Riêng **ESMFold local không theo `BINDSITE_DEVICE`**: không đặt `BINDSITE_DEVICE_ESMFOLD` thì nó là bước dự phòng trên
GPU (`cuda`), chỉ load khi GPU trống ít nhất `BINDSITE_ESMFOLD_MIN_FREE_GB` (10 GB, đọc bằng `nvidia-smi`).

**ESMFold trên CPU** (đo 08/11/2026 trên máy này, EPYC 7742, 64 luồng, lúc job training cũng đang chạy): load 4 s,
~20 GB RAM khi fold; 147 aa 206 s, 299 aa 694 s; cấu trúc lệch so với PDB lúc train (fold trên GPU) 0,002 / 0,008 Å Cα,
pLDDT ≤ 0,010. Chuỗi dài hơn mất cỡ nửa giờ đến hơn một giờ. Vì vậy fold CPU chạy nền: không giữ khoá GPU (các dự đoán
khác vẫn chạy), một protein một lúc, kết quả vào cache `backend/cache/esmfold`; rời trang thì fold vẫn tiếp tục.

| Biến | Model | Ghi chú khi chạy CPU |
|---|---|---|
| `BINDSITE_DEVICE_ESMFOLD` | ESMFold v1 (tự host) | đặt rõ `cpu`; vài phút mỗi protein, chạy nền; ESM-2 3B bên trong chạy fp32 thay vì fp16 |
| `BINDSITE_DEVICE_ESM2` | ESM-2 650M | fp32 như lúc train, nhanh |
| `BINDSITE_DEVICE_PROTT5` | ProtT5-XL | fp32 thay fp16 (đúng cách `pbind` làm); chậm hơn |
| `BINDSITE_DEVICE_ESMIF` | ESM-IF1 (worker) | fp32 như lúc train |
| `BINDSITE_DEVICE_MODELS` | 140 checkpoint + feature | nhanh |
| `BINDSITE_DEVICE` | mặc định cho tất cả, trừ ESMFold | |

`/health` trả `devices` và `structure_sources`; UI hiện một dòng trạng thái gồm thiết bị và chuỗi nguồn cấu trúc.

**Bộ nhớ GPU** (đo trên RTX 4090): ESMFold 8,4 GB + 0,9 GB (343 aa) / 2,6 GB (600 aa) / 4,7 GB (813 aa) / 7 GB
(1000 aa) lúc fold; ESM-2 + ProtT5 + checkpoint ~6,9 GB; worker ESM-IF ~1,7 GB. Tổng ~19 GB cho chuỗi 400 aa. GPU
dùng chung với process khác có thể hết bộ nhớ với chuỗi dài: khi đó ESMFold local báo lỗi và UI mời upload PDB.
Thời gian fold local: 2–10 s tới 343 aa, ~40 s ở 600 aa, ~90 s ở 813 aa, ~170 s ở 1000 aa.

## Kiểm tra — từ nhanh tới kỹ

```bash
cd backend
.venv/bin/python -m pytest -q                         # ~120 test (~2 phút): API, ESMFold local/API, worker, checkpoint thật
BINDSITE_TEST_ESMFOLD=1 .venv/bin/python -m pytest -q tests/test_esmfold_local_real.py   # load ESMFold thật
.venv/bin/python scripts/check_environment.py --full-hash   # sha256 model nền, cấu trúc có sẵn, ESMFold, self-test (~1,5 phút)
.venv/bin/python scripts/verify_golden_e2e.py         # 12 protein golden, CHỈ từ sequence: API/GPU → dự đoán → so lúc train
.venv/bin/python scripts/explore_data/build.py        # dựng lại Explore + đối chiếu số công bố (không ghi nếu có lỗi)
cd .. && npx ng test --watch=false                    # test frontend
```

Kiểm tra của nhóm model (`adabind/scripts/verify_installation.py`, cần ESM-IF golden tính trong `.venv-esmif` bằng
`adabind/scripts/esmif_embed.py --golden-dir ...`): trên máy này **[2] pipeline lệch ≤ 1,4e-7, [3] cosine embedding
1,00000**. Hai FAIL còn lại không do cài đặt:

- `[1] manifest.json version`: golden set được tạo trước khi thêm DNA/RNA vào manifest (README của adabind có nói).
- `[4] nuclear` lệch 0,062 ở P06956: lệch này có sẵn ngay trong golden set (`pipeline_final_nuclear` vs
  `training_final_nuclear`), kể cả khi dùng chính embedding lúc train; embedding tính trên máy này chỉ thêm ≤ 0,0006.

## Endpoint

| Endpoint | Mô tả |
|---|---|
| `POST /predict` | `{"sequence", "binding_type"}` → kết quả theo mục 5. Thêm: `mock`, `warnings`, `timing` (`esmfold_s`, `esm_s`, `prott5_s`, `esmif_s`, `model_s`, …), `structure.source` (`precomputed` \| `esmatlas` \| `local`), `structure.cached`, `structure.detail` (tên file có sẵn), `structure.fallback_reason`. |
| `GET /health` | `status`, `model_version`, `max_length` + `binding_types`, `thresholds`, `devices`, `structure_source`, `structure_sources` (trạng thái từng nguồn), `esmfold_local`, `self_test`. |
| `GET /diagnostics` | Kết quả kiểm tra lúc khởi động + self-test, lần fold local/API gần nhất, `environment_report.json`, 50 warning/error gần nhất. UI: **Show diagnostics**. |
| `POST /predict-pdb` | `{"pdb", "binding_type"}`: dự đoán trên cấu trúc người dùng upload (chỉ chain A), **không** gọi ESMFold. Sequence và pLDDT (B-factor của CA, thang 0–100 được đổi về 0–1) đọc từ file; giới hạn 30–1000 aa (giới hạn của model, không phải của ESMFold API). Trả về giống `/predict`, với `structure.source` = `upload`. |
| `POST /compare` | `{"sequence", "pdb", "binding_type", "alphafold"}`: bindEmbed21DL và bindNode24, không fold. bindNode24 dùng model AlphaFold DB của sequence nếu có (`alphafold: false` cho PDB upload), không thì `pdb`. Trả `models.<tên>.{probability, binding, threshold, output, structure}`. |
| `POST /client-log` | UI gửi lỗi phía trình duyệt về log backend. |

Embedding được cache trong RAM theo (sequence, PDB): đổi loại ligand cho cùng protein chỉ tốn thời gian chạy checkpoint (<2 s).

Lỗi trả về dạng `{"detail", "code", "request_id"}`:

| HTTP | `code` | Khi nào |
|---|---|---|
| 202 | `STRUCTURE_FOLDING` | không phải lỗi: ESMFold trên CPU đang fold sequence này (hoặc đang xếp hàng). Thêm trường `folding` = `{length, stage: queued\|folding, ahead, device, waited_s, folding_s, fallback_reason}`. Gửi lại đúng request đó sau ít giây; khi xong thì nhận kết quả bình thường |
| 400 | `SEQUENCE_INVALID`, `REQUEST_INVALID` | sequence sai, `binding_type` sai, body không phải JSON |
| 400 | `PDB_INVALID` | `/predict-pdb`: file không có dòng ATOM, hoặc chain A trống |
| 413 | `SEQUENCE_TOO_LONG` | dài hơn 1000 aa (giới hạn của model) |
| 502 | `STRUCTURE_UNAVAILABLE` | không có trong `esmfold_files`, API lỗi/timeout hoặc > 400 aa (API thử lại tối đa 3 lần trong 110 s), ESMFold local không chạy được. `detail` liệt kê lý do của từng nguồn. UI: nút upload PDB |
| 503 | `PREDICTOR_UNAVAILABLE` | manifest/checkpoint/weight lỗi, hoặc self-test golden không đạt |
| 503 | `BASELINES_UNAVAILABLE` | `/compare`: chưa có `.venv-baselines` hoặc `baselines_2124` |
| 500 | `PREDICTOR_FAILED`, `BASELINES_FAILED`, `INTERNAL_ERROR` | `pbind` / ESM-IF / worker baseline lỗi, kết quả sai định dạng; lỗi không lường trước |

Log: `backend/logs/backend.log` (xoay vòng 5 MB × 5), mỗi dòng kèm `request_id`.

## Cấu hình (biến môi trường)

| Biến | Mặc định |
|---|---|
| `BINDSITE_PREDICTOR` | `pbind` (`mock` = xác suất giả, để làm UI không cần model) |
| `BINDSITE_PROFILE` | `final` |
| `BINDSITE_WEIGHTS_DIR` | `<repo>/foundation_models` |
| `BINDSITE_FINAL_MODEL_DIR` / `BINDSITE_GOLDEN_DIR` | `<repo>/adabind/final_model` / `<repo>/adabind/golden_set` |
| `BINDSITE_ESMFOLD_FILES_DIR` | `<weights>/esmfold_files` (cấu trúc có sẵn, tra theo sequence) |
| `BINDSITE_ESMFOLD_LOCAL` | `auto` (dùng `esmfold_v1` nếu có) \| `off` |
| `BINDSITE_ESMFOLD_MIN_FREE_GB` | 10 (GPU phải trống ngần này thì ESMFold local mới load) |
| `BINDSITE_DEVICE`, `BINDSITE_DEVICE_<ESMFOLD\|ESM2\|PROTT5\|ESMIF\|MODELS>` | xem mục chọn GPU / CPU |
| `BINDSITE_MIN_LENGTH`, `BINDSITE_MAX_LENGTH` | 30; 1000 |
| `BINDSITE_WARMUP` | `1` (self-test lúc khởi động; `0` = model load ở request đầu) |
| `BINDSITE_ESMIF_PYTHON`, `BINDSITE_ESMIF_TIMEOUT` | `backend/.venv-esmif/bin/python`, 300 s |
| `BINDSITE_BASELINES_PYTHON`, `BINDSITE_BASELINES_DIR` | `backend/.venv-baselines/bin/python`, `<repo>/baselines_2124` |
| `BINDSITE_ALPHAFOLD_DB`, `BINDSITE_ALPHAFOLD_DB_URL` | `1` (tra AlphaFold DB cho bindNode24), `https://alphafold.ebi.ac.uk` |
| `ESMFOLD_URL`, `ESMFOLD_TIMEOUT`, `ESMFOLD_ATTEMPTS`, `ESMFOLD_BACKOFF`, `ESMFOLD_TOTAL_TIMEOUT` | ESM Atlas API, 90 s/lần, 3 lần, 3 s, 110 s tổng |
| `BINDSITE_CACHE_DIR` / `BINDSITE_LOG_DIR` | `backend/cache` / `backend/logs` |

Backend tự đặt `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `TORCH_HOME=foundation_models/torch_home`.

## Khác với tài liệu của nhóm model ở đâu (và vì sao)

| | Tài liệu | Ở đây | Lý do |
|---|---|---|---|
| ESMFold | API, tự host là tuỳ chọn | cấu trúc có sẵn, rồi API, rồi tự host trên GPU còn chỗ | protein trong bộ dữ liệu không cần fold lại; GPU máy này dùng chung; API công khai hay trả 504 sau ~30 s nên có retry |
| Load ESMFold | `.cuda()` rồi `esm.half()` | `esm.half()` trên CPU rồi mới lên GPU | cùng trọng số và phép tính; đỉnh VRAM 8,5 GB thay vì ~14 GB |
| TF32 (ESMFold) | bật toàn cục | chỉ bật trong lúc fold (dưới khoá GPU) | ESM-2/ProtT5/checkpoint chạy chung process và lúc train không dùng TF32 |
| ESM-IF | subprocess mỗi request | 1 worker chạy lâu (`scripts/esmif_worker.py`) | load model 1,7 GB một lần; tự khởi động lại nếu worker chết |
| Python ESM-IF | 3.10 | 3.10 từ conda (máy không có python3.10 hệ thống) | |

## Dữ liệu trang Explore

`public/explore-data/` là file tĩnh, không cần backend: `index.json` (tập, ngưỡng, metric toàn tập, danh sách protein),
`proteins/<id>.json` (nhãn, xác suất, gọi nhãn và metric của 3 model cho từng ligand), `structures/<id>.pdb.gz`.

```bash
backend/.venv/bin/python backend/scripts/explore_data/fetch_sources.py   # 31 file từ Drive, kiểm sha256
backend/.venv/bin/python backend/scripts/explore_data/fetch_names.py     # tên protein: UniProt, mã đã gộp, rồi UniParc
backend/.venv/bin/python backend/scripts/explore_data/build.py           # kiểm chéo rồi mới ghi
```

`build.py` chỉ ghi khi mọi bước kiểm tra đạt (hiện 477 bước, tái tạo 348 số đã công bố với sai số < 1e-9):

- sequence: FASTA chuẩn = FASTA của bộ nhãn = chữ cái trong file AdaBind = chain A của PDB ESMFold
- nhãn: file `binding_residues_*` = `y_true` của AdaBind = TP+FN từng protein của baseline
- DNA / RNA: nhãn nuclear theo residue giữ nguyên; BioLiP2 cho biết protein gắn loại nào
  (`adabind/decisions/evaluation_bootstrap_B10000/DNA_RNA_PROTEIN_KINDS.csv`): kind `dna`/`both` → nhãn DNA = nhãn nuclear,
  `rna`/`both` → nhãn RNA = nhãn nuclear, còn lại 0. Kết quả trùng `y_true` của AdaBind và `y_dna | y_rna == nuclear`.
  Trên 300 và 46 không có protein `unknown` nên không residue nào bị mask.
- baseline: TP/FP/TN/FN, precision, recall, F1, MCC từng protein ở ngưỡng 0,5 = `FULL_DIRECT_PER_PROTEIN_300_46.csv`
- metric toàn tập của cả 3 model = `CI_ALL_8_METRICS_B10000.csv`, `SUMMARY.csv`, `FULL_DIRECT_BASELINE_METRICS_300_46.csv`
- ngưỡng: `manifest.json` = `FINAL_MODELS.json` = `FINAL_DECISION.json` = bảng CI

Quy ước so sánh: AdaBind dùng ngưỡng đã chốt trên DevSet1010, baseline dùng 0,5. Vì vậy chỉ AUPRC và AUROC so trực tiếp
được; precision/recall/F1/MCC là hai điểm hoạt động khác nhau (trang có ghi chú). Hai baseline không tách DNA/RNA nên
output nucleic-acid của họ được chấm với nhãn DNA và RNA, đúng như bảng CI.

DevSet1010 không có trên trang: đó là tập phát triển của cả 3 model, muốn so công bằng phải dùng dự đoán out-of-fold của
từng model (chưa tải), và số trên đó là cross-validation chứ không phải held-out.
