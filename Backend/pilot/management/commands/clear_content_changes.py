"""
Management command to clear all existing content changes.
Use this to start fresh with the new suggested edits system.
"""
from django.core.management.base import BaseCommand
from pilot.models import ContentChange


class Command(BaseCommand):
    help = 'Clear all existing content changes to start fresh'

    def add_arguments(self, parser):
        parser.add_argument(
            '--confirm',
            action='store_true',
            help='Confirm deletion (required to actually delete)',
        )

    def handle(self, *args, **options):
        count = ContentChange.objects.count()
        
        if not options['confirm']:
            self.stdout.write(
                self.style.WARNING(
                    f'Found {count} content changes. Use --confirm to delete them all.'
                )
            )
            return
        
        deleted = ContentChange.objects.all().delete()[0]
        self.stdout.write(
            self.style.SUCCESS(f'Successfully deleted {deleted} content changes.')
        )

