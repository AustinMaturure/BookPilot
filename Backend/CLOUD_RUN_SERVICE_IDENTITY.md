# Cloud Run Service Identity Configuration

## Overview

Based on Google Cloud documentation, Cloud Run automatically provides service identity through Application Default Credentials (ADC). Our settings.py has been updated to use this automatically.

## ✅ What We've Done

1. **Updated `settings.py`** to prefer default credentials (Cloud Run service account) over explicit key files
2. **Added `.dockerignore`** to prevent service account keys from being included in Docker images
3. **Removed dependency on `GOOGLE_APPLICATION_CREDENTIALS`** in production

## 🔧 How It Works

### In Cloud Run (Production)
- Cloud Run automatically provides credentials via the metadata server
- No `GOOGLE_APPLICATION_CREDENTIALS` environment variable needed
- Service account is assigned to the Cloud Run service
- Access tokens are automatically fetched by Cloud Client Libraries

### In Local Development
- Falls back to `GOOGLE_APPLICATION_CREDENTIALS` if set
- Uses service account key file for local testing

## 📋 Configuration Steps

### Step 1: Create a User-Managed Service Account (Recommended)

1. Go to: https://console.cloud.google.com/iam-admin/serviceaccounts?project=bookpilot-483718
2. Click **"Create Service Account"**
3. Name: `bookpilot-cloud-run`
4. Description: "Service account for BookPilot Cloud Run service"
5. Click **"Create and Continue"**

### Step 2: Grant Required Permissions

Grant these roles to the service account:

**For Google Cloud Storage:**
- **Storage Object Admin** (or more restrictive: Storage Object Creator + Storage Object Viewer)

**For Cloud SQL:**
- **Cloud SQL Client**

**Optional (if needed):**
- **Secret Manager Secret Accessor** (if using Secret Manager)

### Step 3: Assign Service Account to Cloud Run Service

1. Go to Cloud Run: https://console.cloud.google.com/run?project=bookpilot-483718
2. Click on your service
3. Click **"Edit & Deploy New Revision"**
4. Go to **"Security"** tab
5. Under **"Service account"**, select your user-managed service account: `bookpilot-cloud-run@bookpilot-483718.iam.gserviceaccount.com`
6. Click **"Deploy"**

### Step 4: Remove GOOGLE_APPLICATION_CREDENTIALS from Environment Variables

1. In Cloud Run service → **"Edit & Deploy New Revision"**
2. Go to **"Variables & Secrets"** tab
3. **Remove** `GOOGLE_APPLICATION_CREDENTIALS` if it exists
4. Keep only:
   - `CLOUD_SQL_CONNECTION_NAME`
   - `DB_NAME`
   - `DB_USER`
   - `DB_PASSWORD`
   - `USE_GCS=true`
   - `GS_BUCKET_NAME`
   - `GS_PROJECT_ID`
   - Other app-specific variables

### Step 5: Verify Configuration

After deployment, check logs to see:
```
Using default Google Cloud credentials (Cloud Run service account)
```

This confirms the service is using the Cloud Run service account, not a key file.

## 🚫 Important: Never Do This in Cloud Run

**DO NOT** set `GOOGLE_APPLICATION_CREDENTIALS` as an environment variable in Cloud Run:
- ❌ It's unnecessary (Cloud Run provides credentials automatically)
- ❌ It's a security risk (keys can be exposed)
- ❌ It's against Google Cloud best practices

## ✅ What Happens Automatically

When your code uses Cloud Client Libraries (like `google-cloud-storage`):

1. Library requests access token from metadata server
2. Metadata server provides token for the Cloud Run service account
3. Request is sent with OAuth 2.0 access token
4. IAM verifies permissions
5. API operation completes

All of this happens automatically - no code changes needed!

## 🔍 Testing

### In Cloud Run
- Check logs for: "Using default Google Cloud credentials"
- Verify GCS and Cloud SQL operations work
- No errors about missing credentials

### Locally
- Set `GOOGLE_APPLICATION_CREDENTIALS` in `.env` (for local testing only)
- Key file should be outside repository (in `.gitignore`)

## 📚 References

- [Cloud Run Service Identity](https://cloud.google.com/run/docs/authenticating/service-identity)
- [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)
- [IAM Best Practices](https://cloud.google.com/iam/docs/using-iam-securely)

