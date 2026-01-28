# Cloud SQL Database Configuration

## Connection Methods

Cloud SQL can be accessed in different ways depending on where your application is running:

### 1. **Unix Socket** (Recommended for Cloud Run/App Engine)
- **HOST**: `/cloudsql/bookpilot-483718:us-central1:bookpilot-sql`
- **PORT**: Not needed (Unix socket)
- **Use when**: Running in Google Cloud (Cloud Run, App Engine, GCE)
- **No IP needed**: Uses internal Google Cloud networking

### 2. **Private IP** (Outgoing IP)
- **HOST**: The private/internal IP address (shown as "outgoing" in Cloud SQL console)
- **PORT**: Usually `5432` for PostgreSQL
- **Use when**: Connecting from another Google Cloud service (GCE, GKE)
- **Example**: `HOST=10.123.45.67`, `PORT=5432`

### 3. **Public IP**
- **HOST**: The public IP address (if enabled in Cloud SQL)
- **PORT**: Usually `5432` for PostgreSQL
- **Use when**: Connecting from outside Google Cloud (not recommended for production)
- **Requires**: Authorized networks configured
- **Example**: `HOST=34.123.45.67`, `PORT=5432`

### 4. **Cloud SQL Proxy** (For Local Development)
- **HOST**: `127.0.0.1` (localhost)
- **PORT**: Usually `5432` (or whatever port the proxy listens on)
- **Use when**: Running Django locally and want to connect to Cloud SQL
- **Requires**: Cloud SQL Proxy running locally

## Environment Variables

Based on your connection name `bookpilot-483718:us-central1:bookpilot-sql`, set these in production:

### Option A: Unix Socket (Recommended for Cloud Run)
```bash
CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
DB_NAME=bookpilot
DB_USER=bookpilot_user
DB_PASSWORD=your_password_here
# HOST and PORT not needed for Unix socket
```

### Option B: Private IP (If using private IP)
```bash
CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
DB_NAME=bookpilot
DB_USER=bookpilot_user
DB_PASSWORD=your_password_here
DB_HOST=10.123.45.67  # Your private/outgoing IP
DB_PORT=5432
```

### Option C: Public IP (Not recommended, but possible)
```bash
CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
DB_NAME=bookpilot
DB_USER=bookpilot_user
DB_PASSWORD=your_password_here
DB_HOST=34.123.45.67  # Your public IP
DB_PORT=5432
```

## Finding Your IP Addresses

1. Go to: https://console.cloud.google.com/sql/instances/bookpilot-sql?project=bookpilot-483718
2. Click on your instance
3. Go to **Connections** tab
4. You'll see:
   - **Private IP**: The internal IP (outgoing)
   - **Public IP**: The external IP (if enabled)

## Recommended Setup

For **Cloud Run** (production):
- Use **Unix Socket** method (Option A)
- No IP addresses needed
- Most secure and efficient

For **Local Development**:
- Use **Cloud SQL Proxy**
- Run: `cloud-sql-proxy bookpilot-483718:us-central1:bookpilot-sql`
- Connect to `127.0.0.1:5432`

## Database Setup

1. Create the database in Cloud SQL:
   ```sql
   CREATE DATABASE bookpilot;
   CREATE USER bookpilot_user WITH PASSWORD 'your_secure_password';
   GRANT ALL PRIVILEGES ON DATABASE bookpilot TO bookpilot_user;
   ```

2. Run migrations:
   ```bash
   python manage.py migrate
   ```

