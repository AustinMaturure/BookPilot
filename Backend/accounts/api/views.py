from google.oauth2 import id_token
from google.auth.transport import requests
from django.contrib.auth import get_user_model
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
import requests as http
import os
from dotenv import load_dotenv

User = get_user_model()
load_dotenv()


def exchange_code_for_tokens(code):
    data = {
        "code": code,
        "client_id": os.getenv("CLIENT_ID"),
        "client_secret": os.getenv("CLIENT_SECRET"),
        "grant_type": "authorization_code",
        "redirect_uri": "postmessage"
    }

    r = http.post("https://oauth2.googleapis.com/token", data=data)
    return r.json()


@api_view(["POST"])
@permission_classes([AllowAny])
def google_login(request):

    code = request.data.get("code")  # <-- FIXED
    if not code:
        return Response({"error": "No auth code provided"}, status=400)

    # Exchange the auth code for access + ID tokens
    tokens = exchange_code_for_tokens(code)

    if "id_token" not in tokens:
        return Response({"error": "Failed to exchange auth code"}, status=400)

    id_token_jwt = tokens["id_token"]

    try:
        # Decode ID token
        idinfo = id_token.verify_oauth2_token(id_token_jwt, requests.Request())

        email = idinfo["email"]
        name = idinfo.get("name", "")

        user, created = User.objects.get_or_create(
            email=email,
            defaults={"username": email, "first_name": name},
        )

        if created:
            user.set_unusable_password()
            user.save()

        return Response({
            "message": "User authenticated",
            "email": email,
            "name": name,
            "created": created
        })

    except Exception as e:
        print("Google token error:", e)
        return Response({"error": "Invalid Google token"}, status=400)
