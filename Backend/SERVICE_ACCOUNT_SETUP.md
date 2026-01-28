# Service Account Setup for Google Cloud Storage

## ⚠️ Important: OAuth Client Secret vs Service Account Key

The file `client_secret_2_332284226702-q2ehoksvf3mvtkh8hv4l9tfajj2h49qi.apps.googleusercontent.com.json` is an **OAuth Client Secret** used for user authentication (Google Sign-In). 

For Google Cloud Storage, you need a **Service Account Key** file, which is different.

## Steps to Create Service Account Key

1. **Go to Google Cloud Console**
   - Navigate to: https://console.cloud.google.com/iam-admin/serviceaccounts?project=bookpilot-483718
   - Or: IAM & Admin → Service Accounts

2. **Create or Select Service Account**
   - If you don't have one, click "Create Service Account"
   - Name it: `bookpilot-storage` (or any name)
   - Click "Create and Continue"

3. **Grant Permissions**
   - Role: **Storage Admin** (or at minimum: Storage Object Admin)
   - Click "Continue" → "Done"

4. **Create JSON Key**
   - Click on the service account you just created
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key"
   - Select "JSON"
   - Click "Create"
   - **A JSON file will download automatically**

5. **Save the Key File**
   - The downloaded file will have a name like: `bookpilot-483718-xxxxx.json`
   - Save it in your Backend directory (same location as `manage.py`)
   - **DO NOT commit this file to git** (add to `.gitignore`)

6. **Set Environment Variable**
   - If file is in Backend directory: `GOOGLE_APPLICATION_CREDENTIALS=bookpilot-483718-xxxxx.json`
   - Or use absolute path: `GOOGLE_APPLICATION_CREDENTIALS=/full/path/to/bookpilot-483718-xxxxx.json`

## Service Account Key File Structure

A service account key file looks like this:
```json
{
  "type": "service_account",
  "project_id": "bookpilot-483718",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "bookpilot-storage@bookpilot-483718.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

Notice it has:
- `"type": "service_account"` (not `"web"`)
- `"private_key"` field
- `"client_email"` field

## Environment Variable Format

Since `manage.py` is in the `Backend/` directory, you have two options:

### Option 1: Relative Path (if file is in Backend directory)
```bash
GOOGLE_APPLICATION_CREDENTIALS=bookpilot-483718-xxxxx.json
```

### Option 2: Absolute Path (recommended for production)
```bash
GOOGLE_APPLICATION_CREDENTIALS=/Users/austinematurure/Documents/Github/BookPilot-1/Backend/bookpilot-483718-xxxxx.json
```

## Security Note

⚠️ **NEVER commit service account keys to git!**

Add to `.gitignore`:
```
*.json
!package.json
!tsconfig.json
# But allow service account keys to be ignored
bookpilot-*.json
*-service-account*.json
```

## Quick Test

After setting up, test with:
```python
from google.cloud import storage
client = storage.Client()
buckets = list(client.list_buckets())
print(buckets)
```

If you see your `bookpilot_media` bucket listed, it's working!

