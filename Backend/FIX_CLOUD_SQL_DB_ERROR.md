# Fix "database bookpilot-sql does not exist" Error

## Problem
The error shows Django is trying to connect to database `bookpilot-sql` (the Cloud SQL instance name) instead of the actual database name.

## Solution

### Step 1: Create the Database in Cloud SQL

1. Go to Google Cloud Console: https://console.cloud.google.com/sql/instances/bookpilot-sql?project=bookpilot-483718
2. Click on your instance
3. Click **"Databases"** tab
4. Click **"Create Database"**
5. Enter database name: `bookpilot`
6. Click **"Create"**

### Step 2: Create Database User (if not exists)

1. In Cloud SQL console, go to **"Users"** tab
2. Click **"Add User Account"**
3. Username: `bookpilot_user`
4. Password: Set a strong password
5. Click **"Add"**

### Step 3: Grant Permissions

Connect to your Cloud SQL instance and run:

```sql
-- Connect to the database
\c bookpilot

-- Grant all privileges
GRANT ALL PRIVILEGES ON DATABASE bookpilot TO bookpilot_user;

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO bookpilot_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO bookpilot_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bookpilot_user;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO bookpilot_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO bookpilot_user;
```

### Step 4: Set Environment Variables in Cloud Run

Go to Cloud Run service → **Edit & Deploy New Revision** → **Variables & Secrets** tab:

**Required Environment Variables:**
```
CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql
DB_NAME=bookpilot                    ← IMPORTANT: Must be "bookpilot", not "bookpilot-sql"
DB_USER=bookpilot_user
DB_PASSWORD=your_actual_password      ← Use the password you set in Step 2
```

**Optional (for Unix socket - Cloud Run default):**
- Don't set `DB_HOST` or `DB_PORT` (will use Unix socket automatically)

**Or if using IP connection:**
```
DB_HOST=10.123.45.67                 ← Your Cloud SQL private IP
DB_PORT=5432
```

### Step 5: Verify Environment Variables

After deploying, check the Cloud Run logs to verify:
```bash
gcloud run services describe YOUR_SERVICE_NAME \
  --region=YOUR_REGION \
  --format="value(spec.template.spec.containers[0].env)"
```

### Step 6: Run Migrations

After setting environment variables, migrations should run automatically (if configured in Dockerfile), or run manually:

```bash
# Connect to Cloud Run container
gcloud run services update YOUR_SERVICE_NAME --region=YOUR_REGION

# Or run migrations via Cloud Run job
gcloud run jobs create migrate \
  --image=YOUR_IMAGE \
  --set-env-vars="CLOUD_SQL_CONNECTION_NAME=...,DB_NAME=bookpilot,..." \
  --command="python,manage.py,migrate"
```

## Quick Checklist

- [ ] Database `bookpilot` exists in Cloud SQL
- [ ] User `bookpilot_user` exists with correct password
- [ ] User has permissions on `bookpilot` database
- [ ] Cloud Run environment variable `DB_NAME=bookpilot` (not `bookpilot-sql`)
- [ ] Cloud Run environment variable `DB_USER=bookpilot_user`
- [ ] Cloud Run environment variable `DB_PASSWORD` is set correctly
- [ ] Cloud Run environment variable `CLOUD_SQL_CONNECTION_NAME` is set
- [ ] Cloud Run has Cloud SQL connection configured (Connections tab)

## Common Mistakes

1. **Using instance name as database name**: `bookpilot-sql` is the instance name, not the database name
2. **Database doesn't exist**: Must create `bookpilot` database first
3. **Wrong environment variable**: Make sure `DB_NAME` is set, not something else
4. **Missing permissions**: User needs privileges on the database

## Test Connection

After fixing, test with:
```bash
python manage.py test_db_connection
```

Or check Cloud Run logs for connection errors.

