# 🚨 SECURITY ALERT: Service Account Key Exposed

## Immediate Actions Required

### 1. Rotate/Delete the Exposed Key (URGENT)

1. **Go to Google Cloud Console**:
   https://console.cloud.google.com/iam-admin/serviceaccounts?project=bookpilot-483718

2. **Find the service account**: `583770319956-compute@developer.gserviceaccount.com`

3. **Delete the exposed key**:
   - Click on the service account
   - Go to **"Keys"** tab
   - Find key ID: `90305f06f79eafc69313bfe7cddf1dcd8d42e256`
   - Click **Delete** (it may already be disabled by Google)

4. **Create a new key** (if needed for local development):
   - Click **"Add Key"** → **"Create new key"**
   - Choose **JSON**
   - Download and save securely (NOT in the repository)
   - Update your local `.env` file

### 2. Remove Key from Docker Image

The key was exposed because it was copied into the Docker image. We've fixed this by:

✅ Added `*.json` to `.dockerignore` to prevent future exposure
✅ Updated settings to use Cloud Run's built-in service account in production

**Next steps:**
1. Rebuild your Docker image (the key will no longer be included)
2. Push the new image to Artifact Registry
3. Delete the old image that contains the exposed key

### 3. Use Cloud Run Service Account (Recommended for Production)

**Best Practice**: Don't use service account keys in production. Use Cloud Run's built-in service account instead.

1. **Grant permissions to Cloud Run service account**:
   - Go to Cloud Run → Your Service → **"Security"** tab
   - Note the service account email (usually `PROJECT_NUMBER-compute@developer.gserviceaccount.com`)
   - Grant this service account the necessary permissions:
     - **Storage Object Admin** (for GCS)
     - **Cloud SQL Client** (for Cloud SQL)

2. **Update Cloud Run environment variables**:
   - Remove `GOOGLE_APPLICATION_CREDENTIALS` (not needed)
   - Cloud Run will automatically use the service account

3. **Update settings.py** (already done):
   - Settings now check for default credentials first
   - Only uses `GOOGLE_APPLICATION_CREDENTIALS` if explicitly set

### 4. Secure Local Development

For local development, keep the key file OUTSIDE the repository:

```bash
# Add to .gitignore (already done)
bookpilot-*.json
*-service-account*.json

# Store key in a secure location
# Example: ~/.gcloud/bookpilot-service-account.json

# Update .env
GOOGLE_APPLICATION_CREDENTIALS=/Users/yourname/.gcloud/bookpilot-service-account.json
```

### 5. Verify No Keys in Repository

Check if the key file is tracked in Git:

```bash
cd Backend
git ls-files | grep -i "\.json$"
git log --all --full-history -- "*.json"
```

If found, remove it:
```bash
git rm --cached bookpilot-483718-90305f06f79e.json
git commit -m "Remove exposed service account key"
```

**⚠️ WARNING**: If the key was committed to Git, consider it compromised even if you remove it. Rotate the key immediately.

### 6. Rebuild and Redeploy

1. **Rebuild Docker image**:
   ```bash
   docker build -t bookpilot-backend .
   ```

2. **Verify key is NOT in image**:
   ```bash
   docker run --rm bookpilot-backend ls -la /app/*.json
   # Should show: No such file or directory
   ```

3. **Push new image**:
   ```bash
   # Tag and push to Artifact Registry
   docker tag bookpilot-backend europe-docker.pkg.dev/bookpilot-483718/artifact-registry-docker-cache/remote-dockerhub-mirror/bookpilot/bookpilot:latest
   docker push europe-docker.pkg.dev/bookpilot-483718/artifact-registry-docker-cache/remote-dockerhub-mirror/bookpilot/bookpilot:latest
   ```

4. **Delete old image** (contains exposed key):
   ```bash
   # Delete the compromised image from Artifact Registry
   gcloud artifacts docker images delete \
     europe-docker.pkg.dev/bookpilot-483718/artifact-registry-docker-cache/remote-dockerhub-mirror/bookpilot/bookpilot@sha256:afa0a6889a38780696efddc2490fa9f949877a98128930283ffc56d9c697833f
   ```

## Prevention Checklist

- [ ] Service account key deleted/rotated
- [ ] `.dockerignore` updated (✅ done)
- [ ] Key file removed from Git (if committed)
- [ ] Docker image rebuilt without key
- [ ] Old Docker image deleted
- [ ] Cloud Run using built-in service account (recommended)
- [ ] Local `.env` updated with new key path (if needed)
- [ ] Key file stored securely outside repository

## Best Practices Going Forward

1. **Never commit service account keys** to Git
2. **Never include keys in Docker images** - use environment variables or Cloud Run service accounts
3. **Use Cloud Run's built-in service account** for production (no keys needed)
4. **Store keys securely** for local development (outside repo, in `.gitignore`)
5. **Rotate keys regularly** and immediately if exposed
6. **Use Secret Manager** for sensitive configuration in production

## Need Help?

- Google Cloud Security: https://cloud.google.com/security
- IAM Best Practices: https://cloud.google.com/iam/docs/using-iam-securely
- Secret Manager: https://cloud.google.com/secret-manager

