from google.oauth2 import id_token  # type: ignore[import-not-found]
from google.auth.transport import requests  # type: ignore[import-not-found]
from django.contrib.auth import get_user_model, authenticate
from django.contrib.auth.hashers import make_password
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.authtoken.models import Token
import requests as http
import os
from dotenv import load_dotenv  # type: ignore[import-not-found]

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

        # Create or get token for the user
        token, _ = Token.objects.get_or_create(user=user)

        return Response({
            "message": "User authenticated",
            "token": token.key,
            "email": email,
            "name": name,
            "user_id": user.id,
            "created": created
        })

    except Exception as e:
        print("Google token error:", e)
        return Response({"error": "Invalid Google token"}, status=400)


@api_view(["POST"])
@permission_classes([AllowAny])
def email_signup(request):
    """Sign up with email and password."""
    email = request.data.get("email", "").strip()
    password = request.data.get("password", "")
    
    if not email or not password:
        return Response(
            {"error": "Email and password are required"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    if User.objects.filter(email=email).exists():
        return Response(
            {"error": "User with this email already exists"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        user = User.objects.create_user(
            username=email,
            email=email,
            password=password
        )
        token, _ = Token.objects.get_or_create(user=user)
        return Response({
            "message": "User created successfully",
            "token": token.key,
            "email": email,
            "user_id": user.id
        }, status=status.HTTP_201_CREATED)
    except Exception as e:
        return Response(
            {"error": str(e)},
            status=status.HTTP_400_BAD_REQUEST
        )


@api_view(["POST"])
@permission_classes([AllowAny])
def email_login(request):
    """Login with email and password."""
    email = request.data.get("email", "").strip()
    password = request.data.get("password", "")
    
    if not email or not password:
        return Response(
            {"error": "Email and password are required"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        user = User.objects.get(email=email)
        if user.check_password(password):
            token, _ = Token.objects.get_or_create(user=user)
            return Response({
                "message": "Login successful",
                "token": token.key,
                "email": email,
                "user_id": user.id
            }, status=status.HTTP_200_OK)
        else:
            return Response(
                {"error": "Invalid credentials"},
                status=status.HTTP_401_UNAUTHORIZED
            )
    except User.DoesNotExist:
        return Response(
            {"error": "Invalid credentials"},
            status=status.HTTP_401_UNAUTHORIZED
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_current_user(request):
    """Get current authenticated user info."""
    return Response({
        "email": request.user.email,
        "user_id": request.user.id,
        "username": request.user.username
    })
