# Finding the 500 Error Details

## Your Error Info
- **Status**: 500 (Internal Server Error)
- **Endpoint**: `/pilot/api/create_outline/`
- **Latency**: 15.6 seconds (very long - might be timeout or AI generation issue)
- **Trace ID**: `3b27e4fbb1f4ec3d8601a933ba88a3d9`

## Find the Actual Error Message

### Method 1: Cloud Console (Best)

1. Go to: https://console.cloud.google.com/logs/query?project=bookpilot-483718

2. Use this query to find the actual error:
   ```
   trace="projects/bookpilot-483718/traces/3b27e4fbb1f4ec3d8601a933ba88a3d9"
   severity>=ERROR
   ```

3. Look for logs with `severity: ERROR` that show:
   - `textPayload` - Python traceback/error
   - `jsonPayload.message` - Error message
   - `jsonPayload.exception` - Exception details

### Method 2: gcloud CLI

```bash
# Get all logs for this trace, including error details
gcloud logging read "trace=projects/bookpilot-483718/traces/3b27e4fbb1f4ec3d8601a933ba88a3d9 AND severity>=ERROR" \
  --format=json \
  --project bookpilot-483718 \
  --limit 50 | grep -A 20 "textPayload\|jsonPayload"
```

### Method 3: View Recent 500 Errors

```bash
gcloud logging read "resource.type=cloud_run_revision AND httpRequest.status=500 AND timestamp>=\"2026-01-14T12:16:00Z\"" \
  --format="table(timestamp,textPayload,jsonPayload.message,httpRequest.requestUrl)" \
  --project bookpilot-483718 \
  --limit 10
```

## Common Causes of 500 Errors in create_outline

1. **OpenAI API Error**:
   - Rate limit exceeded
   - API key invalid/missing
   - Request timeout (15.6s suggests this)
   - Model unavailable

2. **Database Error**:
   - Cloud SQL connection failed
   - Database query failed
   - Migration not run

3. **Missing Environment Variables**:
   - `OPENAI_API_KEY` not set
   - Database credentials missing

4. **Import Error**:
   - Missing Python package
   - Module not found

5. **Timeout**:
   - 15.6 seconds is very long - might be hitting Cloud Run timeout
   - AI generation taking too long

## Quick Check: Environment Variables

Verify these are set in Cloud Run:
- `OPENAI_API_KEY`
- `CLOUD_SQL_CONNECTION_NAME`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `USE_GCS`
- `GS_BUCKET_NAME`
- `GS_PROJECT_ID`

## Next Steps

1. Get the full error message from logs (use Method 1 above)
2. Check if it's an OpenAI API error
3. Check Cloud Run timeout settings (default is 300s, but might be lower)
4. Share the error message for help fixing it

