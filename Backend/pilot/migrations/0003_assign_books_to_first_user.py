# Data migration to assign existing books to the first user

from django.db import migrations


def assign_books_to_first_user(apps, schema_editor):
    Book = apps.get_model('pilot', 'Book')
    User = apps.get_model('accounts', 'User')
    
    # Get the first user, or create a default one if none exists
    first_user = User.objects.first()
    if not first_user:
        # Create a default user if none exists
        first_user = User.objects.create_user(
            username='default_user',
            email='default@example.com',
            password='default_password_change_me'
        )
    
    # Assign all books without a user to the first user
    Book.objects.filter(user__isnull=True).update(user=first_user)


def reverse_assign_books(apps, schema_editor):
    # Reverse: set user to null (but we'll keep it for data integrity)
    Book = apps.get_model('pilot', 'Book')
    Book.objects.all().update(user=None)


class Migration(migrations.Migration):

    dependencies = [
        ('pilot', '0002_book_user'),
    ]

    operations = [
        migrations.RunPython(assign_books_to_first_user, reverse_assign_books),
    ]

