# BindSite backend

API dự đoán residue binding cho trang **Predict** của BindSite Explorer. Model: gói `adabind/`
(`pbind` + 140 checkpoint, 5 loại ligand). Hợp đồng API: mục 5 của `adabind/docs/APP_INTEGRATION.md`.

```
UI (Angular :4200, /predict) ──/api──▶ dev-server proxy ──▶ FastAPI :8000
  ├─ kiểm tra input (30–1000 aa khi có ESMFold local, 30–400 khi chỉ có API; 20 amino acid chuẩn)
  ├─ cấu trúc: ESMFold v1 tự host (foundation_models/esmfold_v1)  ──lỗi──▶  ESM Atlas API (dự phòng, ≤ 400 aa)
  │            cache theo sha1(sequence) + nguồn (.json), chain A phải trùng sequence
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
bash backend/setup_env.sh               # .venv (torch 2.14.1+cu126) + .venv-esmif (python 3.10 qua conda, torch 2.4.1+cu121)
npm ci --legacy-peer-deps               # frontend (Node ≥ 22.22 / 24.15; máy này: ~/.local/bin/node 24.22)
```

`setup_env.sh --cuda cpu` cho máy không có GPU NVIDIA. Thư mục model:

```
Protein-Ligand-Binding_New/
├── adabind/final_model/        140 checkpoint + manifest.json   (BINDSITE_FINAL_MODEL_DIR)
├── adabind/golden_set/         12 protein kiểm tra              (BINDSITE_GOLDEN_DIR)
└── foundation_models/          (BINDSITE_WEIGHTS_DIR)
    ├── esm2_t33_650M_UR50D/  prot_t5_xl_half_uniref50-enc/  esm_if1/  torch_home/
    └── esmfold_v1/             tự host ESMFold (8,4 GB) — có thư mục này thì dùng local trước, API là dự phòng
```

## Chạy

```bash
# terminal 1 — backend
cd backend && .venv/bin/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
# terminal 2 — frontend
npm start
```

Mở http://127.0.0.1:4200/predict. VS Code: **Terminal → Run Task → `dev: backend + frontend`**.

Lúc khởi động, backend trả lời `/health` ngay, rồi chạy **self-test ở nền** (~40–60 s lần đầu): load ESMFold và fold
1 protein golden (so RMSD Cα với PDB lúc train), load ESM-2 / ProtT5 / worker ESM-IF / 140 checkpoint và so 1
protein golden với embedding + dự đoán tham chiếu. Request `/predict` gửi trong lúc đó sẽ chờ cho xong.

- Self-test của model binding **không đạt** → `/health` = `degraded`, `/predict` trả 503 (số sai mà không báo lỗi
  còn tệ hơn không có số).
- ESMFold local **không đạt** (hoặc load lỗi) → tắt local, chỉ dùng API (giới hạn tự hạ về 400 aa). Dịch vụ vẫn chạy.

## Chọn GPU / CPU cho từng model

Mỗi model có biến riêng; không đặt thì lấy `BINDSITE_DEVICE`; không đặt nữa thì `cuda` nếu có, ngược lại `cpu`.
Giá trị: `cpu`, `cuda`, `cuda:N`.

| Biến | Model | Ghi chú khi chạy CPU |
|---|---|---|
| `BINDSITE_DEVICE_ESMFOLD` | ESMFold v1 (tự host) | rất chậm (vài phút/protein); ESM-2 3B bên trong chạy fp32 thay vì fp16 |
| `BINDSITE_DEVICE_ESM2` | ESM-2 650M | fp32 như lúc train, nhanh |
| `BINDSITE_DEVICE_PROTT5` | ProtT5-XL | fp32 thay fp16 (đúng cách `pbind` làm); chậm hơn |
| `BINDSITE_DEVICE_ESMIF` | ESM-IF1 (worker) | fp32 như lúc train |
| `BINDSITE_DEVICE_MODELS` | 140 checkpoint + feature | nhanh |
| `BINDSITE_DEVICE` | mặc định cho tất cả | |

Ví dụ: `BINDSITE_DEVICE_ESMFOLD=cpu BINDSITE_DEVICE_PROTT5=cpu .venv/bin/python -m uvicorn ...`.
`/health` trả `devices` (UI hiện chip GPU / CPU, rê chuột để xem từng model).

**Bộ nhớ GPU** (đo trên RTX 4090): ESMFold 8,4 GB + 0,9 GB (343 aa) / 2,6 GB (600 aa) / 4,7 GB (813 aa) / 7 GB
(1000 aa) lúc fold; ESM-2 + ProtT5 + checkpoint ~6,9 GB; worker ESM-IF ~1,7 GB. Tổng ~19 GB cho chuỗi 400 aa. GPU
dùng chung với process khác có thể hết bộ nhớ với chuỗi dài: khi đó ESMFold local báo lỗi và backend dùng API
(≤ 400 aa) hoặc báo 413. Thời gian fold local: 2–10 s tới 343 aa, ~40 s ở 600 aa, ~90 s ở 813 aa, ~170 s ở 1000 aa.

## Kiểm tra — từ nhanh tới kỹ

```bash
cd backend
.venv/bin/python -m pytest -q                         # ~120 test (~2 phút): API, ESMFold local/API, worker, checkpoint thật
BINDSITE_TEST_ESMFOLD=1 .venv/bin/python -m pytest -q tests/test_esmfold_local_real.py   # load ESMFold thật
.venv/bin/python scripts/check_environment.py --full-hash   # sha256 model nền, ESMFold, self-test, 5 loại ligand (~1,5 phút)
.venv/bin/python scripts/verify_golden_e2e.py         # 12 protein golden, CHỈ từ sequence: fold mới → dự đoán → so lúc train
cd .. && npx ng test --watch=false                    # 41 test frontend
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
| `POST /predict` | `{"sequence", "binding_type"}` → kết quả theo mục 5. Thêm: `mock`, `warnings`, `timing` (`esmfold_s`, `esm_s`, `prott5_s`, `esmif_s`, `model_s`, …), `structure.source` (`local` \| `esmatlas`), `structure.cached`, `structure.fallback_reason`. |
| `GET /health` | `status`, `model_version`, `max_length` (theo nguồn cấu trúc hiện có) + `binding_types`, `thresholds`, `devices`, `structure_source`, `esmfold_local`, `self_test`. |
| `GET /diagnostics` | Kết quả kiểm tra lúc khởi động + self-test, lần fold local/API gần nhất, `environment_report.json`, 50 warning/error gần nhất. UI: **Show diagnostics**. |
| `POST /predict-pdb` | `{"pdb", "binding_type"}`: dự đoán trên cấu trúc người dùng upload (chỉ chain A), **không** gọi ESMFold. Sequence và pLDDT (B-factor của CA, thang 0–100 được đổi về 0–1) đọc từ file; giới hạn 30–1000 aa (giới hạn của model, không phải của ESMFold API). Trả về giống `/predict`, với `structure.source` = `upload`. |
| `POST /client-log` | UI gửi lỗi phía trình duyệt về log backend. |

Embedding được cache trong RAM theo (sequence, PDB): đổi loại ligand cho cùng protein chỉ tốn thời gian chạy checkpoint (<2 s).

Lỗi trả về dạng `{"detail", "code", "request_id"}`:

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `SEQUENCE_INVALID`, `REQUEST_INVALID` | sequence sai, `binding_type` sai, body không phải JSON |
| 400 | `PDB_INVALID` | `/predict-pdb`: file không có dòng ATOM, hoặc chain A trống |
| 413 | `SEQUENCE_TOO_LONG` | dài hơn giới hạn (1000 với ESMFold local, 400 với API) |
| 502 | `ESMFOLD_FAILED` | ESMFold local lỗi **và** API lỗi/timeout (API được thử lại tối đa 3 lần trong 110 s), hoặc PDB không khớp sequence |
| 503 | `PREDICTOR_UNAVAILABLE` | manifest/checkpoint/weight lỗi, hoặc self-test golden không đạt |
| 500 | `PREDICTOR_FAILED`, `INTERNAL_ERROR` | `pbind` / ESM-IF lỗi, kết quả sai định dạng; lỗi không lường trước |

Log: `backend/logs/backend.log` (xoay vòng 5 MB × 5), mỗi dòng kèm `request_id`.

## Cấu hình (biến môi trường)

| Biến | Mặc định |
|---|---|
| `BINDSITE_PREDICTOR` | `pbind` (`mock` = xác suất giả, để làm UI không cần model) |
| `BINDSITE_PROFILE` | `final` |
| `BINDSITE_WEIGHTS_DIR` | `<repo>/foundation_models` |
| `BINDSITE_FINAL_MODEL_DIR` / `BINDSITE_GOLDEN_DIR` | `<repo>/adabind/final_model` / `<repo>/adabind/golden_set` |
| `BINDSITE_ESMFOLD_LOCAL` | `auto` (dùng `esmfold_v1` nếu có) \| `off` (chỉ API) |
| `BINDSITE_DEVICE`, `BINDSITE_DEVICE_<ESMFOLD\|ESM2\|PROTT5\|ESMIF\|MODELS>` | xem mục chọn GPU / CPU |
| `BINDSITE_MIN_LENGTH`, `BINDSITE_MAX_LENGTH` | 30; 1000 khi có ESMFold local, 400 khi không |
| `BINDSITE_WARMUP` | `1` (self-test lúc khởi động; `0` = model load ở request đầu) |
| `BINDSITE_ESMIF_PYTHON`, `BINDSITE_ESMIF_TIMEOUT` | `backend/.venv-esmif/bin/python`, 300 s |
| `ESMFOLD_URL`, `ESMFOLD_TIMEOUT`, `ESMFOLD_ATTEMPTS`, `ESMFOLD_BACKOFF`, `ESMFOLD_TOTAL_TIMEOUT` | ESM Atlas API, 90 s/lần, 3 lần, 3 s, 110 s tổng |
| `BINDSITE_CACHE_DIR` / `BINDSITE_LOG_DIR` | `backend/cache` / `backend/logs` |

Backend tự đặt `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `TORCH_HOME=foundation_models/torch_home`.

## Khác với tài liệu của nhóm model ở đâu (và vì sao)

| | Tài liệu | Ở đây | Lý do |
|---|---|---|---|
| ESMFold | API, tự host là tuỳ chọn | tự host trước, API dự phòng | API công khai hay trả 504 sau ~30 s (đo ngày 05/11/2026: 30–80 s hoặc lỗi; local 2–10 s) |
| Load ESMFold | `.cuda()` rồi `esm.half()` | `esm.half()` trên CPU rồi mới lên GPU | cùng trọng số và phép tính; đỉnh VRAM 8,5 GB thay vì ~14 GB |
| TF32 (ESMFold) | bật toàn cục | chỉ bật trong lúc fold (dưới khoá GPU) | ESM-2/ProtT5/checkpoint chạy chung process và lúc train không dùng TF32 |
| ESM-IF | subprocess mỗi request | 1 worker chạy lâu (`scripts/esmif_worker.py`) | load model 1,7 GB một lần; tự khởi động lại nếu worker chết |
| Python ESM-IF | 3.10 | 3.10 từ conda (máy không có python3.10 hệ thống) | |
