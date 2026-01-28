# Debugging Cloud Run Errors

## View Full Error Logs

### Option 1: Google Cloud Console

1. Go to: https://console.cloud.google.com/run?project=bookpilot-483718
2. Click on your Cloud Run service
3. Go to **"Logs"** tab
4. Filter by:
   - Severity: **ERROR**
   - Time range: Last hour
5. Click on an error log entry to see full details

### Option 2: Using gcloud CLI

```bash
# View recent errors
gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" \
  --limit 50 \
  --format json \
  --project bookpilot-483718

# View logs for specific trace
gcloud logging read "trace=projects/bookpilot-483718/traces/66805969495237f77bd38f8c54adf7f7" \
  --format json \
  --project bookpilot-483718
```

### Option 3: View in Logs Explorer

1. Go to: https://console.cloud.google.com/logs/query?project=bookpilot-483718
2. Use this query:
   ```
   resource.type="cloud_run_revision"
   severity>=ERROR
   timestamp>="2026-01-14T11:53:00Z"
   ```
3. Click on an error to see full details

## Common Cloud Run Errors

### 1. Database Connection Errors
- **Error**: `connection to server on socket "/cloudsql/..." failed`
- **Fix**: Check Cloud SQL connection name and database credentials

### 2. Authentication Errors
- **Error**: `Authentication credentials were not provided`
- **Fix**: Check if service account has proper permissions

### 3. Import Errors
- **Error**: `ModuleNotFoundError: No module named '...'`
- **Fix**: Check requirements.txt and Dockerfile

### 4. Environment Variable Errors
- **Error**: `KeyError` or missing environment variables
- **Fix**: Check Cloud Run environment variables

### 5. Memory/Timeout Errors
- **Error**: `Container killed` or `Request timeout`
- **Fix**: Increase memory limit or timeout settings

## Check Your Specific Error

Based on your trace ID: `66805969495237f77bd38f8c54adf7f7`

Run this to see the full error:
```bash
gcloud logging read "trace=projects/bookpilot-483718/traces/66805969495237f77bd38f8c54adf7f7" \
  --format="table(timestamp,severity,textPayload,jsonPayload.message)" \
  --project bookpilot-483718
```

## Quick Checks

1. **Check service health**:
   ```bash
   gcloud run services describe YOUR_SERVICE_NAME \
     --region=europe-west1 \
     --project bookpilot-483718
   ```

2. **Check recent deployments**:
   ```bash
   gcloud run revisions list \
     --service=YOUR_SERVICE_NAME \
     --region=europe-west1 \
     --project bookpilot-483718
   ```

3. **View service logs**:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=YOUR_SERVICE_NAME" \
     --limit 100 \
     --project bookpilot-483718
   ```

## Next Steps

1. Get the full error message from Cloud Console Logs
2. Check if it's related to:
   - Database connection (Cloud SQL)
   - Authentication (service account)
   - Missing environment variables
   - Import errors
3. Share the full error message for help debugging

