"""
Script to fix Google Cloud Storage bucket permissions for public read access.
Run with: python fix_bucket_permissions.py
"""
import os
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

try:
    from google.cloud import storage
    from google.oauth2 import service_account
    
    # Get credentials
    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not credentials_path:
        print("ERROR: GOOGLE_APPLICATION_CREDENTIALS not set in .env")
        exit(1)
    
    if not os.path.isabs(credentials_path):
        credentials_path = os.path.join(BASE_DIR, credentials_path)
    
    if not os.path.exists(credentials_path):
        print(f"ERROR: Credentials file not found: {credentials_path}")
        exit(1)
    
    # Initialize storage client
    credentials = service_account.Credentials.from_service_account_file(credentials_path)
    client = storage.Client(credentials=credentials, project=os.getenv("GS_PROJECT_ID", "bookpilot-483718"))
    
    bucket_name = os.getenv("GS_BUCKET_NAME", "bookpilot_media")
    bucket = client.bucket(bucket_name)
    
    print(f"\n=== Fixing Permissions for Bucket: {bucket_name} ===\n")
    
    # Step 1: Make bucket publicly readable
    print("1. Setting bucket IAM policy for public read access...")
    try:
        policy = bucket.get_iam_policy(requested_policy_version=3)
        policy.bindings.append({
            "role": "roles/storage.objectViewer",
            "members": {"allUsers"}
        })
        bucket.set_iam_policy(policy)
        print("   ✓ Bucket IAM policy updated")
    except Exception as e:
        print(f"   ⚠️  Could not update IAM policy: {e}")
        print("   (You may need to do this manually in Google Cloud Console)")
    
    # Step 2: Set default object ACL
    print("\n2. Setting default object ACL to public read...")
    try:
        bucket.acl.all().grant_read()
        bucket.acl.save()
        print("   ✓ Default ACL set to public read")
    except Exception as e:
        print(f"   ⚠️  Could not set default ACL: {e}")
    
    # Step 3: Update existing files to be publicly readable
    print("\n3. Updating existing files to be publicly readable...")
    try:
        blobs = list(bucket.list_blobs())
        print(f"   Found {len(blobs)} file(s)")
        
        updated = 0
        for blob in blobs:
            try:
                blob.acl.all().grant_read()
                blob.acl.save()
                updated += 1
            except Exception as e:
                print(f"   ⚠️  Could not update {blob.name}: {e}")
        
        print(f"   ✓ Updated {updated}/{len(blobs)} files")
    except Exception as e:
        print(f"   ⚠️  Could not update files: {e}")
    
    print("\n=== Done ===\n")
    print("If you still get access denied errors, you may need to:")
    print("1. Go to Google Cloud Console")
    print(f"2. Navigate to: https://console.cloud.google.com/storage/browser/{bucket_name}?project={os.getenv('GS_PROJECT_ID', 'bookpilot-483718')}")
    print("3. Click on the bucket → Permissions tab")
    print("4. Add principal: allUsers")
    print("5. Role: Storage Object Viewer")
    print("6. Save")
    
except ImportError:
    print("ERROR: google-cloud-storage not installed")
    print("Install with: pip install google-cloud-storage")
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()

