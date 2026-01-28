"""
Check bucket settings that might prevent public access.
"""
import os
from dotenv import load_dotenv
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

try:
    from google.cloud import storage
    from google.oauth2 import service_account
    
    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not os.path.isabs(credentials_path):
        credentials_path = os.path.join(BASE_DIR, credentials_path)
    
    credentials = service_account.Credentials.from_service_account_file(credentials_path)
    client = storage.Client(credentials=credentials, project=os.getenv("GS_PROJECT_ID", "bookpilot-483718"))
    
    bucket_name = os.getenv("GS_BUCKET_NAME", "bookpilot_media")
    bucket = client.bucket(bucket_name)
    bucket.reload()
    
    print(f"\n=== Bucket Settings: {bucket_name} ===\n")
    print(f"Uniform bucket-level access: {bucket.iam_configuration.uniform_bucket_level_access_enabled}")
    print(f"Public access prevention: {getattr(bucket.iam_configuration, 'public_access_prevention', 'Not set')}")
    
    # Check if public access prevention is blocking
    try:
        pap = bucket.iam_configuration.public_access_prevention
        if pap == "enforced":
            print("\n⚠️  PUBLIC ACCESS PREVENTION IS ENABLED!")
            print("This prevents public access even if IAM policies allow it.")
            print("\nTo fix:")
            print("1. Go to Google Cloud Console")
            print(f"2. Navigate to: https://console.cloud.google.com/storage/browser/{bucket_name}?project={os.getenv('GS_PROJECT_ID', 'bookpilot-483718')}")
            print("3. Click on the bucket → Configuration tab")
            print("4. Under 'Public access prevention', click 'Edit'")
            print("5. Select 'Not enforced' or 'Inherited'")
            print("6. Save")
    except AttributeError:
        print("Public access prevention: Not set (OK)")
    
    print("\n=== IAM Policy ===")
    policy = bucket.get_iam_policy(requested_policy_version=3)
    for binding in policy.bindings:
        if "allUsers" in binding.get("members", set()):
            print(f"✓ {binding['role']}: allUsers")
    
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()

