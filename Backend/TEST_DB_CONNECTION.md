# Testing Database Connection

## Method 1: Django Management Command (Recommended)

Test the connection using Django's database configuration:

```bash
python manage.py test_db_connection
```

This will:
- Show your current database configuration
- Test the connection
- Display database version, user, and table count
- Provide troubleshooting tips if connection fails

### Example Output (SQLite - Local):
```
=== Testing Database Connection ===

Engine: django.db.backends.sqlite3
Database: /path/to/db.sqlite3
User: 
Host: 
Port: 

✓ SQLite connection successful!
  SQLite version: 3.51.0
  Database file: /path/to/db.sqlite3
  Tables in database: 22

=== Connection Test Complete ===
```

### Example Output (Cloud SQL - Production):
```
=== Testing Database Connection ===

Engine: django.db.backends.postgresql
Database: bookpilot
User: bookpilot_user
Host: /cloudsql/bookpilot-483718:us-central1:bookpilot-sql
Port: 

✓ PostgreSQL connection successful!
  PostgreSQL version: PostgreSQL 15.x
  Connected to database: bookpilot
  Connected as user: bookpilot_user
  Tables in database: 22

=== Connection Test Complete ===
```

## Method 2: Standalone Python Script

For testing Cloud SQL directly without Django:

```bash
# Set environment variables
export CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
export DB_NAME=bookpilot
export DB_USER=bookpilot_user
export DB_PASSWORD=your_password

# Run test
python test_cloud_sql.py
```

Or with IP connection:
```bash
export DB_HOST=10.123.45.67
export DB_PORT=5432
export DB_NAME=bookpilot
export DB_USER=bookpilot_user
export DB_PASSWORD=your_password

python test_cloud_sql.py
```

## Method 3: Django Shell

Test interactively in Django shell:

```bash
python manage.py shell
```

Then in the shell:
```python
from django.db import connection

# Test connection
with connection.cursor() as cursor:
    cursor.execute("SELECT version();")
    print(cursor.fetchone())

# Check configuration
from django.conf import settings
print(settings.DATABASES['default'])
```

## Method 4: Direct psycopg2 Test

Test PostgreSQL connection directly:

```python
import psycopg2

# Unix socket
conn = psycopg2.connect(
    dbname="bookpilot",
    user="bookpilot_user",
    password="your_password",
    host="/cloudsql/bookpilot-483718:us-central1:bookpilot-sql"
)

# Or IP connection
conn = psycopg2.connect(
    dbname="bookpilot",
    user="bookpilot_user",
    password="your_password",
    host="10.123.45.67",
    port="5432"
)

cursor = conn.cursor()
cursor.execute("SELECT version();")
print(cursor.fetchone())
conn.close()
```

## Testing in Different Environments

### Local Development (SQLite)
```bash
# No environment variables needed
python manage.py test_db_connection
```

### Local Development (Cloud SQL Proxy)
```bash
# 1. Start Cloud SQL Proxy in another terminal
cloud-sql-proxy bookpilot-483718:us-central1:bookpilot-sql

# 2. Set environment variables
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_NAME=bookpilot
export DB_USER=bookpilot_user
export DB_PASSWORD=your_password

# 3. Test connection
python manage.py test_db_connection
```

### Cloud Run (Production)
```bash
# Set environment variables in Cloud Run
CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
DB_NAME=bookpilot
DB_USER=bookpilot_user
DB_PASSWORD=your_password
# Don't set DB_HOST - will use Unix socket

# Deploy and test
python manage.py test_db_connection
```

### With Private IP
```bash
export DB_HOST=10.123.45.67  # Private IP
export DB_PORT=5432
export DB_NAME=bookpilot
export DB_USER=bookpilot_user
export DB_PASSWORD=your_password

python manage.py test_db_connection
```

## Common Errors and Solutions

### Error: "could not connect to server"
- **Unix socket**: Ensure you're running in Google Cloud (Cloud Run/App Engine)
- **IP connection**: Check IP is authorized in Cloud SQL console
- **Cloud SQL Proxy**: Ensure proxy is running locally

### Error: "password authentication failed"
- Verify `DB_PASSWORD` is correct
- Check user exists in Cloud SQL: `SELECT * FROM pg_user;`

### Error: "database does not exist"
- Create database: `CREATE DATABASE bookpilot;`
- Verify `DB_NAME` matches the actual database name

### Error: "permission denied"
- Grant permissions: `GRANT ALL PRIVILEGES ON DATABASE bookpilot TO bookpilot_user;`

## Quick Test Checklist

- [ ] Environment variables set correctly
- [ ] Database exists in Cloud SQL
- [ ] User exists and has permissions
- [ ] IP authorized (if using IP connection)
- [ ] Cloud SQL Proxy running (if testing locally)
- [ ] Cloud SQL instance is running
- [ ] Network connectivity (for IP connections)

