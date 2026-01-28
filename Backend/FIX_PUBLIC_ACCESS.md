# Fix "Access Denied" Error for Google Cloud Storage

## Current Status
- ✅ IAM Policy: `allUsers` has `roles/storage.objectViewer` 
- ✅ Uniform bucket-level access: Enabled
- ⚠️  Public access prevention: **inherited** (may be blocking access)

## Solution: Disable Public Access Prevention

The bucket has "Public access prevention" set to "inherited", which may be blocking public access even though IAM allows it.

### Steps to Fix:

1. **Go to Google Cloud Console**
   - Navigate to: https://console.cloud.google.com/storage/browser/bookpilot_media?project=bookpilot-483718

2. **Open Bucket Configuration**
   - Click on the bucket name `bookpilot_media`
   - Go to the **Configuration** tab

3. **Disable Public Access Prevention**
   - Scroll down to **Public access prevention**
   - Click **Edit**
   - Change from **"Inherited"** or **"Enforced"** to **"Not enforced"**
   - Click **Save**

4. **Verify IAM Permissions** (if needed)
   - Go to **Permissions** tab
   - Verify `allUsers` has `Storage Object Viewer` role
   - If not present, click **Grant Access**:
     - Principal: `allUsers`
     - Role: `Storage Object Viewer`
     - Save

5. **Test Again**
   ```bash
   python manage.py test_gcs
   ```
   Then click the generated URL - it should work now.

## Alternative: Use Signed URLs (More Secure)

If you don't want public access, you can use signed URLs instead. Update `settings.py`:

```python
GS_QUERYSTRING_AUTH = True  # Enable signed URLs
GS_DEFAULT_ACL = None  # Don't set public ACL
```

Then files will be accessed via time-limited signed URLs.

## Quick Test

After fixing, test with:
```bash
python verify_bucket_permissions.py
```

Then try accessing the test file URL in your browser.

