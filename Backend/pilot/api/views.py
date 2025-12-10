from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from openai import OpenAI


@api_view(["POST"])
@permission_classes([AllowAny])
def createOutline(request):
    client = OpenAI()
    response = client.responses.create(
    model="gpt-4.1",
    input="""






"""
)

    print(response.output_text)
    return Response({"done": response.output_text})