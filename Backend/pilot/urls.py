from django.urls import path, include


urlpatterns = [
    path('api/', include('pilot.api.urls'))
]