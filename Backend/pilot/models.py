from django.db import models
from django.conf import settings
import json

# Create your models here.

class Book(models.Model):
    title = models.CharField(max_length=50)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="books", null=True, blank=True)
    core_topic = models.TextField(blank=True, null=True, help_text="The core topic of the book")
    audience = models.TextField(blank=True, null=True, help_text="The target audience for the book")
    
    def __str__(self):
        return f"{self.title} "
    
class Chapter(models.Model):
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="chapters")
    title = models.CharField(max_length=100)
    order = models.PositiveIntegerField(default=1)

    def __str__(self):
        return f"{self.book.title} - Chapter {self.order}: {self.title}"

class Section(models.Model):
    chapter = models.ForeignKey(Chapter, on_delete=models.CASCADE, related_name="sections")
    title = models.CharField(max_length=100)
    order = models.PositiveIntegerField(default=1)

    def __str__(self):
        return f"{self.chapter} - Section {self.order}: {self.title}"


class TalkingPoint(models.Model):
    section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name="talking_points")
    text = models.TextField()
    order = models.PositiveIntegerField(default=1)
    content = models.TextField(blank=True, null=True, help_text="Generated or edited content for this talking point")

    def __str__(self):
        return f"{self.section} - {self.text[:40]}"


class UserContext(models.Model):
    """User-provided context/information for AI generation"""
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="user_contexts")
    text = models.TextField()
    talking_point = models.ForeignKey(TalkingPoint, on_delete=models.CASCADE, related_name="contexts", null=True, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="contexts")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Context for {self.book.title} by {self.user.email}"


class ChapterAsset(models.Model):
    """Files uploaded for use in generating talking point content"""
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="assets")
    talking_point = models.ForeignKey(TalkingPoint, on_delete=models.CASCADE, related_name="assets", null=True, blank=True)
    file = models.FileField(upload_to="chapter_assets/")
    filename = models.CharField(max_length=255)
    file_type = models.CharField(max_length=50)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assets")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.file_type} asset for {self.book.title}"


class Comment(models.Model):
    """Comments on talking points - can be from AI or collaborators"""
    talking_point = models.ForeignKey(TalkingPoint, on_delete=models.CASCADE, related_name="comments")
    text = models.TextField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="comments", null=True, blank=True)
    comment_type = models.CharField(
        max_length=20,
        choices=[
            ("ai", "AI Coach Review"),
            ("user", "User Comment"),
            ("collaborator", "Collaborator Comment"),
        ],
        default="user",
    )
    suggested_replacement = models.TextField(blank=True, null=True, help_text="AI-suggested text replacement")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.comment_type} on {self.talking_point} - {self.text[:50]}"


class BookCollaborator(models.Model):
    """Tracks collaborators for a book"""
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="collaborators")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="collaborations")
    role = models.CharField(
        max_length=20,
        choices=[
            ("editor", "Editor"),
            ("viewer", "Viewer"),
            ("commenter", "Commenter"),
        ],
        default="commenter",
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invited_collaborators",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [["book", "user"]]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.email} - {self.role} on {self.book.title}"


class ContentChange(models.Model):
    """Tracks content changes/suggestions for collaborative editing using ProseMirror steps"""
    talking_point = models.ForeignKey(TalkingPoint, on_delete=models.CASCADE, related_name="content_changes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_changes")
    step_json = models.JSONField()  # ARRAY OF STEPS - the ONLY source of truth
    comment = models.TextField(blank=True, default="", help_text="Optional comment explaining the suggestion")
    status = models.CharField(
        max_length=20,
        choices=[
            ("pending", "Pending Approval"),
            ("approved", "Approved"),
            ("rejected", "Rejected"),
        ],
        default="pending",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_changes",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Suggestion by {self.user.email} on {self.talking_point} - {self.status}"


class CollaborationState(models.Model):
    """Tracks the collaborative editing state for a talking point using ProseMirror collab."""
    talking_point = models.OneToOneField(TalkingPoint, on_delete=models.CASCADE, related_name='collab_state')
    version = models.IntegerField(default=0)  # Current version number (number of steps)
    steps = models.TextField(default='[]')  # JSON array of serialized steps
    step_client_ids = models.TextField(default='[]')  # JSON array of client IDs
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def get_steps(self):
        """Get steps as a list."""
        try:
            return json.loads(self.steps)
        except:
            return []
    
    def set_steps(self, steps_list):
        """Set steps from a list."""
        self.steps = json.dumps(steps_list)
    
    def get_client_ids(self):
        """Get client IDs as a list."""
        try:
            return json.loads(self.step_client_ids)
        except:
            return []
    
    def set_client_ids(self, ids_list):
        """Set client IDs from a list."""
        self.step_client_ids = json.dumps(ids_list)
    
    class Meta:
        db_table = 'pilot_collaborationstate'
