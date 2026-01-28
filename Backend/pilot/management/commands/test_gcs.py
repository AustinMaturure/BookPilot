"""
Django management command to test Google Cloud Storage connection and functionality.
Run with: python manage.py test_gcs
"""
from django.core.management.base import BaseCommand
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.conf import settings
import os


class Command(BaseCommand):
    help = 'Test Google Cloud Storage connection and file operations'

    def add_arguments(self, parser):
        parser.add_argument(
            '--cleanup',
            action='store_true',
            help='Clean up test files after testing',
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('\n=== Testing Google Cloud Storage ===\n'))
        
        # Check if GCS is enabled
        use_gcs = getattr(settings, 'USE_GCS', False)
        if not use_gcs:
            self.stdout.write(self.style.WARNING('⚠️  USE_GCS is not enabled. Set USE_GCS=true in .env'))
            self.stdout.write('Current storage backend: ' + str(type(default_storage).__name__))
            return
        
        self.stdout.write(f'✓ USE_GCS is enabled')
        self.stdout.write(f'✓ Storage backend: {type(default_storage).__name__}')
        
        # Check bucket configuration
        try:
            bucket_name = getattr(settings, 'GS_BUCKET_NAME', None)
            project_id = getattr(settings, 'GS_PROJECT_ID', None)
            self.stdout.write(f'✓ Bucket name: {bucket_name}')
            self.stdout.write(f'✓ Project ID: {project_id}')
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'✗ Error reading GCS settings: {e}'))
            return
        
        # Check credentials
        try:
            credentials = getattr(settings, 'GS_CREDENTIALS', None)
            if credentials:
                self.stdout.write(f'✓ Credentials loaded: {credentials.service_account_email}')
            else:
                self.stdout.write(self.style.WARNING('⚠️  No credentials found, using default'))
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'⚠️  Could not verify credentials: {e}'))
        
        self.stdout.write('\n--- Testing File Operations ---\n')
        
        # Test 1: Upload a test file
        test_content = b"This is a test file for Google Cloud Storage\nCreated by test_gcs command"
        test_filename = "test_gcs/test_file.txt"
        
        try:
            self.stdout.write(f'1. Uploading test file: {test_filename}')
            saved_path = default_storage.save(test_filename, ContentFile(test_content))
            self.stdout.write(self.style.SUCCESS(f'   ✓ File uploaded successfully'))
            self.stdout.write(f'   Saved path: {saved_path}')
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'   ✗ Upload failed: {e}'))
            return
        
        # Test 2: Check if file exists
        try:
            self.stdout.write(f'\n2. Checking if file exists: {saved_path}')
            exists = default_storage.exists(saved_path)
            if exists:
                self.stdout.write(self.style.SUCCESS(f'   ✓ File exists'))
            else:
                self.stdout.write(self.style.ERROR(f'   ✗ File does not exist'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'   ✗ Error checking file: {e}'))
        
        # Test 3: Get file URL
        try:
            self.stdout.write(f'\n3. Getting file URL')
            file_url = default_storage.url(saved_path)
            self.stdout.write(self.style.SUCCESS(f'   ✓ File URL: {file_url}'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'   ✗ Error getting URL: {e}'))
        
        # Test 4: Read file content
        try:
            self.stdout.write(f'\n4. Reading file content')
            with default_storage.open(saved_path, 'r') as f:
                content = f.read()
            self.stdout.write(self.style.SUCCESS(f'   ✓ File read successfully'))
            self.stdout.write(f'   Content preview: {content[:50]}...')
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'   ✗ Error reading file: {e}'))
        
        # Test 5: List files in test directory
        try:
            self.stdout.write(f'\n5. Listing files in test_gcs/ directory')
            files = default_storage.listdir('test_gcs/')
            self.stdout.write(self.style.SUCCESS(f'   ✓ Found {len(files[1])} file(s)'))
            for filename in files[1][:5]:  # Show first 5 files
                self.stdout.write(f'   - {filename}')
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'   ⚠️  Could not list files: {e}'))
        
        # Test 6: Get file size
        try:
            self.stdout.write(f'\n6. Getting file size')
            size = default_storage.size(saved_path)
            self.stdout.write(self.style.SUCCESS(f'   ✓ File size: {size} bytes'))
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'   ⚠️  Could not get file size: {e}'))
        
        # Cleanup
        if options['cleanup']:
            try:
                self.stdout.write(f'\n7. Cleaning up test file')
                default_storage.delete(saved_path)
                self.stdout.write(self.style.SUCCESS(f'   ✓ Test file deleted'))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'   ✗ Error deleting file: {e}'))
        else:
            self.stdout.write(f'\n7. Test file left in storage: {saved_path}')
            self.stdout.write(self.style.WARNING('   Run with --cleanup to delete test files'))
        
        self.stdout.write(self.style.SUCCESS('\n=== Test Complete ===\n'))
        
        # Additional info
        self.stdout.write('To verify in Google Cloud Console:')
        self.stdout.write(f'https://console.cloud.google.com/storage/browser/{bucket_name}?project={project_id}')

