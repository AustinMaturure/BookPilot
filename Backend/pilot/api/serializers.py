from rest_framework import serializers
from pilot.models import Book, Chapter, Section, TalkingPoint, Comment, ContentChange

# TalkingPoint Serializer
class TalkingPointSerializer(serializers.ModelSerializer):
    class Meta:
        model = TalkingPoint
        fields = ["id", "text", "order", "content"]


class CommentSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_email = serializers.CharField(source="user.email", read_only=True, default="")
    replies = serializers.SerializerMethodField()
    parent = serializers.PrimaryKeyRelatedField(read_only=True)
    parent_user_name = serializers.SerializerMethodField()
    
    def get_user_name(self, obj):
        if obj.user:
            return obj.user.first_name or obj.user.username or obj.user.email.split("@")[0]
        return "Unknown User"
    
    def get_parent_user_name(self, obj):
        if obj.parent and obj.parent.user:
            return obj.parent.user.first_name or obj.parent.user.username or obj.parent.user.email.split("@")[0]
        elif obj.parent and obj.parent.comment_type == "ai":
            return "AI Coach Review"
        return None
    
    def get_replies(self, obj):
        # Get replies ordered by created_at (oldest first)
        replies = obj.replies.all().order_by("created_at")
        return CommentSerializer(replies, many=True).data
    
    class Meta:
        model = Comment
        fields = ["id", "talking_point", "user", "user_name", "user_email", "text", "comment_type", "suggested_replacement", "parent", "parent_user_name", "replies", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at", "replies", "parent_user_name"]

# Section Serializer with nested talking points
class SectionSerializer(serializers.ModelSerializer):
    talking_points = serializers.SerializerMethodField()

    def get_talking_points(self, obj):
        # Ensure talking points are ordered by the 'order' field
        tps = obj.talking_points.all().order_by('order')
        return TalkingPointSerializer(tps, many=True).data

    class Meta:
        model = Section
        fields = ["id", "title", "order", "talking_points"]

# Chapter Serializer with nested sections
class ChapterSerializer(serializers.ModelSerializer):
    sections = SectionSerializer(many=True, read_only=True)

    class Meta:
        model = Chapter
        fields = ["id", "title", "order", "sections"]

# ContentChange Serializer - step-native system
class ContentChangeSerializer(serializers.ModelSerializer):
    step_json = serializers.JSONField()  # REQUIRED - steps are the source of truth
    user_name = serializers.SerializerMethodField()
    user_email = serializers.CharField(source="user.email", read_only=True, default="")
    approved_by_name = serializers.SerializerMethodField()
    
    def get_user_name(self, obj):
        if obj.user:
            return obj.user.first_name or obj.user.username or obj.user.email.split("@")[0]
        return "Unknown User"
    
    def get_approved_by_name(self, obj):
        if obj.approved_by:
            return obj.approved_by.first_name or obj.approved_by.username or obj.approved_by.email.split("@")[0]
        return None
    
    class Meta:
        model = ContentChange
        fields = [
            "id", "talking_point", "user", "user_name", "user_email",
            "step_json", "comment", "status",
            "created_at", "updated_at", "approved_by", "approved_by_name", "approved_at"
        ]
        read_only_fields = ["id", "created_at", "updated_at", "approved_by", "approved_at"]

# Book Serializer with nested chapters
class BookSerializer(serializers.ModelSerializer):
    chapters = ChapterSerializer(many=True, read_only=True)

    class Meta:
        model = Book
        fields = ["id", "title", "chapters", "core_topic", "audience", "audience_tag"]
