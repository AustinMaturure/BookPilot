# Fix Cloud SQL "Error 409: invalidState" and "Connection refused"

## The Error

```
Error 409: The instance or operation is not in an appropriate state to handle the request., invalidState
connection to server on socket "/cloudsql/.../" failed: Connection refused
```

## What It Means

1. **invalidState (409)**: The Cloud SQL instance is not ready to accept connections. Common causes:
   - Instance is **stopped** (Cloud SQL can be stopped to save costs)
   - Instance is **starting** (takes 1–2 minutes after start)
   - Instance is in **maintenance** or **updating**

2. **Connection refused**: The Unix socket is not available—often because the instance was not ready when Cloud Run tried to connect.

## Fixes

### 1. Start the Cloud SQL Instance (Most Common)

1. Go to [Cloud SQL Instances](https://console.cloud.google.com/sql/instances?project=bookpilot-483718)
2. Find `bookpilot-sql`
3. If status is **Stopped**, click **Start**
4. Wait 1–2 minutes until status is **Running**
5. Redeploy or let Cloud Run retry (new instances will connect)

### 2. Configure Cloud SQL Connection in Cloud Run

Cloud Run must have the Cloud SQL instance attached:

1. Go to [Cloud Run](https://console.cloud.google.com/run?project=bookpilot-483718)
2. Click your service → **Edit & Deploy New Revision**
3. Open **Connections** (or **Cloud SQL** tab)
4. Check **Cloud SQL connections**
5. Add `bookpilot-sql` if it’s not listed
6. Deploy

### 3. Verify Environment Variables

In Cloud Run → **Variables & Secrets**:

| Variable                    | Value                                               |
|----------------------------|-----------------------------------------------------|
| `CLOUD_SQL_CONNECTION_NAME` | `bookpilot-483718:us-central1:bookpilot-sql`        |
| `DB_NAME`                  | `bookpilot`                                         |
| `DB_USER`                  | `bookpilot_user`                                   |
| `DB_PASSWORD`              | Your Cloud SQL user password                       |

### 4. Region Mismatch (Optional)

- Cloud Run: `europe-west1`
- Cloud SQL: `us-central1`

Cross-region connections work if the Cloud SQL connection is correctly configured. If problems persist, consider moving Cloud Run to `us-central1` for lower latency.

## Startup Retry Behavior

The startup script (`scripts/start.sh`) retries migrations up to 6 times with 10-second delays. This covers:

- Cloud SQL starting up
- Temporary “invalidState” or network blips

If it still fails after ~60 seconds, the instance is likely stopped or misconfigured.

## Quick Checklist

- [ ] Cloud SQL instance `bookpilot-sql` is **Running**
- [ ] Cloud Run has the Cloud SQL connection attached (Connections tab)
- [ ] `CLOUD_SQL_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` are set in Cloud Run
