from django.db import models
from django.conf import settings
import json

# Create your models here.

class Book(models.Model):
    title = models.CharField(max_length=255)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="books", null=True, blank=True)
    core_topic = models.TextField(blank=True, null=True, help_text="The core topic of the book")
    audience = models.TextField(blank=True, null=True, help_text="The target audience for the book")
    audience_tag = models.JSONField(
        blank=True,
        null=True,
        help_text="Emotional audience type tag: {primary: 'RED'|'BLUE'|'GREEN'|'YELLOW', secondary?: 'RED'|'BLUE'|'GREEN'|'YELLOW', confidence: float, reasoning: string}"
    )
    
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


def chapter_asset_upload_path(instance, filename):
    """
    Generate upload path for chapter assets.
    Structure: book_{book_id}/chapter_assets/[talking_point_{tp_id}/]{filename}
    """
    book_id = instance.book.id
    if instance.talking_point and instance.talking_point.id:
        # Talking point specific asset
        tp_id = instance.talking_point.id
        return f"book_{book_id}/chapter_assets/talking_point_{tp_id}/{filename}"
    else:
        # Chapter-level asset (available to all talking points in the book)
        return f"book_{book_id}/chapter_assets/{filename}"


class ChapterAsset(models.Model):
    """Files uploaded for use in generating talking point content"""
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="assets")
    talking_point = models.ForeignKey(TalkingPoint, on_delete=models.CASCADE, related_name="assets", null=True, blank=True)
    file = models.FileField(upload_to=chapter_asset_upload_path)
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
    parent = models.ForeignKey("self", on_delete=models.CASCADE, related_name="replies", null=True, blank=True, help_text="Parent comment if this is a reply")
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


# ============================================================================
# POSITIONING PILLARS - Strategic Book Positioning Engine
# ============================================================================

class PositioningPillar(models.Model):
    """
    Represents one of the 9 canonical positioning pillars for a book.
    Each pillar has its own micro-chat thread and must be completed before
    outline generation is allowed.
    
    THE 9 CANONICAL PILLARS:
    1. business_core - Business Core
    2. avatar - The Avatar (target reader persona)
    3. emotional_resonance - Emotional Resonance (Red/Yellow/Blue/Green)
    4. north_star - The North Star (core transformation promise)
    5. pain_points - Pain Points (specific reader struggles)
    6. the_shift - The Shift (false beliefs to overcome)
    7. the_edge - The Edge (differentiation from competitors)
    8. the_foundation - The Foundation (content pillars)
    9. the_authority - The Authority (framework/strong opinion)
    """
    PILLAR_STATUS_CHOICES = [
        ("LOCKED", "Locked"),
        ("ACTIVE", "Active"),
        ("COMPLETE", "Complete"),
    ]
    
    PILLAR_SLUGS = [
        ("business_core", "Business Core"),
        ("avatar", "The Avatar"),
        ("emotional_resonance", "Emotional Resonance"),
        ("north_star", "The North Star"),
        ("pain_points", "Pain Points"),
        ("the_shift", "The Shift"),
        ("the_edge", "The Edge"),
        ("the_foundation", "The Foundation"),
        ("the_authority", "The Authority"),
    ]
    
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="positioning_pillars")
    name = models.CharField(max_length=100)  # Human-readable name
    slug = models.CharField(max_length=50)  # Machine identifier
    order = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=PILLAR_STATUS_CHOICES, default="LOCKED")
    depth_score = models.FloatField(default=0.0, help_text="0-100 score for answer quality/depth")
    summary = models.TextField(blank=True, null=True, help_text="AI-generated summary when pillar is complete")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ["order"]
        unique_together = [["book", "slug"]]
    
    def __str__(self):
        return f"{self.book.title} - {self.name} ({self.status})"
    
    @classmethod
    def initialize_for_book(cls, book):
        """Create all 9 pillars for a book. First pillar is ACTIVE, rest are LOCKED."""
        pillars = []
        for i, (slug, name) in enumerate(cls.PILLAR_SLUGS, start=1):
            pillar, created = cls.objects.get_or_create(
                book=book,
                slug=slug,
                defaults={
                    "name": name,
                    "order": i,
                    "status": "ACTIVE" if i == 1 else "LOCKED",
                }
            )
            pillars.append(pillar)
        return pillars
    
    def unlock_next_pillar(self):
        """When this pillar completes, unlock the next one."""
        if self.status != "COMPLETE":
            return None
        next_pillar = PositioningPillar.objects.filter(
            book=self.book,
            order__gt=self.order,
            status="LOCKED"
        ).order_by("order").first()
        if next_pillar:
            next_pillar.status = "ACTIVE"
            next_pillar.save()
        return next_pillar


class PillarChatMessage(models.Model):
    """
    Individual message in a pillar's micro-chat thread.
    Preserves full conversation history for context continuity.
    """
    ROLE_CHOICES = [
        ("user", "User"),
        ("assistant", "Assistant"),
        ("system", "System"),
    ]
    
    pillar = models.ForeignKey(PositioningPillar, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField()
    # State emission after assistant responses
    state_emission = models.JSONField(blank=True, null=True, help_text="Progress state emitted after assistant turns")
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ["created_at"]
    
    def __str__(self):
        return f"{self.pillar.name} - {self.role}: {self.content[:50]}..."


class PositioningBrief(models.Model):
    """
    Master Positioning Brief - aggregated from all completed pillars.
    Only generated when ALL 9 pillars are COMPLETE.
    """
    book = models.OneToOneField(Book, on_delete=models.CASCADE, related_name="positioning_brief")
    brief_text = models.TextField(help_text="Full aggregated positioning brief")
    pillar_summaries = models.JSONField(help_text="Dict of pillar_slug -> summary")
    generated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Positioning Brief for {self.book.title}"
