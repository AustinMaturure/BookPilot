from django.urls import path
from .views import google_login, email_signup, email_login, get_current_user

urlpatterns = [
    path('google_login/', google_login),
    path('email_signup/', email_signup),
    path('email_login/', email_login),
    path('current_user/', get_current_user),
]