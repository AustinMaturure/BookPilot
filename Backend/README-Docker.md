# Docker Setup for BookPilot Backend

## Quick Start

### Development

```bash
cd Backend
docker-compose up --build
```

The backend will be available at `http://localhost:8000`

### Production

1. Create a `.env` file in the `Backend` directory:

```bash
DEBUG=0
SECRET_KEY=your-production-secret-key-here
ALLOWED_HOSTS=bookpilot.netlify.app your-domain.com
CORS_ALLOWED_ORIGINS=https://bookpilot.netlify.app
OPENAI_API_KEY=your-openai-api-key
DATABASE_URL=sqlite:///db.sqlite3
```

2. Build and run:

```bash
docker-compose up -d --build
```

## Environment Variables

- `DEBUG`: Set to `0` for production, `1` for development
- `SECRET_KEY`: Django secret key (required)
- `ALLOWED_HOSTS`: Space-separated list of allowed hostnames
- `CORS_ALLOWED_ORIGINS`: Space-separated list of allowed CORS origins
- `OPENAI_API_KEY`: Your OpenAI API key
- `DATABASE_URL`: Database connection string (defaults to SQLite)

## Volumes

The following directories are mounted as volumes:
- `./chapter_assets`: User-uploaded chapter assets
- `./db.sqlite3`: SQLite database file
- `./media`: Media files (if using file uploads)
- `./staticfiles`: Collected static files

## Health Check

The container includes a health check that pings `/pilot/api/books/` every 30 seconds.

## Production Considerations

1. **Use PostgreSQL**: Replace SQLite with PostgreSQL for production
2. **Set DEBUG=0**: Always disable debug mode in production
3. **Use strong SECRET_KEY**: Generate a secure secret key
4. **Configure proper ALLOWED_HOSTS**: Only include your production domain
5. **Set up proper CORS**: Only allow your frontend domain
6. **Use environment variables**: Never hardcode secrets

## Building the Image

```bash
docker build -t bookpilot-backend .
```

## Running the Container

```bash
docker run -p 8000:8000 \
  -e SECRET_KEY=your-secret-key \
  -e ALLOWED_HOSTS=bookpilot.netlify.app \
  -e CORS_ALLOWED_ORIGINS=https://bookpilot.netlify.app \
  -e OPENAI_API_KEY=your-key \
  -v $(pwd)/chapter_assets:/app/chapter_assets \
  -v $(pwd)/db.sqlite3:/app/db.sqlite3 \
  bookpilot-backend
```

