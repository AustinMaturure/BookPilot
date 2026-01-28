"""
Standalone script to test Cloud SQL connection.
Can be run without Django setup for quick testing.

Usage:
    # Test with Unix socket (Cloud Run)
    CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql \
    DB_NAME=bookpilot \
    DB_USER=bookpilot_user \
    DB_PASSWORD=your_password \
    python test_cloud_sql.py

    # Test with IP connection
    DB_HOST=10.123.45.67 \
    DB_PORT=5432 \
    DB_NAME=bookpilot \
    DB_USER=bookpilot_user \
    DB_PASSWORD=your_password \
    python test_cloud_sql.py
"""
import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

try:
    import psycopg2
    from psycopg2 import sql
except ImportError:
    print("ERROR: psycopg2 not installed. Install with: pip install psycopg2-binary")
    sys.exit(1)

def test_connection():
    print("\n=== Testing Cloud SQL Connection ===\n")
    
    # Get configuration
    connection_name = os.getenv("CLOUD_SQL_CONNECTION_NAME", "")
    db_name = os.getenv("DB_NAME", "bookpilot")
    db_user = os.getenv("DB_USER", "bookpilot_user")
    db_password = os.getenv("DB_PASSWORD", "")
    db_host = os.getenv("DB_HOST", "")
    db_port = os.getenv("DB_PORT", "5432")
    
    # Display configuration
    print("Configuration:")
    print(f"  Database: {db_name}")
    print(f"  User: {db_user}")
    print(f"  Password: {'*' * len(db_password) if db_password else 'NOT SET'}")
    
    if connection_name:
        print(f"  Connection Name: {connection_name}")
    
    if db_host:
        print(f"  Host: {db_host}")
        print(f"  Port: {db_port}")
    else:
        print(f"  Host: /cloudsql/{connection_name} (Unix socket)")
        print(f"  Port: N/A (Unix socket)")
    
    print()
    
    # Determine connection method
    if connection_name and not db_host:
        # Unix socket connection
        print("Connecting via Unix socket...")
        conn_string = f"dbname={db_name} user={db_user} password={db_password} host=/cloudsql/{connection_name}"
    elif db_host:
        # IP connection
        print(f"Connecting via IP ({db_host}:{db_port})...")
        conn_string = f"dbname={db_name} user={db_user} password={db_password} host={db_host} port={db_port}"
    else:
        print("ERROR: Either CLOUD_SQL_CONNECTION_NAME or DB_HOST must be set")
        print("\nFor Unix socket:")
        print("  export CLOUD_SQL_CONNECTION_NAME=bookpilot-483718:us-central1:bookpilot-sql")
        print("\nFor IP connection:")
        print("  export DB_HOST=your_ip_address")
        print("  export DB_PORT=5432")
        sys.exit(1)
    
    if not db_password:
        print("ERROR: DB_PASSWORD is required")
        sys.exit(1)
    
    # Test connection
    try:
        print("Attempting connection...")
        conn = psycopg2.connect(conn_string)
        print("✓ Connection successful!\n")
        
        # Run test queries
        cursor = conn.cursor()
        
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"PostgreSQL version: {version}")
        
        cursor.execute("SELECT current_database();")
        db = cursor.fetchone()[0]
        print(f"Connected to database: {db}")
        
        cursor.execute("SELECT current_user;")
        user = cursor.fetchone()[0]
        print(f"Connected as user: {user}")
        
        cursor.execute("""
            SELECT COUNT(*) 
            FROM information_schema.tables 
            WHERE table_schema = 'public';
        """)
        table_count = cursor.fetchone()[0]
        print(f"Tables in database: {table_count}")
        
        cursor.close()
        conn.close()
        
        print("\n=== Connection Test Complete ===\n")
        return True
        
    except psycopg2.OperationalError as e:
        print(f"\n✗ Connection failed!")
        print(f"Error: {e}")
        print("\nTroubleshooting:")
        print("1. Check that all environment variables are set correctly")
        print("2. For Unix socket: Ensure you're running in Google Cloud (Cloud Run/App Engine)")
        print("3. For IP connection: Ensure the IP is authorized in Cloud SQL")
        print("4. Verify database credentials are correct")
        print("5. Check Cloud SQL instance is running")
        return False
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_connection()
    sys.exit(0 if success else 1)

