# Fix Google Cloud Storage Bucket Permissions

## Problem
Getting "Access denied" error when accessing files via public URLs. The bucket needs to be configured for public read access.

## Solution Options

### Option 1: Make Bucket Publicly Readable (Recommended for Development)

Run these commands using `gsutil` (install Google Cloud SDK if needed):

```bash
# Make the bucket publicly readable
gsutil iam ch allUsers:objectViewer gs://bookpilot_media

# Set default object ACL to public read
gsutil defacl ch -u AllUsers:R gs://bookpilot_media

# Update existing files to be publicly readable
gsutil -m acl ch -u AllUsers:R gs://bookpilot_media/**
```

### Option 2: Configure via Google Cloud Console

1. Go to: https://console.cloud.google.com/storage/browser/bookpilot_media?project=bookpilot-483718
2. Click on the bucket name
3. Go to **Permissions** tab
4. Click **Grant Access**
5. Add principal: `allUsers`
6. Role: **Storage Object Viewer**
7. Click **Save**

### Option 3: Use Signed URLs (More Secure, for Production)

If you don't want public access, you can use signed URLs instead. Update `settings.py`:

```python
GS_QUERYSTRING_AUTH = True  # Use signed URLs
GS_DEFAULT_ACL = None  # Don't set public ACL
```

Then files will be accessed via signed URLs that expire after a set time.

## Verify Permissions

After setting permissions, test with:
```bash
python manage.py test_gcs
```

Then click the generated URL - it should work without "Access denied" error.

## Security Note

Making buckets publicly readable means anyone with the URL can access the files. For production:
- Consider using signed URLs instead
- Or restrict bucket access to specific domains/IPs
- Or use Cloud CDN with access controls

