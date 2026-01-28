# Google Cloud Storage Setup Guide

This guide explains how to configure BookPilot to use Google Cloud Storage (GCS) for media files in production.

## Bucket Structure

Files are organized in the following structure:
```
bookpilot_media/
├── book_{book_id}/
│   └── chapter_assets/
│       ├── {filename}                    # Chapter-level assets (talking_point=None)
│       └── talking_point_{tp_id}/
│           └── {filename}                # Talking point-specific assets
```

## Prerequisites

1. Google Cloud Project: `bookpilot-483718`
2. GCS Bucket: `bookpilot_media`
3. Service Account with Storage Admin permissions

## Installation

Install required packages:
```bash
pip install django-storages google-cloud-storage
```

Or add to requirements.txt (already added):
```
django-storages==1.14.2
google-cloud-storage==2.18.2
```

## Environment Variables

Add these to your `.env` file or production environment:

```bash
# Enable Google Cloud Storage
USE_GCS=true

# GCS Configuration
GS_BUCKET_NAME=bookpilot_media
GS_PROJECT_ID=bookpilot-483718

# Service Account Credentials (choose one method)
# Method 1: Path to service account JSON key file
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Method 2: Use default credentials (if running on GCP)
# Leave GOOGLE_APPLICATION_CREDENTIALS unset and ensure the service account
# is attached to the compute instance/Cloud Run service
```

## Service Account Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts?project=bookpilot-483718)
2. Create a service account or use an existing one
3. Grant the following roles:
   - **Storage Admin** (or at minimum: Storage Object Admin)
4. Create a JSON key:
   - Click on the service account
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key" → JSON
   - Download the JSON file
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of this JSON file

## Bucket Configuration

Ensure your bucket `bookpilot_media` has:
- **Public access**: Files need to be publicly readable (or configure CORS if using signed URLs)
- **CORS** (if needed): Configure CORS for your frontend domain

To make the bucket publicly readable:
```bash
gsutil iam ch allUsers:objectViewer gs://bookpilot_media
```

Or set bucket-level public access in the Google Cloud Console.

## Testing

1. Set `USE_GCS=true` in your `.env`
2. Set `GOOGLE_APPLICATION_CREDENTIALS` to your service account key path
3. Upload a file through the application
4. Check the bucket: https://console.cloud.google.com/storage/browser/bookpilot_media?project=bookpilot-483718
5. Verify the file structure matches: `book_{id}/chapter_assets/...`

## Migration from Local Storage

If you have existing files in local storage:
1. Install `gsutil` (Google Cloud SDK)
2. Upload existing files to GCS maintaining the same structure:
```bash
gsutil -m cp -r media/book_* gs://bookpilot_media/
```

## Troubleshooting

### "ModuleNotFoundError: No module named 'storages'"
- Install: `pip install django-storages google-cloud-storage`

### "Access Denied" errors
- Verify service account has Storage Admin role
- Check that `GOOGLE_APPLICATION_CREDENTIALS` points to valid JSON file
- Verify bucket name matches: `bookpilot_media`

### Files not publicly accessible
- Check bucket permissions: `gsutil iam get gs://bookpilot_media`
- Ensure `GS_DEFAULT_ACL = 'publicRead'` in settings.py

### Files uploaded but URLs return 404
- Verify `MEDIA_URL` is set correctly: `https://storage.googleapis.com/bookpilot_media/`
- Check file path structure matches expected format

## Development vs Production

- **Development**: Set `USE_GCS=false` (or omit) to use local storage
- **Production**: Set `USE_GCS=true` and configure credentials

The system automatically falls back to local storage if GCS is not properly configured.

