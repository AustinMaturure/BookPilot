"""
Script to verify and fix Google Cloud Storage bucket IAM permissions.
Run with: python verify_bucket_permissions.py
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
    
    print(f"\n=== Checking Bucket: {bucket_name} ===\n")
    
    # Check current IAM policy
    print("Current IAM Policy:")
    try:
        policy = bucket.get_iam_policy(requested_policy_version=3)
        
        has_public_access = False
        for binding in policy.bindings:
            print(f"  Role: {binding['role']}")
            print(f"  Members: {list(binding.get('members', set()))}")
            if binding["role"] == "roles/storage.objectViewer" and "allUsers" in binding.get("members", set()):
                has_public_access = True
            print()
        
        if not has_public_access:
            print("⚠️  Public access NOT configured!")
            print("\nFixing permissions...")
            
            # Add allUsers to storage.objectViewer role
            found_binding = False
            for binding in policy.bindings:
                if binding["role"] == "roles/storage.objectViewer":
                    if "members" not in binding:
                        binding["members"] = set()
                    binding["members"].add("allUsers")
                    found_binding = True
                    break
            
            if not found_binding:
                # Create new binding
                policy.bindings.append({
                    "role": "roles/storage.objectViewer",
                    "members": {"allUsers"}
                })
            
            # Update policy
            bucket.set_iam_policy(policy)
            print("✓ IAM policy updated - allUsers can now read objects")
            
            # Verify
            print("\nVerifying update...")
            policy = bucket.get_iam_policy(requested_policy_version=3)
            for binding in policy.bindings:
                if binding["role"] == "roles/storage.objectViewer" and "allUsers" in binding.get("members", set()):
                    print("✓ Public access confirmed!")
                    break
        else:
            print("✓ Public access is already configured")
            
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        print("\nYou may need to set permissions manually:")
        print(f"1. Go to: https://console.cloud.google.com/storage/browser/{bucket_name}?project={os.getenv('GS_PROJECT_ID', 'bookpilot-483718')}")
        print("2. Click on the bucket → Permissions tab")
        print("3. Click 'Grant Access'")
        print("4. Principal: allUsers")
        print("5. Role: Storage Object Viewer")
        print("6. Save")
    
    # Test file upload and URL
    print("\n=== Testing File Upload ===")
    try:
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        import django
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'base.settings')
        django.setup()
        
        test_content = b"Test file for permission verification"
        test_path = "test_permissions/verify.txt"
        
        saved_path = default_storage.save(test_path, ContentFile(test_content))
        file_url = default_storage.url(saved_path)
        
        print(f"✓ File uploaded: {saved_path}")
        print(f"✓ File URL: {file_url}")
        print(f"\nTry accessing this URL in your browser:")
        print(f"{file_url}")
        print("\nIf you get 'Access denied', the IAM policy needs to be set manually in Google Cloud Console.")
        
    except Exception as e:
        print(f"⚠️  Could not test file upload: {e}")
    
except ImportError:
    print("ERROR: google-cloud-storage not installed")
    print("Install with: pip install google-cloud-storage")
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()

