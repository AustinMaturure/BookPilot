# Testing Cloud SQL Connection Locally

## Option 1: Using Cloud SQL Proxy (Recommended)

1. **Install Cloud SQL Proxy** (if not already installed):
   ```bash
   # macOS
   curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.darwin.arm64
   chmod +x cloud-sql-proxy
   sudo mv cloud-sql-proxy /usr/local/bin/
   ```

2. **Start Cloud SQL Proxy** in a separate terminal:
   ```bash
   cloud-sql-proxy bookpilot-483718:us-central1:bookpilot-sql
   ```
   This will listen on `127.0.0.1:5432` by default.

3. **Set environment variables**:
   ```bash
   export CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
   export DB_HOST=127.0.0.1
   export DB_PORT=5432
   export DB_NAME=bookpilot
   export DB_USER=bookpilot_user
   export DB_PASSWORD=your_password
   ```

4. **Test connection**:
   ```bash
   python manage.py test_db_connection
   ```

## Option 2: Direct IP Connection (If Public IP Enabled)

1. **Get your Cloud SQL instance IP** from Google Cloud Console

2. **Set environment variables**:
   ```bash
   export DB_HOST=34.123.45.67  # Your Cloud SQL public/private IP
   export DB_PORT=5432
   export DB_NAME=bookpilot
   export DB_USER=bookpilot_user
   export DB_PASSWORD=your_password
   ```

3. **Ensure IP is authorized** in Cloud SQL console:
   - Go to Cloud SQL instance
   - Connections → Authorized networks
   - Add your IP address

4. **Test connection**:
   ```bash
   python manage.py test_db_connection
   ```

## Option 3: Force Cloud SQL (For Testing)

If you want to force Cloud SQL connection even locally (will fail if not properly configured):

```bash
export CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
export FORCE_CLOUD_SQL=true
export DB_NAME=bookpilot
export DB_USER=bookpilot_user
export DB_PASSWORD=your_password
export DB_HOST=127.0.0.1  # For Cloud SQL Proxy
export DB_PORT=5432

python manage.py test_db_connection
```

## Quick Test Script

Create a test script `test_cloud_sql_local.sh`:

```bash
#!/bin/bash

# Set your credentials
export CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
export DB_HOST=127.0.0.1  # Cloud SQL Proxy
export DB_PORT=5432
export DB_NAME=bookpilot
export DB_USER=bookpilot_user
export DB_PASSWORD=your_password

# Test connection
python manage.py test_db_connection
```

Make it executable and run:
```bash
chmod +x test_cloud_sql_local.sh
./test_cloud_sql_local.sh
```

## Troubleshooting

### Error: "connection refused"
- Ensure Cloud SQL Proxy is running
- Check `DB_HOST` and `DB_PORT` are correct

### Error: "password authentication failed"
- Verify `DB_USER` and `DB_PASSWORD` are correct
- Check user exists in Cloud SQL

### Error: "database does not exist"
- Create database: `CREATE DATABASE bookpilot;`
- Verify `DB_NAME` matches

### Still connecting to SQLite?
- Check environment variables are exported: `env | grep DB_`
- Use `FORCE_CLOUD_SQL=true` to override local detection
- Ensure `DB_HOST` is set (required for local Cloud SQL testing)

