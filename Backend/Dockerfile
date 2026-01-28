# ---------- Builder stage ----------
    FROM python:3.12-slim AS builder

    ENV DEBIAN_FRONTEND=noninteractive
    
    WORKDIR /build
    
    RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        libxml2-dev \
        libxslt1-dev \
        zlib1g-dev \
        curl \
        && rm -rf /var/lib/apt/lists/*
    
    COPY requirements.txt .
    
    RUN pip install --upgrade pip \
     && pip wheel --no-cache-dir --no-deps -r requirements.txt -w /wheels
    
    # ---------- Runtime stage ----------
    FROM python:3.12-slim
    
    ENV PYTHONDONTWRITEBYTECODE=1 \
        PYTHONUNBUFFERED=1 \
        PYTHONPATH=/app \
        DEBIAN_FRONTEND=noninteractive
    
    WORKDIR /app
    
    # Only runtime libs (NO compilers)
    RUN apt-get update && apt-get install -y --no-install-recommends \
        libxml2 \
        libxslt1.1 \
        zlib1g \
        curl \
        && rm -rf /var/lib/apt/lists/*
    
    COPY --from=builder /wheels /wheels
    
    RUN pip install --upgrade pip \
     && pip install --no-cache-dir /wheels/* \
     && pip install --no-cache-dir gunicorn
    
    COPY . .
    
    RUN mkdir -p /app/chapter_assets /app/staticfiles /app/media \
     && useradd -m -u 1000 django \
     && chown -R django:django /app
    
    USER django
    
    EXPOSE 8000
    
    HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
        CMD curl -f http://localhost:8000/admin/ || exit 1
    
    CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn base.wsgi:application --bind 0.0.0.0:8000 --workers 2 --timeout 120"]
    