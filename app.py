from flask import send_from_directory, Flask, render_template, request, jsonify
from flask_cors import CORS
import os
import zipfile
import numpy as np
import pandas as pd
from pathlib import Path
from PIL import Image
import torch
import clip
from sklearn.metrics.pairwise import cosine_similarity
from glob import glob

# --------------------------
# CONFIG
# --------------------------
BASE_DIR = Path.cwd()
PRODUCT_ZIP = BASE_DIR / "Product.zip"
DATASET_DIR = BASE_DIR / "dataset_images"
EMBED_DIR = BASE_DIR / "embeddings"
META_FILE = BASE_DIR / "master_metadata.xlsx"

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

# --------------------------
# CREATE FOLDERS
# --------------------------
DATASET_DIR.mkdir(exist_ok=True)
EMBED_DIR.mkdir(exist_ok=True)

# --------------------------
# AUTO-EXTRACT PRODUCT.ZIP
# --------------------------
if PRODUCT_ZIP.exists() and not any(DATASET_DIR.iterdir()):
    print("Extracting Product.zip → dataset_images...")
    with zipfile.ZipFile(PRODUCT_ZIP, 'r') as z:
        z.extractall(DATASET_DIR)
    print("Extraction complete.")
else:
    if not PRODUCT_ZIP.exists():
        print("⚠️ Product.zip not found!")
    else:
        print("dataset_images already contains files — skipping extraction.")

# --------------------------
# LOAD METADATA
# --------------------------
print("Loading metadata Excel...")
meta_df = pd.read_excel(META_FILE, engine="openpyxl")
meta_df.columns = [c.strip() for c in meta_df.columns]

style_col = None
for c in meta_df.columns:
    if "style" in c.lower():
        style_col = c
        break

meta_df[style_col] = meta_df[style_col].astype(str)
meta_df.set_index(style_col, drop=False, inplace=True)

print(f"Metadata loaded. Using style column: {style_col}")

# --------------------------
# LOAD CLIP MODEL
# --------------------------
device = "cuda" if torch.cuda.is_available() else "cpu"
print("Using device:", device)

model, preprocess = clip.load("ViT-B/32", device=device)
model.eval()

# --------------------------
# LOAD DATASET IMAGE PATHS
# --------------------------
image_exts = (".jpg", ".jpeg", ".png", ".webp", ".bmp")

dataset_image_paths = sorted([
    Path(p) for p in glob(str(DATASET_DIR / "**" / "*"), recursive=True)
    if Path(p).suffix.lower() in image_exts
])

print(f"Found {len(dataset_image_paths)} dataset images.")

# --------------------------
# BUILD OR LOAD EMBEDDINGS
# --------------------------
def compute_embedding(img_path):
    image = preprocess(Image.open(img_path).convert("RGB")).unsqueeze(0).to(device)
    with torch.no_grad():
        emb = model.encode_image(image)
        emb = emb / emb.norm(dim=-1, keepdim=True)
    return emb.cpu().numpy()

EMBED_FILE = EMBED_DIR / "dataset_embeds.npy"
NAMES_FILE = EMBED_DIR / "dataset_names.npy"

if EMBED_FILE.exists() and NAMES_FILE.exists():
    print("Loading cached embeddings...")
    dataset_embeds = np.load(EMBED_FILE)
    dataset_names = np.load(NAMES_FILE, allow_pickle=True)
else:
    print("Computing dataset embeddings (first time)...")
    names = []
    embeds = []
    for p in dataset_image_paths:
        try:
            e = compute_embedding(p)
            embeds.append(e[0])
            names.append(str(p.relative_to(DATASET_DIR)))
        except:
            print("Skipping unreadable file:", p)

    dataset_embeds = np.vstack(embeds)
    dataset_names = np.array(names, dtype=object)

    np.save(EMBED_FILE, dataset_embeds)
    np.save(NAMES_FILE, dataset_names)

print("Embeddings ready:", len(dataset_names))

# ---------------------------------------------------
# ROUTES
# ---------------------------------------------------
@app.route("/")
def home():
    return render_template("index.html")

@app.route("/details")
def details_page():
    return render_template("details.html")

# ---------------------------------------------------
# API — MATCH QUERY IMAGE
# ---------------------------------------------------
@app.route("/match", methods=["POST"])
def match_image():
    if "image" not in request.files:
        return jsonify({"error": "No file received"}), 400

    file = request.files["image"]
    img = Image.open(file).convert("RGB")

    # Query embedding
    qimg = preprocess(img).unsqueeze(0).to(device)
    with torch.no_grad():
        q = model.encode_image(qimg)
        q = q / q.norm(dim=-1, keepdim=True)
    q = q.cpu().numpy()

    # Similarity
    sims = cosine_similarity(q, dataset_embeds)[0]
    top_indices = sims.argsort()[::-1][:5]

    results = []
    for idx in top_indices:
        relpath = dataset_names[idx].replace("\\", "/")
        score = float(sims[idx])
        style_no = Path(relpath).stem

        # --- FIX 1: replace NaN with None ---
        if style_no in meta_df.index:
            row = meta_df.loc[style_no].fillna("")
            details = row.to_dict()
        else:
            details = {}

        # --- FIX 2: ensure all values are JSON safe ---
        for k, v in details.items():
            if v != v:   # NaN check
                details[k] = None

        results.append({
            "image_path": relpath,
            "score": score,
            "details": details
        })

    # Always valid JSON now
    return jsonify({"results": results})

# ---------------------------------------------------
@app.route('/dataset_images/<path:filename>')
def serve_dataset_images(filename):
    return send_from_directory(DATASET_DIR, filename)

# ---------------------------------------------------
if __name__ == "__main__":
    app.run(debug=True)
