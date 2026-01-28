from django.contrib import admin
from .models import *
# Register your models here.

admin.site.register(Book)
admin.site.register(Chapter)
admin.site.register(Section)
admin.site.register(TalkingPoint)
admin.site.register(UserContext)
admin.site.register(ChapterAsset)
admin.site.register(Comment)
admin.site.register(BookCollaborator)
admin.site.register(ContentChange)
admin.site.register(CollaborationState)

