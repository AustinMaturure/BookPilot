"""
Django management command to test database connection.
Usage: python manage.py test_db_connection
"""
from django.core.management.base import BaseCommand
from django.db import connection
from django.conf import settings
import sys


class Command(BaseCommand):
    help = 'Test database connection to Cloud SQL or configured database'

    def handle(self, *args, **options):
        self.stdout.write("\n=== Testing Database Connection ===\n")
        
        # Display configuration
        db_config = settings.DATABASES['default']
        self.stdout.write(f"Engine: {db_config['ENGINE']}")
        self.stdout.write(f"Database: {db_config['NAME']}")
        self.stdout.write(f"User: {db_config['USER']}")
        self.stdout.write(f"Host: {db_config.get('HOST', 'Not set')}")
        self.stdout.write(f"Port: {db_config.get('PORT', 'Not set')}")
        self.stdout.write("")
        
        # Test connection
        try:
            with connection.cursor() as cursor:
                # Check database engine
                engine = db_config['ENGINE']
                
                if 'postgresql' in engine:
                    # PostgreSQL/Cloud SQL specific tests
                    cursor.execute("SELECT version();")
                    version = cursor.fetchone()
                    self.stdout.write(self.style.SUCCESS(f"✓ PostgreSQL connection successful!"))
                    self.stdout.write(f"  PostgreSQL version: {version[0]}")
                    
                    cursor.execute("SELECT current_database();")
                    db_name = cursor.fetchone()
                    self.stdout.write(f"  Connected to database: {db_name[0]}")
                    
                    cursor.execute("SELECT current_user;")
                    user = cursor.fetchone()
                    self.stdout.write(f"  Connected as user: {user[0]}")
                    
                    # Test table count
                    try:
                        cursor.execute("""
                            SELECT COUNT(*) 
                            FROM information_schema.tables 
                            WHERE table_schema = 'public';
                        """)
                        table_count = cursor.fetchone()[0]
                        self.stdout.write(f"  Tables in database: {table_count}")
                    except Exception as e:
                        self.stdout.write(self.style.WARNING(f"  Could not count tables: {e}"))
                        
                elif 'sqlite' in engine:
                    # SQLite specific tests
                    cursor.execute("SELECT sqlite_version();")
                    version = cursor.fetchone()
                    self.stdout.write(self.style.SUCCESS(f"✓ SQLite connection successful!"))
                    self.stdout.write(f"  SQLite version: {version[0]}")
                    self.stdout.write(f"  Database file: {db_config['NAME']}")
                    
                    # Test table count
                    try:
                        cursor.execute("""
                            SELECT COUNT(*) 
                            FROM sqlite_master 
                            WHERE type='table';
                        """)
                        table_count = cursor.fetchone()[0]
                        self.stdout.write(f"  Tables in database: {table_count}")
                    except Exception as e:
                        self.stdout.write(self.style.WARNING(f"  Could not count tables: {e}"))
                else:
                    # Generic test
                    cursor.execute("SELECT 1;")
                    result = cursor.fetchone()
                    self.stdout.write(self.style.SUCCESS(f"✓ Connection successful!"))
                    self.stdout.write(f"  Test query result: {result[0]}")
                
                self.stdout.write("\n=== Connection Test Complete ===\n")
                return
                
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"\n✗ Connection failed!"))
            self.stdout.write(self.style.ERROR(f"Error: {str(e)}"))
            self.stdout.write("\nTroubleshooting:")
            self.stdout.write("1. Check environment variables:")
            self.stdout.write("   - CLOUD_SQL_CONNECTION_NAME")
            self.stdout.write("   - DB_NAME")
            self.stdout.write("   - DB_USER")
            self.stdout.write("   - DB_PASSWORD")
            self.stdout.write("   - DB_HOST (if using IP connection)")
            self.stdout.write("   - DB_PORT (if using IP connection)")
            self.stdout.write("\n2. For Unix socket (Cloud Run):")
            self.stdout.write("   - Ensure CLOUD_SQL_CONNECTION_NAME is set")
            self.stdout.write("   - Don't set DB_HOST")
            self.stdout.write("\n3. For IP connection:")
            self.stdout.write("   - Set DB_HOST to IP address")
            self.stdout.write("   - Set DB_PORT (usually 5432)")
            self.stdout.write("   - Ensure IP is authorized in Cloud SQL")
            self.stdout.write("\n4. For local development with Cloud SQL Proxy:")
            self.stdout.write("   - Run: cloud-sql-proxy bookpilot-483718:us-central1:bookpilot-sql")
            self.stdout.write("   - Set DB_HOST=127.0.0.1")
            self.stdout.write("   - Set DB_PORT=5432")
            sys.exit(1)

