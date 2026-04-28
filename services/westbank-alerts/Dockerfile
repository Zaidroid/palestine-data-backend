FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl tesseract-ocr tesseract-ocr-ara && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY dashboard.html ./dashboard.html
COPY tracker.html ./tracker.html
COPY map.html ./map.html
# Eval harness — same fixtures the operator runs in CI, exposed live
# via /quality/eval so the public can audit classifier FP rate.
COPY test_classifier_fp_audit.py ./eval_harness.py
COPY data/known_checkpoints.json ./data/known_checkpoints.json
COPY data/checkpoint_directory.json ./data/checkpoint_directory.json
COPY data/known_locations.json ./data/known_locations.json
COPY data/admin/admin1.geojson ./data/admin/admin1.geojson
COPY data/admin/admin2.geojson ./data/admin/admin2.geojson
COPY data/conflict/ ./data/conflict/
COPY seed_checkpoints.py ./seed_checkpoints.py

# Force rebuild when source files change
RUN find ./app -name "*.py" -newer /app/app/main.py -exec echo "Files updated" \; || true

# Sentry release tag — pass via --build-arg SENTRY_RELEASE=$(git rev-parse --short HEAD)
ARG SENTRY_RELEASE=""
ENV SENTRY_RELEASE=${SENTRY_RELEASE}

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
