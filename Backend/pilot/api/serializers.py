from rest_framework import serializers
from pilot.models import Book, Chapter, Section, TalkingPoint

# TalkingPoint Serializer
class TalkingPointSerializer(serializers.ModelSerializer):
    class Meta:
        model = TalkingPoint
        fields = ["id", "text", "order"]

# Section Serializer with nested talking points
class SectionSerializer(serializers.ModelSerializer):
    talking_points = TalkingPointSerializer(many=True, read_only=True)

    class Meta:
        model = Section
        fields = ["id", "title", "order", "talking_points"]

# Chapter Serializer with nested sections
class ChapterSerializer(serializers.ModelSerializer):
    sections = SectionSerializer(many=True, read_only=True)

    class Meta:
        model = Chapter
        fields = ["id", "title", "order", "sections"]

# Book Serializer with nested chapters
class BookSerializer(serializers.ModelSerializer):
    chapters = ChapterSerializer(many=True, read_only=True)

    class Meta:
        model = Book
        fields = ["id", "title", "chapters"]
