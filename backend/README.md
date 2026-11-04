# BindSite backend

API dự đoán residue binding cho trang **Predict** của BindSite Explorer, theo hợp đồng ở mục 5 của tài liệu tích hợp.

```
UI (Angular, /predict)  ──/api──▶  dev-server proxy  ──▶  FastAPI :8000
                                                          ├─ kiểm tra input (30–400 aa, 20 amino acid chuẩn)
                                                          ├─ ESMFold API (cache theo sha1(sequence), kiểm tra chain A trùng sequence)
                                                          └─ predictor: mock (hiện tại) │ pbind (khi nhóm model giao)
```

## Chạy

Mở 2 terminal ở thư mục gốc repo:

```powershell
# 1. Backend
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --http h11

# 2. Frontend (host 127.0.0.1 và proxy /api đã cấu hình trong angular.json)
npm start
```

Mở http://127.0.0.1:4200/predict. Trong VS Code có thể dùng **Terminal → Run Task → `dev: backend + frontend`** để chạy cả hai.

> Phải gọi `python -m uvicorn` / `python -m pytest`, không gọi `uvicorn.exe` / `pytest.exe`: Smart App Control chặn các file `.exe` mà uv sinh ra.

## Endpoint

| Endpoint | Mô tả |
|---|---|
| `POST /predict` | `{"sequence", "binding_type"}` → kết quả theo mục 5. Thêm các trường `mock`, `timing`, `structure.cached` (không có trong hợp đồng). |
| `GET /health` | `status`, `model_version` (sha1 của `manifest.json`), `max_length`, và thêm `predictor`, `mock`, `profile`. |
| `GET /diagnostics` | Kết quả kiểm tra lúc khởi động, báo cáo `check_environment.py`, 50 warning/error gần nhất. UI hiển thị ở nút **Show diagnostics**. |
| `POST /client-log` | UI gửi lỗi phía trình duyệt về đây, để mọi lỗi nằm chung một file log. |

Lỗi trả về dạng `{"detail": "...", "code": "...", "request_id": "..."}`:

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `SEQUENCE_INVALID`, `REQUEST_INVALID` | sequence sai, `binding_type` sai, body không phải JSON |
| 413 | `SEQUENCE_TOO_LONG` | dài hơn 400 aa (giới hạn ESMFold API) |
| 502 | `ESMFOLD_FAILED` | ESMFold API lỗi/timeout, hoặc PDB trả về không khớp sequence |
| 503 | `PREDICTOR_UNAVAILABLE` | không load được manifest; `pbind` chưa cài; kiểm tra checksum/weight thất bại (khi dùng `pbind`) |
| 500 | `PREDICTOR_FAILED`, `INTERNAL_ERROR` | `pbind.predict` lỗi hoặc trả kết quả sai định dạng; lỗi không lường trước |

## Lỗi được ghi ở đâu

- `backend/logs/backend.log`: mọi request (kèm `request_id`), mọi lỗi kèm traceback, lỗi phía trình duyệt (logger `bindsite.client`). File xoay vòng 5 MB × 5.
- `backend/logs/environment_report.json`: kết quả `scripts/check_environment.py`.
- Trên UI: **Show diagnostics** ở trang Predict. Mỗi lỗi hiện kèm `request_id` để tra trong log.

Lúc khởi động backend tự kiểm tra: đọc `manifest.json`, so checksum toàn bộ checkpoint của profile (230 file, ~0.4 s), kiểm tra file weight có đủ và đúng dung lượng, rồi tạo predictor. Lỗi ở bước nào cũng **không làm sập server**: nó được ghi log, hiện trong `/diagnostics`, và `/health` trả `degraded`.

## Kiểm tra môi trường (load thật các model nền)

```powershell
cd backend
.venv\Scripts\python.exe scripts\check_environment.py              # ~1 phút
.venv\Scripts\python.exe scripts\check_environment.py --full-hash  # thêm sha256 của 6.7 GB weight
```

Script chạy ESM-2, ProtT5 (môi trường chính) và ESM-IF (môi trường `.venv-esmif`, qua `scripts/esmif_embed.py`) trên ubiquitin theo đúng thiết lập trong `FOUNDATION_MODELS.md`. Nó chỉ kiểm tra shape, giá trị hữu hạn và thời gian chạy. Đây **không phải** phép so với golden set: golden set cần feature lúc train do nhóm model cung cấp.

## Test

```powershell
cd backend
.venv\Scripts\python.exe -m pytest -q        # 69 test: validation, ESMFold client, checksum, predictor, API contract
cd ..
npx ng test --watch=false                    # 38 test frontend
```

## Khi nhóm model giao `pbind`

1. Cài vào môi trường chính: `& $env:USERPROFILE\.local\bin\uv.exe pip install --python .venv <đường dẫn pbind>` (hoặc theo hướng dẫn của nhóm model). Nếu `pbind` cần thêm thư viện native, kiểm tra xem Smart App Control có chặn không (xem bảng cuối).
2. Chạy `verify_installation.py` của nhóm model, phải ra PASS.
3. Chạy backend với `BINDSITE_PREDICTOR=pbind`:
   ```powershell
   $env:BINDSITE_PREDICTOR = "pbind"; .venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8000 --http h11
   ```
4. Banner "Demo predictions" trên UI sẽ biến mất. `/health` trả `"mock": false`.

`app/predictor.py` gọi `pbind.predict(sequence, binding_type=..., pdb=..., profile=..., weights_dir=..., final_model_dir=...)` đúng như mục 7. Nó kiểm tra kết quả trả về (đủ độ dài, nằm trong [0, 1], ngưỡng khớp manifest) trước khi trả cho UI.

## Cấu hình (biến môi trường)

| Biến | Mặc định |
|---|---|
| `BINDSITE_PREDICTOR` | `mock` (`pbind` khi đã cài) |
| `BINDSITE_PROFILE` | `final` |
| `BINDSITE_WEIGHTS_DIR` | `<repo>/model_weights` |
| `BINDSITE_FINAL_MODEL_DIR` | `<repo>/final_models/final_model` |
| `BINDSITE_CACHE_DIR` / `BINDSITE_LOG_DIR` | `backend/cache` / `backend/logs` |
| `BINDSITE_ESMIF_PYTHON` | `backend/.venv-esmif/Scripts/python.exe` |
| `ESMFOLD_URL`, `ESMFOLD_TIMEOUT` | ESM Atlas API, 90 s |
| `BINDSITE_MIN_LENGTH`, `BINDSITE_MAX_LENGTH` | 30, 400 |

Backend tự đặt `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `TORCH_HOME=model_weights/torch_home` (mục 4). `model_weights/torch_home/hub/checkpoints/esm_if1_gvp4_t16_142M_UR50.pt` là **hardlink** tới `model_weights/esm_if1/…`, nên không tốn thêm dung lượng.

## Môi trường trên máy này (khác tài liệu ở đâu và vì sao)

| | Tài liệu | Máy này | Lý do |
|---|---|---|---|
| Phần cứng | GPU NVIDIA | **CPU** (AMD Radeon 860M, không có CUDA) | 3 model nền vẫn chạy: ESM-2 0.5 s, ProtT5 1.1 s, ESM-IF 0.7 s cho 76 aa |
| Hệ điều hành | Linux/WSL2 | Windows, venv | Theo yêu cầu: không dùng WSL |
| Python | — | 3.11.9 (chính), 3.10.11 (ESM-IF), bản chính thức có ký số từ python.org | **Smart App Control** đang bật, chặn file `.exe`/DLL chưa có chữ ký hoặc ít người dùng |
| torch (chính) | — | 2.9.1+cpu | torch 2.14.1 bị Smart App Control chặn; 2.4.1–2.9.1 chạy được |
| ProtT5 | fp16 trên GPU | fp32 trên CPU | CPU không chạy fp16. Cần golden set để xác nhận lệch nằm trong ngưỡng (cosine ≥ 0.999) |
| torch-scatter (ESM-IF) | 2.1.2 | DLL bị chặn, dùng stand-in thuần PyTorch | Encoder ESM-IF không gọi hàm nào của torch-scatter (xem `scripts/esmif_embed.py`), nên embedding không đổi |
| httptools | (uvicorn[standard]) | không dùng, chạy `--http h11` | bị Smart App Control chặn |
| Tên file weight | `model.safetensors`, `pytorch_model.bin` | đã đổi từ `model-001.*` cho đúng tên | `from_pretrained` chỉ tìm tên chuẩn. sha256 khớp tài liệu |

Cài lại từ đầu (Python lấy từ python.org vì bản do uv tải về bị chặn; `uv` nằm ở `%USERPROFILE%\.local\bin\uv.exe`):

```powershell
cd backend
Set-Alias uv $env:USERPROFILE\.local\bin\uv.exe
uv venv .venv --python $env:LOCALAPPDATA\Programs\Python\Python311\python.exe
uv venv .venv-esmif --python $env:LOCALAPPDATA\Programs\Python\Python310\python.exe
uv pip install --python .venv --index-strategy unsafe-best-match -r requirements.txt
uv pip install --python .venv-esmif --index-strategy unsafe-best-match -r requirements-esmif.txt
```
