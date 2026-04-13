FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY dashboard.html ./dashboard.html
COPY data/known_checkpoints.json ./data/known_checkpoints.json
COPY data/checkpoint_directory.json ./data/checkpoint_directory.json
COPY seed_checkpoints.py ./seed_checkpoints.py

# Force rebuild when source files change
RUN find ./app -name "*.py" -newer /app/app/main.py -exec echo "Files updated" \; || true

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
