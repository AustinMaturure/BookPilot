from django.urls import path
from .views import createOutline

urlpatterns = [
    path('create_outline/', createOutline)
]