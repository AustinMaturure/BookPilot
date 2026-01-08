# Generated manually to enforce step_json non-nullable constraint

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pilot', '0014_alter_contentchange_options_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='contentchange',
            name='step_json',
            field=models.JSONField(default=list, null=False),
        ),
    ]

