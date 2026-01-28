import json
import os
from typing import List

from django.db import transaction
from django.db.models import Prefetch
from openai import OpenAI  # type: ignore[import-not-found]
from pydantic import BaseModel  # type: ignore[import-not-found]
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from pilot.api.serializers import BookSerializer, CommentSerializer, ContentChangeSerializer
from pilot.models import Book, Chapter, Section, TalkingPoint, UserContext, ChapterAsset, Comment, BookCollaborator, ContentChange, CollaborationState, PositioningPillar, PillarChatMessage, PositioningBrief
from pilot.api.checks import run_book_checks


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    """Simple health check endpoint for Docker/load balancers."""
    return Response({"status": "ok"}, status=status.HTTP_200_OK)


def user_has_book_access(user, book):
    """Check if user is the book owner or a collaborator."""
    if book.user == user:
        return True
    return BookCollaborator.objects.filter(book=book, user=user).exists()

def user_can_edit_book(user, book):
    """Check if user can edit the book (owner or editor collaborator)."""
    if book.user == user:
        return True
    collaborator = BookCollaborator.objects.filter(book=book, user=user).first()
    return collaborator and collaborator.role == "editor"

def user_can_comment_book(user, book):
    """Check if user can comment on the book (owner, editor, or commenter)."""
    if book.user == user:
        return True
    collaborator = BookCollaborator.objects.filter(book=book, user=user).first()
    return collaborator and collaborator.role in ["editor", "commenter"]


def extract_text_from_file(asset):
    """Extract text content from uploaded file based on file type."""
    try:
        file_ext = asset.file_type.lower()
        
        if file_ext == "txt":
            # Read plain text file
            # Use file path directly since FieldFile.open() doesn't support encoding parameter
            with open(asset.file.path, 'r', encoding='utf-8') as f:
                content = f.read()
            return content
        
        elif file_ext == "csv":
            # Read CSV file
            import csv
            # Use file path directly since FieldFile.open() doesn't support encoding parameter
            with open(asset.file.path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                rows = []
                for row in reader:
                    rows.append(", ".join(row))
            return "\n".join(rows)
        
        elif file_ext in ["docx", "doc"]:
            # Read DOCX file
            try:
                from docx import Document
                with asset.file.open('rb') as f:
                    doc = Document(f)
                    paragraphs = [para.text for para in doc.paragraphs]
                return "\n".join(paragraphs)
            except ImportError:
                return f"[DOCX file: {asset.filename} - python-docx not installed]"
        
        elif file_ext == "pdf":
            # Read PDF file
            try:
                import PyPDF2
                with asset.file.open('rb') as f:
                    pdf_reader = PyPDF2.PdfReader(f)
                    text = ""
                    for page in pdf_reader.pages:
                        text += page.extract_text() + "\n"
                return text
            except ImportError:
                return f"[PDF file: {asset.filename} - PyPDF2 not installed]"
        
        elif file_ext == "mp3":
            # Audio file - would need transcription service
            return f"[Audio file: {asset.filename} - transcription not yet implemented]"
        
        return f"[Unsupported file type: {asset.filename}]"
    except Exception as e:
        return f"[Error reading {asset.filename}: {str(e)}]"


def _build_prompt(answers: list[dict[str, str]]) -> str:
    """Convert the Q&A list into a comprehensive, structured prompt for the model."""
    lines = [
        "You are an expert book outline generator. Use the following comprehensive author interview to create a detailed, well-structured book outline.",
        "",
        "AUTHOR INTERVIEW RESPONSES:",
        "=" * 50
    ]
    
    # Organize answers by key if available, otherwise by order
    answer_map = {}
    for item in answers:
        key = item.get("key", "")
        question = item.get("question", "").strip()
        answer = item.get("answer", "").strip()
        
        if key:
            answer_map[key] = {"question": question, "answer": answer}
        else:
            # Fallback for old format
            if question or answer:
                lines.append(f"\nQ: {question}")
                lines.append(f"A: {answer}")
    
    # Build structured prompt with organized sections
    if answer_map:
        # Core Topic
        if "core_topic" in answer_map:
            lines.append("\n[CORE TOPIC]")
            lines.append(f"Q: {answer_map['core_topic']['question']}")
            lines.append(f"A: {answer_map['core_topic']['answer']}")
        
        # Personal Connection
        if "personal_connection" in answer_map:
            lines.append("\n[PERSONAL CONNECTION & AUTHOR'S PERSPECTIVE]")
            lines.append(f"Q: {answer_map['personal_connection']['question']}")
            lines.append(f"A: {answer_map['personal_connection']['answer']}")
        
        # Ideal Reader
        if "ideal_reader" in answer_map:
            lines.append("\n[TARGET AUDIENCE]")
            lines.append(f"Q: {answer_map['ideal_reader']['question']}")
            lines.append(f"A: {answer_map['ideal_reader']['answer']}")
        
        # Main Challenge
        if "main_challenge" in answer_map:
            lines.append("\n[READER'S MAIN CHALLENGE]")
            lines.append(f"Q: {answer_map['main_challenge']['question']}")
            lines.append(f"A: {answer_map['main_challenge']['answer']}")
        
        # Misconceptions
        if "misconceptions" in answer_map:
            lines.append("\n[COMMON MISCONCEPTIONS]")
            lines.append(f"Q: {answer_map['misconceptions']['question']}")
            lines.append(f"A: {answer_map['misconceptions']['answer']}")
        
        # Existing Solutions
        if "existing_solutions" in answer_map:
            lines.append("\n[WHY EXISTING SOLUTIONS FAIL]")
            lines.append(f"Q: {answer_map['existing_solutions']['question']}")
            lines.append(f"A: {answer_map['existing_solutions']['answer']}")
        
        # Unique Approach
        if "unique_approach" in answer_map:
            lines.append("\n[AUTHOR'S UNIQUE SOLUTION]")
            lines.append(f"Q: {answer_map['unique_approach']['question']}")
            lines.append(f"A: {answer_map['unique_approach']['answer']}")
        
        # Key Insight
        if "key_insight" in answer_map:
            lines.append("\n[KEY TRANSFORMATION]")
            lines.append(f"Q: {answer_map['key_insight']['question']}")
            lines.append(f"A: {answer_map['key_insight']['answer']}")
        
        # Book Structure
        if "book_structure" in answer_map:
            lines.append("\n[PROPOSED BOOK STRUCTURE]")
            lines.append(f"Q: {answer_map['book_structure']['question']}")
            lines.append(f"A: {answer_map['book_structure']['answer']}")
    
    lines.append("\n" + "=" * 50)
    lines.append("\nOUTLINE REQUIREMENTS:")
    lines.append("- Create a comprehensive book outline with 4-8 chapters")
    lines.append("- Each chapter must have 3-6 sections")
    lines.append("- Each section must have 4-8 detailed talking points")
    lines.append("- The outline should follow a logical progression that addresses the reader's journey")
    lines.append("- Chapter titles should be compelling and action-oriented")
    lines.append("- Section titles should be specific and guide the reader through each concept")
    lines.append("- Talking points should be detailed enough to guide writing, not just bullet points")
    lines.append("- Ensure the outline addresses all aspects mentioned in the interview")
    lines.append("- The book title should be engaging and reflect the core topic and unique approach")
    lines.append("\nReturn JSON only in the specified format.")
    
    return "\n".join(lines)


def _build_prompt_from_brief(brief: 'PositioningBrief') -> str:
    """Build outline prompt from the Master Positioning Brief (pillar-driven flow)."""
    lines = [
        "You are an expert book outline generator. Use the following MASTER POSITIONING BRIEF to create a detailed, well-structured book outline.",
        "",
        "This brief was created through a comprehensive 9-pillar positioning process. Each pillar represents deep strategic thinking about the book.",
        "",
        "=" * 50,
        "MASTER POSITIONING BRIEF",
        "=" * 50,
    ]
    
    pillar_summaries = brief.pillar_summaries or {}
    
    # Add each pillar's summary
    pillar_order = [
        ("business_core", "BUSINESS CORE"),
        ("avatar", "TARGET READER (AVATAR)"),
        ("emotional_resonance", "EMOTIONAL DRIVERS"),
        ("north_star", "NORTH STAR TRANSFORMATION"),
        ("pain_points", "PAIN POINTS"),
        ("the_shift", "BELIEF SHIFTS"),
        ("the_edge", "DIFFERENTIATION (THE EDGE)"),
        ("the_foundation", "CONTENT PILLARS (FOUNDATION)"),
        ("the_authority", "AUTHORITY & FRAMEWORK"),
    ]
    
    for slug, label in pillar_order:
        data = pillar_summaries.get(slug, {})
        summary = data.get("summary", "") if isinstance(data, dict) else ""
        if summary:
            lines.append(f"\n[{label}]")
            lines.append(summary)
    
    lines.append("\n" + "=" * 50)
    lines.append("\nOUTLINE REQUIREMENTS:")
    lines.append("- Create a comprehensive book outline with 4-8 chapters")
    lines.append("- Each chapter must have 3-6 sections")
    lines.append("- Each section must have 4-8 detailed talking points")
    lines.append("- The outline MUST align with the Content Pillars identified in THE FOUNDATION")
    lines.append("- The reader journey must address all Pain Points and guide toward the North Star transformation")
    lines.append("- Chapter titles should be compelling and action-oriented")
    lines.append("- Incorporate The Shift (belief changes) throughout the structure")
    lines.append("- The Authority framework should be woven into the chapter structure")
    lines.append("- Section titles should be specific and guide the reader through each concept")
    lines.append("- Talking points should be detailed enough to guide writing, not just bullet points")
    lines.append("- The book title should reflect the core topic and unique approach from THE EDGE")
    lines.append("\nReturn JSON only in the specified format.")
    
    return "\n".join(lines)


def buildAudienceAwarePrompt(basePrompt: str, audienceTag: dict | None, book: Book | None = None) -> str:
    """
    Build an audience-aware prompt by injecting emotional audience type rules.
    This is MANDATORY for all AI generation - violating tone/structure rules is an error.
    
    Args:
        basePrompt: The base prompt without audience constraints
        audienceTag: The audience tag dict with primary, optional secondary, confidence, reasoning
        book: Optional Book object to fetch tag if not provided
    
    Returns:
        Enhanced prompt with audience-specific writing constraints
    """
    # Get audience tag from book if not provided
    if not audienceTag and book:
        audienceTag = book.audience_tag
    
    if not audienceTag:
        # If no tag exists, return base prompt with warning
        return basePrompt + "\n\n[NOTE: No audience tag available - use neutral, professional tone]"
    
    primary = audienceTag.get("primary", "").upper()
    secondary = audienceTag.get("secondary")
    if secondary:
        secondary = secondary.upper()
    
    # Define writing style rulesets (DO NOT SUMMARIZE - USE DIRECTLY)
    rulesets = {
        "BLUE": {
            "tone": "Decisive, ambitious, efficient",
            "sentence_length": "8–16 words",
            "structure": "Claim → proof → next step",
            "avoid": "Softness, hype, overexplaining",
            "use": "Metrics, benchmarks, decisions, performance framing",
            "adjectives": "urgent, data-driven, efficient, exclusive",
            "verbs": "optimize, execute, prioritize, control",
            "nouns": "ambition, execution, results, best practice"
        },
        "RED": {
            "tone": "Playful, bold, energetic",
            "sentence_length": "5–14 words",
            "structure": "Hook → payoff → action",
            "avoid": "Long procedures, heavy detail",
            "use": "Surprise, novelty, experimentation",
            "adjectives": "bold, edgy, vibrant, experimental",
            "verbs": "explore, remix, reinvent, spark",
            "nouns": "vibe, trend, creativity, experience"
        },
        "YELLOW": {
            "tone": "Warm, inclusive, supportive",
            "sentence_length": "12–22 words",
            "structure": "Empathy → context → encouragement",
            "avoid": "Pressure, harsh directives",
            "use": "Belonging, reassurance, shared journey",
            "adjectives": "caring, gentle, welcoming",
            "verbs": "support, connect, encourage",
            "nouns": "community, trust, belonging"
        },
        "GREEN": {
            "tone": "Calm, structured, reliable",
            "sentence_length": "14–24 words",
            "structure": "Overview → steps → checks",
            "avoid": "Ambiguity, hype, skipping steps",
            "use": "Processes, safeguards, predictability",
            "adjectives": "safe, steady, proven",
            "verbs": "verify, plan, document",
            "nouns": "process, checklist, standards"
        }
    }
    
    if primary not in rulesets:
        # Invalid primary color - return base prompt with warning
        return basePrompt + f"\n\n[WARNING: Invalid audience tag primary color '{primary}' - use neutral tone]"
    
    primary_rules = rulesets[primary]
    
    # Build audience constraints section
    constraints = [
        "\n" + "=" * 70,
        "AUDIENCE-SPECIFIC WRITING CONSTRAINTS (MANDATORY - VIOLATING THESE IS AN ERROR)",
        "=" * 70,
        "",
        f"PRIMARY AUDIENCE TYPE: {primary}",
        "",
        "WRITING STYLE RULESET:",
        f"Tone: {primary_rules['tone']}",
        f"Sentence length: {primary_rules['sentence_length']}",
        f"Structure: {primary_rules['structure']}",
        f"Avoid: {primary_rules['avoid']}",
        f"Use: {primary_rules['use']}",
        "",
        "WORD CHOICE GUIDELINES:",
        f"Preferred adjectives: {primary_rules['adjectives']}",
        f"Preferred verbs: {primary_rules['verbs']}",
        f"Preferred nouns: {primary_rules['nouns']}",
    ]
    
    # Add secondary color influence if present
    if secondary and secondary in rulesets and secondary != primary:
        secondary_rules = rulesets[secondary]
        constraints.extend([
            "",
            f"SECONDARY AUDIENCE TYPE: {secondary} (subtle influence only)",
            f"- Primary color ({primary}) dominates tone and structure",
            f"- Secondary color ({secondary}) subtly influences examples and phrasing",
            f"- NEVER blend conflicting traits (e.g., {primary} hype + {secondary} caution)",
            "",
            f"Secondary tone elements: {secondary_rules['tone']}",
            f"Secondary preferred words: {secondary_rules['adjectives']}, {secondary_rules['verbs']}, {secondary_rules['nouns']}",
        ])
    
    constraints.extend([
        "",
        "CRITICAL ENFORCEMENT RULES:",
        "1. ALL generated content MUST follow the primary tone and structure rules above",
        "2. Sentence length MUST fall within the specified range",
        "3. Use the preferred word categories (adjectives, verbs, nouns) when appropriate",
        "4. Structure MUST follow the specified pattern (Claim→proof→next step, Hook→payoff→action, etc.)",
        "5. AVOID the listed 'avoid' elements completely",
        "6. If a secondary color exists, it influences examples/phrasing ONLY - primary dominates",
        "7. Violating these constraints is an ERROR - regenerate if output doesn't match",
        "",
        "=" * 70,
    ])
    
    # Combine base prompt with constraints
    enhanced_prompt = basePrompt + "\n" + "\n".join(constraints)
    
    return enhanced_prompt


class TalkingPointModel(BaseModel):
    text: str


class AudienceTagModel(BaseModel):
    primary: str  # "RED" | "BLUE" | "GREEN" | "YELLOW"
    secondary: str | None = None  # Optional second color
    confidence: float  # 0-1
    reasoning: str


class SectionModel(BaseModel):
    title: str
    talking_points: List[TalkingPointModel]


class ChapterModel(BaseModel):
    title: str
    sections: List[SectionModel]


class BookOutlineModel(BaseModel):
    title: str
    chapters: List[ChapterModel]


class AudienceTagModel(BaseModel):
    primary: str  # "RED" | "BLUE" | "GREEN" | "YELLOW"
    secondary: str | None = None  # Optional second color
    confidence: float  # 0-1
    reasoning: str


def infer_audience_tag(answers: list[dict[str, str]]) -> dict | None:
    """
    Infer the emotional audience type tag based on positioning phase answers.
    Returns a dict with primary, optional secondary, confidence, and reasoning.
    """
    if not answers:
        return None
    
    # Build context from answers
    answer_map = {}
    for item in answers:
        key = item.get("key", "")
        answer = item.get("answer", "").strip()
        if key and answer:
            answer_map[key] = answer
    
    # Extract core topic for genre inference
    core_topic = answer_map.get("core_topic", "").lower()
    
    # Build prompt for AI inference
    prompt_parts = [
        "You are an expert at analyzing emotional buying psychology and customer motivations.",
        "Your task is to classify a book's intended reader into one or two emotional audience types based on their answers.",
        "",
        "EMOTIONAL AUDIENCE TYPES:",
        "",
        "🔴 RED - Feared emotion: Boredom | Seeks: Stimulation, challenge, novelty",
        "   Buying question: 'Will this make my life more exciting?'",
        "",
        "🟡 YELLOW - Feared emotion: Loneliness | Seeks: Belonging, joy, connection",
        "   Buying question: 'Will others like and accept me more if I buy this?'",
        "",
        "🔵 BLUE - Feared emotion: Powerlessness | Seeks: Mastery, control, status",
        "   Buying question: 'Will this help me reach my goals faster?'",
        "",
        "🟢 GREEN - Feared emotion: Insecurity | Seeks: Safety, clarity, predictability",
        "   Buying question: 'Will I feel safer if I buy this?'",
        "",
        "GENRE HEURISTICS (not deterministic, but should influence scoring):",
        "- Creativity & Artistic Expression → RED / YELLOW",
        "- Mindset & Mental Resilience → BLUE / GREEN",
        "- Self-help & Life Reinvention → RED / YELLOW",
        "- Leadership & Innovation → RED / BLUE",
        "- Health & Wellness → GREEN / YELLOW",
        "- Finance & Investing → BLUE / GREEN",
        "- Sustainability & Purpose-led → GREEN / RED",
        "- Parenting & Relationships → YELLOW / GREEN",
        "- Systems & Productivity → BLUE / GREEN",
        "- Spirituality & Inner Life → YELLOW / GREEN",
        "- Career & Entrepreneurship → RED / BLUE",
        "- DIY / Craft / Hobby → GREEN / BLUE (sometimes RED)",
        "",
        "AUTHOR'S ANSWERS:",
        "=" * 50,
    ]
    
    # Add answers
    if "core_topic" in answer_map:
        prompt_parts.append(f"\nCore Topic: {answer_map['core_topic']}")
    if "personal_connection" in answer_map:
        prompt_parts.append(f"\nPersonal Connection: {answer_map['personal_connection']}")
    if "ideal_reader" in answer_map:
        prompt_parts.append(f"\nIdeal Reader: {answer_map['ideal_reader']}")
    if "main_challenge" in answer_map:
        prompt_parts.append(f"\nMain Challenge: {answer_map['main_challenge']}")
    if "misconceptions" in answer_map:
        prompt_parts.append(f"\nMisconceptions: {answer_map['misconceptions']}")
    if "existing_solutions" in answer_map:
        prompt_parts.append(f"\nExisting Solutions: {answer_map['existing_solutions']}")
    if "unique_approach" in answer_map:
        prompt_parts.append(f"\nUnique Approach: {answer_map['unique_approach']}")
    if "key_insight" in answer_map:
        prompt_parts.append(f"\nKey Insight: {answer_map['key_insight']}")
    
    prompt_parts.extend([
        "\n" + "=" * 50,
        "",
        "ANALYSIS INSTRUCTIONS:",
        "1. Analyze the language used (urgency, safety, excitement, belonging, control)",
        "2. Identify what emotional relief the reader is seeking",
        "3. Match to buying questions (boredom→RED, loneliness→YELLOW, powerlessness→BLUE, insecurity→GREEN)",
        "4. Consider genre heuristics but prioritize actual language and emotional drivers",
        "5. Assign a PRIMARY color (required) and optionally a SECONDARY color if there's strong evidence",
        "6. Provide confidence score (0-1) and clear reasoning",
        "",
        "Return JSON only in this exact format:",
        '{"primary": "RED"|"BLUE"|"GREEN"|"YELLOW", "secondary": "RED"|"BLUE"|"GREEN"|"YELLOW"|null, "confidence": 0.0-1.0, "reasoning": "explanation"}',
    ])
    
    prompt = "\n".join(prompt_parts)
    
    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        completion = client.responses.parse(
            model="gpt-4o-2024-08-06",
            input=[
                {"role": "system", "content": "You are an expert at analyzing emotional buying psychology. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            text_format=AudienceTagModel,
        )
        
        tag: AudienceTagModel = completion.output_parsed
        
        # Convert to dict format for JSONField storage
        result = {
            "primary": tag.primary,
            "confidence": tag.confidence,
            "reasoning": tag.reasoning,
        }
        
        if tag.secondary:
            result["secondary"] = tag.secondary
        
        return result
        
    except Exception as exc:
        print(f"Error in audience tag inference: {exc}")
        return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def createOutline(request):
    answers = request.data.get("answers")
    book_id = request.data.get("book_id")
    force_legacy = request.data.get("force_legacy", False)  # Allow legacy mode for migration
    
    # Get book if book_id provided
    book = None
    if book_id:
        try:
            book = Book.objects.get(pk=book_id, user=request.user)
        except Book.DoesNotExist:
            pass
    
    # NON-NEGOTIABLE: Check if all positioning pillars are complete
    if book and not force_legacy:
        pillars = PositioningPillar.objects.filter(book=book)
        if pillars.exists():
            incomplete_pillars = pillars.exclude(status="COMPLETE")
            if incomplete_pillars.exists():
                incomplete_names = [p.name for p in incomplete_pillars]
                return Response({
                    "detail": "Cannot generate outline until all positioning pillars are complete",
                    "incomplete_pillars": incomplete_names,
                    "pillars_completed": [p.name for p in pillars.filter(status="COMPLETE")],
                    "pillars_remaining": len(incomplete_pillars),
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Use positioning brief instead of legacy answers
            try:
                brief = PositioningBrief.objects.get(book=book)
                # Build prompt from positioning brief instead of answers
                base_prompt = _build_prompt_from_brief(brief)
            except PositioningBrief.DoesNotExist:
                # Generate brief first
                return Response({
                    "detail": "Positioning brief not generated. Call the brief endpoint first.",
                }, status=status.HTTP_400_BAD_REQUEST)
        elif not answers:
            # No pillars and no answers - require one or the other
            return Response({
                "detail": "Either complete positioning pillars or provide answers",
            }, status=status.HTTP_400_BAD_REQUEST)
        else:
            # No pillars exist, use legacy answers mode
            base_prompt = _build_prompt(answers)
    elif not isinstance(answers, list) or not answers:
        return Response(
            {"detail": "answers must be a non-empty list"}, status=status.HTTP_400_BAD_REQUEST
        )
    else:
        base_prompt = _build_prompt(answers)
    
    # Build audience-aware prompt
    prompt = buildAudienceAwarePrompt(base_prompt, None, book)
    
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    try:
        completion = client.responses.parse(
            model="gpt-4o-2024-08-06",
            input=[
                {"role": "system", "content": "You are a book outline generator."},
                {"role": "user", "content": prompt},
            ],
            text_format=BookOutlineModel,
        )

        # Extract parsed JSON into Pydantic model
        outline: BookOutlineModel = completion.output_parsed

    except Exception as exc:
        import traceback
        error_trace = traceback.format_exc()
        print("OPENAI ERROR:", exc)
        print("TRACEBACK:", error_trace)
        return Response(
            {"detail": str(exc), "traceback": error_trace if DEBUG else None},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    try:
        # Extract core_topic and audience from answers
        core_topic = ""
        audience = ""
        for item in answers:
            key = item.get("key", "")
            answer = item.get("answer", "").strip()
            if key == "core_topic" and answer:
                core_topic = answer
            elif key == "ideal_reader" and answer:
                # Combine all ideal_reader answers if there are multiple
                if audience:
                    audience += "; " + answer
                else:
                    audience = answer
        
        with transaction.atomic():
            if book_id:
                try:
                    book = Book.objects.get(pk=book_id, user=request.user)
                    # clear existing structure
                    book.chapters.all().delete()
                except Book.DoesNotExist:
                    book = Book.objects.create(
                        title=outline.title or "Untitled Book",
                        user=request.user,
                        core_topic=core_topic or None,
                        audience=audience or None
                    )
            else:
                book = Book.objects.create(
                    title=outline.title or "Untitled Book",
                    user=request.user,
                    core_topic=core_topic or None,
                    audience=audience or None
                )

            # update title, core_topic, and audience from outline/Q&A
            book.title = outline.title or book.title or "Untitled Book"
            if core_topic:
                book.core_topic = core_topic
            if audience:
                book.audience = audience
            book.save()

            for chapter_index, chapter_data in enumerate(outline.chapters, start=1):
                chapter = Chapter.objects.create(
                    book=book,
                    title=chapter_data.title or f"Chapter {chapter_index}",
                    order=chapter_index,
                )
                for section_index, section_data in enumerate(chapter_data.sections, start=1):
                    section = Section.objects.create(
                        chapter=chapter,
                        title=section_data.title or f"Section {chapter_index}.{section_index}",
                        order=section_index,
                    )
                    for tp_index, tp_data in enumerate(section_data.talking_points, start=1):
                        TalkingPoint.objects.create(
                            section=section,
                            text=tp_data.text
                            or f"Point {chapter_index}.{section_index}.{tp_index}",
                            order=tp_index,
                        )
    except Exception as exc:
        import traceback
        error_trace = traceback.format_exc()
        print("CREATE OUTLINE ERROR:", str(exc))
        print("TRACEBACK:", error_trace)
        return Response(
            {"detail": str(exc), "traceback": error_trace if DEBUG else None},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    # Infer and save audience tag
    try:
        tag_result = infer_audience_tag(answers)
        if tag_result:
            book.audience_tag = tag_result
            book.save()
    except Exception as exc:
        print(f"Error inferring audience tag: {exc}")
        # Don't fail the outline creation if tag inference fails

    serialized = BookSerializer(book)
    return Response(serialized.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def infer_and_update_audience_tag(request):
    """
    Infer and update the audience tag for a book based on positioning answers.
    Can be called independently or after outline creation.
    """
    book_id = request.data.get("book_id")
    answers = request.data.get("answers", [])
    
    if not book_id:
        return Response(
            {"detail": "book_id is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    try:
        book = Book.objects.get(pk=book_id, user=request.user)
    except Book.DoesNotExist:
        return Response(
            {"detail": "Book not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    
    if not answers:
        return Response(
            {"detail": "answers are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    tag_result = infer_audience_tag(answers)
    
    if tag_result:
        book.audience_tag = tag_result
        book.save()
        return Response(
            {"success": True, "audience_tag": tag_result},
            status=status.HTTP_200_OK,
        )
    else:
        return Response(
            {"detail": "Failed to infer audience tag"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def generate_followup_question(request):
    """Generate a contextual follow-up question based on the user's answer."""
    question = request.data.get("question", "").strip()
    answer = request.data.get("answer", "").strip()
    context = request.data.get("context", [])  # Previous Q&A pairs for context
    
    if not question or not answer:
        return Response(
            {"detail": "question and answer are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    # Build context from previous answers
    context_text = ""
    if context:
        context_text = "\nPrevious conversation:\n"
        for item in context[-3:]:  # Use last 3 Q&A pairs for context
            ctx_q = item.get("question", "").strip()
            ctx_a = item.get("answer", "").strip()
            if ctx_q and ctx_a:
                context_text += f"Q: {ctx_q}\nA: {ctx_a}\n"
    
    prompt = f"""You are a helpful book writing coach conducting an interview with an author.

{context_text}

Current Question: {question}
Author's Answer: {answer}

The author's answer seems brief or could use more detail. Generate a single, natural follow-up question that:
1. Is conversational and encouraging (like a friendly coach)
2. Builds on what they just said
3. Guides them to provide more specific details, examples, or depth
4. Helps them think more deeply about the topic
5. Is concise (1-2 sentences max)
6. Encourages the use to give a more detailed answer

Return only the follow-up question, nothing else."""

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful book writing coach. Generate natural, conversational follow-up questions."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=150,
        )
        
        followup_question = completion.choices[0].message.content.strip()
        
        return Response(
            {"followup_question": followup_question},
            status=status.HTTP_200_OK,
        )
    except Exception as exc:
        print("OPENAI ERROR (followup):", exc)
        return Response(
            {"detail": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def generate_insight_summary(request):
    """Generate AI summaries for core topic or audience based on user answers."""
    insight_type = request.data.get("type", "").strip()  # "core_topic" or "audience"
    answers = request.data.get("answers", [])  # List of {question, answer, key} objects
    book_id = request.data.get("book_id")
    
    if not insight_type or insight_type not in ["core_topic", "audience"]:
        return Response(
            {"detail": "type must be 'core_topic' or 'audience'"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    if not answers:
        return Response(
            {"detail": "answers are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    # Filter relevant answers based on insight type
    relevant_answers = []
    if insight_type == "core_topic":
        # Use core_topic and personal_connection answers
        for item in answers:
            key = item.get("key", "")
            if key in ["core_topic", "personal_connection"]:
                relevant_answers.append(item)
    elif insight_type == "audience":
        # Use ideal_reader and main_challenge answers
        for item in answers:
            key = item.get("key", "")
            if key in ["ideal_reader", "main_challenge"]:
                relevant_answers.append(item)
    
    if not relevant_answers:
        return Response(
            {"detail": f"No relevant answers found for {insight_type}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    # Build context from relevant answers
    context_text = ""
    for item in relevant_answers:
        question = item.get("question", "").strip()
        answer = item.get("answer", "").strip()
        if question and answer:
            context_text += f"Q: {question}\nA: {answer}\n\n"
    
    # Get book for audience tag if book_id provided
    book = None
    if book_id:
        try:
            book = Book.objects.get(pk=book_id, user=request.user)
        except Book.DoesNotExist:
            pass
    
    if insight_type == "core_topic":
        base_prompt = f"""You are a book writing coach helping an author refine their book concept.

Based on the author's answers below, generate a concise, compelling summary of their core topic. The summary should:
1. Be 1-2 sentences maximum
2. Capture the essence of what they want to write about
3. Be clear and engaging
4. Synthesize their topic and personal connection into a cohesive statement

Author's Answers:
{context_text}

Generate a concise core topic summary:"""
        prompt = buildAudienceAwarePrompt(base_prompt, None, book)
    else:  # audience
        base_prompt = f"""You are a book writing coach helping an author identify their target audience.

Based on the author's answers below, generate a concise summary of their ideal reader. The summary should:
1. Be 1-2 sentences maximum
2. Clearly identify who the book is for
3. Include key characteristics (demographics, challenges, goals)
4. Be specific and actionable

Author's Answers:
{context_text}

Generate a concise audience summary:"""
        prompt = buildAudienceAwarePrompt(base_prompt, None, book)

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful book writing coach. Generate concise, compelling summaries."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=150,
        )
        
        summary = completion.choices[0].message.content.strip()
        
        # Optionally update the book if book_id is provided
        if book_id:
            try:
                book = Book.objects.get(pk=book_id, user=request.user)
                if insight_type == "core_topic":
                    book.core_topic = summary
                else:
                    book.audience = summary
                book.save()
            except Book.DoesNotExist:
                pass  # Don't fail if book doesn't exist yet
        
        return Response(
            {"summary": summary, "type": insight_type},
            status=status.HTTP_200_OK,
        )
    except Exception as exc:
        print("OPENAI ERROR (generate_insight_summary):", exc)
        return Response(
            {"detail": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def validate_answer_quality(request):
    """Validate if an answer meaningfully addresses the question using AI."""
    question = request.data.get("question", "").strip()
    answer = request.data.get("answer", "").strip()
    min_length = request.data.get("min_length", 20)  # Default minimum length
    
    if not question or not answer:
        return Response(
            {"detail": "question and answer are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    # First check basic length requirement
    if len(answer) < min_length:
        return Response(
            {
                "is_valid": False,
                "reason": "too_short",
                "message": "Your answer is quite brief. Could you provide a bit more detail?"
            },
            status=status.HTTP_200_OK,
        )
    
    # Use AI to assess if the answer meaningfully addresses the question
    prompt = f"""You are a book writing coach evaluating whether an author's answer meaningfully addresses a question.

Question: {question}
Answer: {answer}

Evaluate whether the answer:
1. Actually addresses the question (not just "I don't know" or asking for help without context)
2. Provides meaningful content related to the question
3. Shows engagement with the topic (even if uncertain, shows some thought)

If the answer is:
- Just "I don't know" without any context or explanation → INVALID
- Asking for help without providing any information about themselves → INVALID
- Very vague or non-committal without any substance → INVALID
- Meaningfully addresses the question, even if uncertain → VALID
- Provides context, examples, or thoughtful reflection → VALID

Return a JSON object with:
- "is_valid": boolean (true if answer meaningfully addresses the question, false otherwise)
- "reason": string (one of: "meaningful", "too_vague", "needs_more_detail", "too_short")
- "message": string (brief explanation for the user)"""

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful book writing coach. Evaluate answers strictly and return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=200,
            response_format={"type": "json_object"}
        )
        
        result_text = completion.choices[0].message.content.strip()
        import json
        result = json.loads(result_text)
        
        return Response(
            {
                "is_valid": result.get("is_valid", False),
                "reason": result.get("reason", "needs_more_detail"),
                "message": result.get("message", "Could you provide more detail?")
            },
            status=status.HTTP_200_OK,
        )
    except Exception as exc:
        print("OPENAI ERROR (validate_answer):", exc)
        # Fallback to length-based validation
        return Response(
            {
                "is_valid": len(answer) >= min_length,
                "reason": "length_check" if len(answer) >= min_length else "too_short",
                "message": "Could you provide more detail?" if len(answer) < min_length else "Answer accepted"
            },
            status=status.HTTP_200_OK,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_books(request):
    """Return all books for the current user (owned and collaborated) with nested chapters/sections/talking points."""
    # Prefetch with ordering to ensure talking points are ordered correctly
    talking_points_prefetch = Prefetch(
        'talking_points',
        queryset=TalkingPoint.objects.order_by('order')
    )
    sections_prefetch = Prefetch(
        'sections',
        queryset=Section.objects.order_by('order').prefetch_related(talking_points_prefetch)
    )
    chapters_prefetch = Prefetch(
        'chapters',
        queryset=Chapter.objects.order_by('order').prefetch_related(sections_prefetch)
    )
    
    # Get books owned by user
    owned_books = Book.objects.prefetch_related(chapters_prefetch).filter(user=request.user)
    
    # Get books where user is a collaborator
    collaborated_books = Book.objects.prefetch_related(chapters_prefetch).filter(collaborators__user=request.user)
    
    # Combine and remove duplicates
    all_books = (owned_books | collaborated_books).distinct().order_by("-id")
    
    # Serialize with collaboration info
    books_data = []
    for book in all_books:
        book_data = BookSerializer(book).data
        # Add collaboration info
        is_owner = book.user == request.user
        if not is_owner:
            collaborator = BookCollaborator.objects.filter(book=book, user=request.user).first()
            book_data["is_collaboration"] = True
            book_data["collaborator_role"] = collaborator.role if collaborator else "commenter"
            book_data["owner_name"] = book.user.first_name or book.user.username or book.user.email.split("@")[0]
        else:
            book_data["is_collaboration"] = False
            book_data["collaborator_role"] = None
            book_data["owner_name"] = None
        books_data.append(book_data)
    
    return Response(books_data, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_book(request):
    """Create an empty book shell for the current user."""
    title = request.data.get("title", "").strip() or "Untitled Book"
    book = Book.objects.create(title=title, user=request.user)
    data = BookSerializer(book).data
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_book(request, pk: int):
    """Return a single book by id with nested data (only if owned by user or user is a collaborator)."""
    try:
        # Prefetch with ordering to ensure talking points are ordered correctly
        talking_points_prefetch = Prefetch(
            'talking_points',
            queryset=TalkingPoint.objects.order_by('order')
        )
        sections_prefetch = Prefetch(
            'sections',
            queryset=Section.objects.order_by('order').prefetch_related(talking_points_prefetch)
        )
        chapters_prefetch = Prefetch(
            'chapters',
            queryset=Chapter.objects.order_by('order').prefetch_related(sections_prefetch)
        )
        book = Book.objects.prefetch_related(chapters_prefetch).get(pk=pk)
    except Book.DoesNotExist:
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check if user has access (owner or collaborator)
    if not user_has_book_access(request.user, book):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    
    data = BookSerializer(book).data
    
    # Add collaboration info
    is_owner = book.user == request.user
    if not is_owner:
        collaborator = BookCollaborator.objects.filter(book=book, user=request.user).first()
        data["is_collaboration"] = True
        data["collaborator_role"] = collaborator.role if collaborator else "commenter"
        data["owner_name"] = book.user.first_name or book.user.username or book.user.email.split("@")[0]
    else:
        data["is_collaboration"] = False
        data["collaborator_role"] = None
        data["owner_name"] = None
    
    # Add user contexts to response
    contexts = UserContext.objects.filter(book=book).order_by("-created_at")
    data["user_contexts"] = [
        {"id": ctx.id, "text": ctx.text, "created_at": ctx.created_at.isoformat()}
        for ctx in contexts
    ]
    
    return Response(data, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def generate_text(request):
    """Generate text content from a talking point name using AI."""
    talking_point_id = request.data.get("talking_point_id")
    talking_point_name = request.data.get("talking_point_name", "").strip()
    book_id = request.data.get("book_id")
    asset_ids = request.data.get("asset_ids", [])

    if not talking_point_id or not book_id:
        return Response(
            {"detail": "talking_point_id and book_id are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        talking_point = TalkingPoint.objects.select_related("section__chapter__book").get(
            pk=talking_point_id, section__chapter__book__user=request.user
        )
        book = talking_point.section.chapter.book

        if book.id != book_id:
            return Response(
                {"detail": "Talking point does not belong to this book"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build context from book data and uploaded assets
        context_parts = []
        if book.core_topic:
            context_parts.append(f"Core Topic: {book.core_topic}")
        if book.audience:
            context_parts.append(f"Target Audience: {book.audience}")
        
        # Add information about uploaded assets and extract their content
        # Include both selected talking point assets AND chapter-level assets (talking_point=None)
        all_asset_ids = list(asset_ids) if asset_ids else []
        
        # Get chapter-level assets (talking_point=None) for this book
        # These are assets uploaded at the chapter level, available to all talking points in the book
        chapter_assets = ChapterAsset.objects.filter(
            book=book,
            talking_point__isnull=True
        )
        
        # Add chapter asset IDs to the list (avoid duplicates)
        chapter_asset_ids = [ca.id for ca in chapter_assets if ca.id not in all_asset_ids]
        all_asset_ids.extend(chapter_asset_ids)
        
        # Initialize variables for logging
        chapter_level_assets = []
        talking_point_assets = []
        
        if all_asset_ids:
            assets = ChapterAsset.objects.filter(id__in=all_asset_ids, book=book)
            if assets.exists():
                context_parts.append("\n=== REFERENCE FILES CONTENT ===")
                # Separate chapter-level assets from talking point-specific assets
                chapter_level_assets = [a for a in assets if a.talking_point is None]
                talking_point_assets = [a for a in assets if a.talking_point is not None]
                
                if chapter_level_assets:
                    context_parts.append("\n--- Chapter-Level Assets (available for all talking points in this chapter) ---")
                    for asset in chapter_level_assets:
                        context_parts.append(f"\nFile: {asset.filename} ({asset.file_type.upper()})")
                        file_content = extract_text_from_file(asset)
                        if file_content:
                            context_parts.append(f"Content:\n{file_content}")
                
                if talking_point_assets:
                    context_parts.append("\n--- Talking Point-Specific Assets ---")
                    for asset in talking_point_assets:
                        context_parts.append(f"\nFile: {asset.filename} ({asset.file_type.upper()})")
                        file_content = extract_text_from_file(asset)
                        if file_content:
                            context_parts.append(f"Content:\n{file_content}")
                
                context_parts.append("\n=== END REFERENCE FILES ===")
                context_parts.append("\nIMPORTANT: Use the content from the reference files above to inform and enhance the generated text. Incorporate relevant information, examples, or data from these files into your response.")

        # Get related talking points for context
        section = talking_point.section
        chapter = section.chapter
        related_tps = TalkingPoint.objects.filter(
            section__chapter=chapter
        ).exclude(pk=talking_point_id).order_by("order")[:5]

        if related_tps.exists():
            context_parts.append("\nRelated talking points in this section:")
            for tp in related_tps:
                if tp.text:
                    context_parts.append(f"- {tp.text}")

        context_text = "\n".join(context_parts)

        base_prompt = f"""You are a professional book writer helping an author develop content from talking points.

Book Context:
{context_text}

Talking Point to Develop: {talking_point_name}

Generate well-written, engaging content (2-4 paragraphs) that expands on this talking point. The content should:
1. Be clear and professional
2. Provide value to the reader
3. Flow naturally
4. Be appropriate for a book chapter
5. Use the book's core topic and audience context provided above
6. Actively incorporate and reference information from the reference files provided above when relevant

IMPORTANT: If reference files are provided above, you MUST use their content to inform your writing. Extract key information, examples, data points, or insights from those files and weave them naturally into the generated text. Do not just mention that files exist - actually use their content.

Return only the generated text content, no explanations or meta-commentary."""

        # Build audience-aware prompt
        prompt = buildAudienceAwarePrompt(base_prompt, None, book)

        # Log the full prompt for debugging
        print("=" * 80)
        print("GENERATE TEXT PROMPT:")
        print("=" * 80)
        print(f"Talking Point ID: {talking_point_id}")
        print(f"Talking Point Name: {talking_point_name}")
        print(f"Book ID: {book_id}")
        print(f"Selected Asset IDs (from request): {asset_ids}")
        print(f"Chapter Asset IDs (auto-included): {chapter_asset_ids}")
        print(f"Total Asset IDs: {all_asset_ids}")
        print(f"Chapter-Level Assets Count: {len(chapter_level_assets)}")
        print(f"Talking Point Assets Count: {len(talking_point_assets)}")
        if chapter_level_assets:
            print(f"Chapter-Level Asset Filenames: {[a.filename for a in chapter_level_assets]}")
        if talking_point_assets:
            print(f"Talking Point Asset Filenames: {[a.filename for a in talking_point_assets]}")
        print("\n" + "-" * 80)
        print("FULL PROMPT:")
        print("-" * 80)
        print(prompt)
        print("=" * 80)

        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a professional book writer. Generate high-quality book content."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=800,
        )

        generated_text = completion.choices[0].message.content.strip()

        # Update the talking point with generated content
        talking_point.content = generated_text
        talking_point.save()

        return Response(
            {"generated_text": generated_text},
            status=status.HTTP_200_OK,
        )

    except TalkingPoint.DoesNotExist:
        return Response(
            {"detail": "Talking point not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except Exception as exc:
        print("OPENAI ERROR (generate_text):", exc)
        return Response(
            {"detail": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def add_user_context(request):
    """Add user-provided context for AI generation."""
    book_id = request.data.get("book_id")
    context_text = request.data.get("context_text", "").strip()
    talking_point_id = request.data.get("talking_point_id")

    if not book_id or not context_text:
        return Response(
            {"detail": "book_id and context_text are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        book = Book.objects.get(pk=book_id, user=request.user)
        talking_point = None

        if talking_point_id:
            talking_point = TalkingPoint.objects.select_related("section__chapter__book").get(
                pk=talking_point_id, section__chapter__book=book
            )

        context = UserContext.objects.create(
            book=book,
            text=context_text,
            talking_point=talking_point,
            user=request.user,
        )

        return Response(
            {
                "context": {
                    "id": context.id,
                    "text": context.text,
                    "created_at": context.created_at.isoformat(),
                }
            },
            status=status.HTTP_201_CREATED,
        )

    except Book.DoesNotExist:
        return Response(
            {"detail": "Book not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except TalkingPoint.DoesNotExist:
        return Response(
            {"detail": "Talking point not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except Exception as exc:
        return Response(
            {"detail": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_chapter_asset(request):
    """Upload a file asset for use in generating talking point content."""
    import traceback
    
    book_id = request.data.get("book_id")
    talking_point_id = request.data.get("talking_point_id")
    file = request.FILES.get("file")

    if not book_id or not file:
        return Response(
            {"detail": "book_id and file are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        print(f"[UPLOAD] Starting upload for book_id={book_id}, talking_point_id={talking_point_id}, filename={file.name}")
        
        book = Book.objects.get(pk=book_id, user=request.user)
        talking_point = None

        if talking_point_id:
            talking_point = TalkingPoint.objects.select_related("section__chapter__book").get(
                pk=talking_point_id, section__chapter__book=book
            )

        # Determine file type from extension
        filename = file.name
        file_ext = filename.split(".")[-1].lower() if "." in filename else ""
        allowed_extensions = ["txt", "pdf", "mp3", "csv", "docx", "doc"]
        
        if file_ext not in allowed_extensions:
            return Response(
                {"detail": f"File type .{file_ext} not allowed. Allowed types: {', '.join(allowed_extensions)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        print(f"[UPLOAD] Creating ChapterAsset with filename={filename}, file_type={file_ext}")
        
        asset = ChapterAsset.objects.create(
            book=book,
            talking_point=talking_point,
            file=file,
            filename=filename,
            file_type=file_ext,
            user=request.user,
        )
        
        print(f"[UPLOAD] Asset created successfully: id={asset.id}, file_path={asset.file.name}")

        return Response(
            {
                "asset": {
                    "id": asset.id,
                    "filename": asset.filename,
                    "file_type": asset.file_type,
                    "created_at": asset.created_at.isoformat(),
                }
            },
            status=status.HTTP_201_CREATED,
        )

    except Book.DoesNotExist:
        return Response(
            {"detail": "Book not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except TalkingPoint.DoesNotExist:
        return Response(
            {"detail": "Talking point not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except Exception as exc:
        import traceback
        error_trace = traceback.format_exc()
        print("UPLOAD ASSET ERROR:", str(exc))
        print("TRACEBACK:", error_trace)
        return Response(
            {"detail": str(exc), "traceback": error_trace if DEBUG else None},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_chapter_assets(request):
    """List all assets for a book or talking point."""
    book_id = request.query_params.get("book_id")
    talking_point_id = request.query_params.get("talking_point_id")

    if not book_id:
        return Response(
            {"detail": "book_id is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        book = Book.objects.get(pk=book_id, user=request.user)
        assets_query = ChapterAsset.objects.filter(book=book)

        if talking_point_id:
            assets_query = assets_query.filter(talking_point_id=talking_point_id)

        assets = assets_query.order_by("-created_at")

        return Response(
            {
                "assets": [
                    {
                        "id": asset.id,
                        "filename": asset.filename,
                        "file_type": asset.file_type,
                        "created_at": asset.created_at.isoformat(),
                    }
                    for asset in assets
                ]
            },
            status=status.HTTP_200_OK,
        )

    except Book.DoesNotExist:
        return Response(
            {"detail": "Book not found"},
            status=status.HTTP_404_NOT_FOUND,
        )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_chapter_asset(request, asset_id: int):
    """Delete a chapter asset."""
    try:
        asset = ChapterAsset.objects.select_related("book").get(pk=asset_id)
        
        # Check if user owns the book
        if asset.book.user != request.user:
            return Response(
                {"detail": "You do not have permission to delete this asset"},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        # Delete the file from storage
        if asset.file:
            asset.file.delete()
        
        # Delete the asset record
        asset.delete()
        
        return Response(
            {"detail": "Asset deleted successfully"},
            status=status.HTTP_200_OK,
        )
        
    except ChapterAsset.DoesNotExist:
        return Response(
            {"detail": "Asset not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except Exception as exc:
        return Response(
            {"detail": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ask_chat_question(request):
    """Answer questions about a talking point using AI."""
    book_id = request.data.get("book_id")
    talking_point_id = request.data.get("talking_point_id")
    question = request.data.get("question", "").strip()
    highlighted_text = request.data.get("highlighted_text", "").strip()

    if not book_id or not talking_point_id or not question:
        return Response(
            {"detail": "book_id, talking_point_id, and question are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        talking_point = TalkingPoint.objects.select_related("section__chapter__book").get(
            pk=talking_point_id, section__chapter__book__user=request.user
        )
        book = talking_point.section.chapter.book

        if book.id != book_id:
            return Response(
                {"detail": "Talking point does not belong to this book"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build context for the chat
        context_parts = []
        context_parts.append(f"Talking Point: {talking_point.text or 'Untitled'}")
        
        if talking_point.content:
            # Strip HTML tags for context
            import re
            clean_content = re.sub(r'<[^>]+>', '', talking_point.content)
            context_parts.append(f"\nCurrent Content:\n{clean_content}")
        
        if highlighted_text:
            context_parts.append(f"\nUser highlighted this text:\n\"{highlighted_text}\"")
            context_parts.append("\nThe user's question is specifically about this highlighted text.")

        if book.core_topic:
            context_parts.append(f"\nBook Core Topic: {book.core_topic}")
        if book.audience:
            context_parts.append(f"Target Audience: {book.audience}")

        context_text = "\n".join(context_parts)

        base_prompt = f"""You are a helpful writing assistant helping an author with their book. Answer the user's question about the current talking point.

Context:
{context_text}

User's Question: {question}

Provide a helpful, concise, and actionable answer. If the question is about the highlighted text, focus your answer on that specific section. Be encouraging and constructive."""

        # Build audience-aware prompt
        prompt = buildAudienceAwarePrompt(base_prompt, None, book)

        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful writing assistant. Provide clear, actionable feedback and answers."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=500,
        )

        response_text = completion.choices[0].message.content.strip()

        return Response(
            {"response": response_text},
            status=status.HTTP_200_OK,
        )

    except TalkingPoint.DoesNotExist:
        return Response(
            {"detail": "Talking point not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except Exception as exc:
        print("OPENAI ERROR (ask_chat_question):", exc)
        return Response(
            {"detail": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def quick_text_action(request):
    """Apply quick actions (shorten, expand, give_example, strengthen, clarify) to selected text."""
    book_id = request.data.get("book_id")
    talking_point_id = request.data.get("talking_point_id")
    selected_text = request.data.get("selected_text", "").strip()
    action = request.data.get("action")  # "shorten", "expand", "give_example", "strengthen", "clarify"

    if not book_id or not talking_point_id or not selected_text or not action:
        return Response(
            {"detail": "book_id, talking_point_id, selected_text, and action are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if action not in ["shorten", "expand", "give_example", "strengthen", "clarify", "remove_repetition", "regenerate", "improve_flow", "split_paragraph", "turn_into_bullets", "add_transition", "rewrite_heading", "suggest_subheading"]:
        return Response(
            {"detail": "action must be one of: shorten, expand, give_example, strengthen, clarify, remove_repetition, regenerate, improve_flow, split_paragraph, turn_into_bullets, add_transition, rewrite_heading, suggest_subheading"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        talking_point = TalkingPoint.objects.select_related("section__chapter__book").get(pk=talking_point_id)
        book = talking_point.section.chapter.book

        if book.id != book_id:
            return Response(
                {"detail": "Talking point does not belong to this book"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        # Check if user can edit (owner or editor)
        if not user_can_edit_book(request.user, book):
            return Response(
                {"detail": "Only editors can perform quick actions"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Build context
        context_parts = []
        if book.core_topic:
            context_parts.append(f"Book Core Topic: {book.core_topic}")
        if book.audience:
            context_parts.append(f"Target Audience: {book.audience}")
        if talking_point.content:
            import re
            clean_content = re.sub(r'<[^>]+>', '', talking_point.content)
            context_parts.append(f"\nFull Content Context:\n{clean_content}")

        context_text = "\n".join(context_parts) if context_parts else ""

        # Build action-specific prompts
        if action == "shorten":
            base_prompt = f"""You are a professional book editor. The user wants to shorten the following selected text while maintaining its core meaning and impact.

{context_text}

Selected text to shorten:
"{selected_text}"

Provide a shortened version that:
1. Maintains the core message and meaning
2. Is more concise and impactful
3. Removes unnecessary words without losing important information
4. Flows naturally

Return ONLY the shortened text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "expand":
            base_prompt = f"""You are a professional book writer. The user wants to expand the following selected text with more detail and depth.

{context_text}

Selected text to expand:
"{selected_text}"

Provide an expanded version that:
1. Adds more detail, depth, and context
2. Maintains the original meaning and tone
3. Provides additional insights or explanations
4. Flows naturally and is well-written

Return ONLY the expanded text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "give_example":
            base_prompt = f"""You are a professional book writer. The user wants you to add a concrete example to illustrate the following selected text.

{context_text}

Selected text that needs an example:
"{selected_text}"

Provide the original text followed by a concrete, relevant example that illustrates the point. The example should:
1. Be specific and concrete (not abstract)
2. Be relevant to the book's topic and audience
3. Clearly illustrate the point being made
4. Be well-written and engaging

Return the text in this format:
[Original text]

For example, [concrete example that illustrates the point]

Return ONLY the formatted text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "strengthen":
            base_prompt = f"""You are a professional book editor. The user wants to strengthen the following selected text to make it more impactful, persuasive, and powerful.

{context_text}

Selected text to strengthen:
"{selected_text}"

Provide a strengthened version that:
1. Uses stronger, more vivid language
2. Is more compelling and persuasive
3. Has greater impact and emotional resonance
4. Maintains the original meaning and tone
5. Uses active voice and concrete language where appropriate
6. Removes weak or vague phrases

Return ONLY the strengthened text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "clarify":
            base_prompt = f"""You are a professional book editor. The user wants to clarify the following selected text to make it clearer and easier to understand.

{context_text}

Selected text to clarify:
"{selected_text}"

Provide a clarified version that:
1. Is clearer and more straightforward
2. Removes ambiguity and confusion
3. Uses simpler, more direct language where appropriate
4. Maintains the original meaning and tone
5. Improves readability and comprehension
6. Makes the message more accessible

Return ONLY the clarified text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "remove_repetition":
            base_prompt = f"""You are a professional book editor. The user wants to remove repetition from the following selected text.

{context_text}

Selected text to remove repetition from:
"{selected_text}"

Provide a version that:
1. Removes redundant phrases and repeated ideas
2. Maintains all unique information
3. Improves clarity and flow
4. Keeps the original meaning intact

Return ONLY the revised text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "regenerate":
            base_prompt = f"""You are a professional book writer. The user wants you to regenerate the following selected text with fresh wording while maintaining the same meaning and message.

{context_text}

Selected text to regenerate:
"{selected_text}"

Provide a regenerated version that:
1. Uses different wording and phrasing
2. Maintains the exact same meaning and message
3. Is well-written and flows naturally
4. Fits the book's tone and style

Return ONLY the regenerated text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "improve_flow":
            base_prompt = f"""You are a professional book editor. The user wants to improve the flow of the following selected text.

{context_text}

Selected text to improve flow:
"{selected_text}"

Provide a version with improved flow that:
1. Creates smoother transitions between sentences
2. Improves sentence rhythm and pacing
3. Enhances readability
4. Maintains the original meaning

Return ONLY the improved text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "split_paragraph":
            base_prompt = f"""You are a professional book editor. The user wants to split the following paragraph into two well-structured paragraphs.

{context_text}

Paragraph to split:
"{selected_text}"

Provide the text split into two paragraphs, separated by a blank line. Each paragraph should:
1. Be complete and well-formed
2. Have a clear focus or topic
3. Flow naturally
4. Maintain all original information

Return ONLY the split paragraphs, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "turn_into_bullets":
            base_prompt = f"""You are a professional book editor. The user wants to convert the following selected text into a bulleted list.

{context_text}

Text to convert to bullets:
"{selected_text}"

Provide a bulleted list version that:
1. Uses clear, concise bullet points
2. Maintains all important information
3. Is well-organized and easy to scan
4. Flows logically

Return ONLY the bulleted list, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "add_transition":
            base_prompt = f"""You are a professional book writer. The user wants to add a transition sentence after the following selected text to smoothly connect it to the next section.

{context_text}

Text that needs a transition:
"{selected_text}"

Provide the original text followed by a transition sentence that:
1. Smoothly bridges to the next topic or idea
2. Maintains the book's tone and style
3. Is concise and effective
4. Creates a natural flow

Return ONLY the text with the transition sentence added, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "rewrite_heading":
            base_prompt = f"""You are a professional book editor. The user wants to rewrite the heading for this talking point.

{context_text}

Current content:
"{selected_text}"

Provide a compelling H1 heading that:
1. Captures the essence of the content
2. Is engaging and attention-grabbing
3. Is concise and clear
4. Fits the book's tone and style

Return ONLY the heading text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        
        elif action == "suggest_subheading":
            base_prompt = f"""You are a professional book editor. The user wants a subheading (H2) suggestion for this talking point.

{context_text}

Current content:
"{selected_text}"

Provide a compelling H2 subheading that:
1. Complements the main heading
2. Provides additional context or focus
3. Is engaging and clear
4. Fits the book's tone and style

Return ONLY the subheading text, nothing else."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)

        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a professional book editor and writer. Provide clear, well-written text modifications."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=500,
        )

        modified_text = completion.choices[0].message.content.strip()
        
        # Remove surrounding quotation marks if present
        if (modified_text.startswith('"') and modified_text.endswith('"')) or \
           (modified_text.startswith("'") and modified_text.endswith("'")):
            modified_text = modified_text[1:-1].strip()

        return Response(
            {"modified_text": modified_text},
            status=status.HTTP_200_OK,
        )

    except TalkingPoint.DoesNotExist:
        return Response(
            {"detail": "Talking point not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except Exception as exc:
        print("OPENAI ERROR (quick_text_action):", exc)
        return Response(
            {"detail": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def comments_list_create(request):
    """List comments for a talking point or create a new comment."""
    talking_point_id = request.query_params.get("talking_point_id") or request.data.get("talking_point_id")
    
    if not talking_point_id:
        return Response(
            {"detail": "talking_point_id is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        talking_point = TalkingPoint.objects.select_related("section__chapter__book").get(pk=talking_point_id)
        book = talking_point.section.chapter.book
        
        # Check if user has access (owner or collaborator)
        if not user_has_book_access(request.user, book):
            return Response(
                {"detail": "You don't have access to this book"},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        # For POST (creating comments), check if user can comment
        if request.method == "POST":
            if not user_can_comment_book(request.user, book):
                return Response(
                    {"detail": "Viewers cannot add comments"},
                    status=status.HTTP_403_FORBIDDEN,
                )
    except TalkingPoint.DoesNotExist:
        return Response(
            {"detail": "Talking point not found"},
            status=status.HTTP_404_NOT_FOUND,
        )

    if request.method == "GET":
        # Only get top-level comments (no parent), replies will be nested via serializer
        comments = Comment.objects.filter(talking_point=talking_point, parent__isnull=True).select_related("user").prefetch_related("replies__user")
        serializer = CommentSerializer(comments, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    elif request.method == "POST":
        # Determine comment type based on user relationship to book
        is_owner = book.user == request.user
        is_collaborator = BookCollaborator.objects.filter(book=book, user=request.user).exists()
        
        comment_type = "collaborator" if (is_collaborator and not is_owner) else "user"
        
        # Handle parent_id for replies
        parent_id = request.data.get("parent_id")
        if parent_id:
            # Verify parent comment exists and belongs to same talking point
            try:
                parent_comment = Comment.objects.get(pk=parent_id, talking_point=talking_point)
            except Comment.DoesNotExist:
                return Response(
                    {"detail": "Parent comment not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
        
        serializer = CommentSerializer(data={
            **request.data,
            "talking_point": talking_point_id,
            "user": request.user.id,
            "comment_type": comment_type,
            "parent": parent_id if parent_id else None,
        })
        if serializer.is_valid():
            serializer.save()
            # Reload with replies
            comment = Comment.objects.select_related("user").prefetch_related("replies__user").get(pk=serializer.data["id"])
            return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def comment_detail(request, comment_id):
    """Update or delete a comment."""
    try:
        comment = Comment.objects.select_related("talking_point__section__chapter__book", "user").get(pk=comment_id)
        book = comment.talking_point.section.chapter.book
        
        # Check if user has access to the book
        if not user_has_book_access(request.user, book):
            return Response(
                {"detail": "You don't have access to this book"},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        # Only allow users to edit/delete their own comments (or book owner can delete any)
        if request.method in ["PUT", "DELETE"]:
            if comment.user != request.user and book.user != request.user:
                return Response(
                    {"detail": "You can only modify your own comments"},
                    status=status.HTTP_403_FORBIDDEN,
                )
    except Comment.DoesNotExist:
        return Response(
            {"detail": "Comment not found"},
            status=status.HTTP_404_NOT_FOUND,
        )

    if request.method == "PUT":
        serializer = CommentSerializer(comment, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == "DELETE":
        comment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chat_with_changes(request):
    """Chat with AI about a talking point and optionally apply changes."""
    book_id = request.data.get("book_id")
    talking_point_id = request.data.get("talking_point_id")
    question = request.data.get("question", "").strip()
    highlighted_text = request.data.get("highlighted_text", "").strip()
    apply_changes = request.data.get("apply_changes", False)

    if not book_id or not talking_point_id or not question:
        return Response(
            {"detail": "book_id, talking_point_id, and question are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        talking_point = TalkingPoint.objects.select_related("section__chapter__book").get(
            pk=talking_point_id, section__chapter__book__user=request.user
        )
        book = talking_point.section.chapter.book

        if book.id != book_id:
            return Response(
                {"detail": "Talking point does not belong to this book"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build context for the chat
        context_parts = []
        context_parts.append(f"Talking Point: {talking_point.text or 'Untitled'}")
        
        if talking_point.content:
            import re
            clean_content = re.sub(r'<[^>]+>', '', talking_point.content)
            context_parts.append(f"\nCurrent Content:\n{clean_content}")
        
        if highlighted_text:
            context_parts.append(f"\nUser highlighted this text:\n\"{highlighted_text}\"")
            context_parts.append("\nThe user's question is specifically about this highlighted text.")

        if book.core_topic:
            context_parts.append(f"\nBook Core Topic: {book.core_topic}")
        if book.audience:
            context_parts.append(f"Target Audience: {book.audience}")

        context_text = "\n".join(context_parts)

        # Determine if user wants to make changes
        if apply_changes:
            base_prompt = f"""You are a helpful writing assistant helping an author with their book. The user wants to make changes to the content based on their question.

Context:
{context_text}

User's Question: {question}

Based on the user's question, provide an improved version of the content. If the question is about highlighted text, focus on improving that specific section. Return ONLY the improved content, maintaining the same structure and format. Do not include explanations or meta-commentary."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)
        else:
            base_prompt = f"""You are a helpful writing assistant helping an author with their book. Answer the user's question about the current talking point.

Context:
{context_text}

User's Question: {question}

Provide a helpful, concise, and actionable answer. If the question is about the highlighted text, focus your answer on that specific section. Be encouraging and constructive."""
            prompt = buildAudienceAwarePrompt(base_prompt, None, book)

        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful writing assistant. Provide clear, actionable feedback and answers."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=1000 if apply_changes else 500,
        )

        response_text = completion.choices[0].message.content.strip()

        # If applying changes, update the talking point content
        if apply_changes:
            talking_point.content = response_text
            talking_point.save()

        return Response(
            {"response": response_text, "applied_changes": apply_changes},
            status=status.HTTP_200_OK,
        )

    except TalkingPoint.DoesNotExist:
        return Response(
            {"detail": "Talking point not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except Exception as exc:
        print("OPENAI ERROR (chat_with_changes):", exc)
        return Response(
            {"detail": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def book_collaborators(request, book_id):
    """List collaborators for a book or invite a new collaborator."""
    try:
        book = Book.objects.get(pk=book_id)
        
        # Only book owner can manage collaborators
        if book.user != request.user:
            return Response(
                {"detail": "Only the book owner can manage collaborators"},
                status=status.HTTP_403_FORBIDDEN,
            )
    except Book.DoesNotExist:
        return Response(
            {"detail": "Book not found"},
            status=status.HTTP_404_NOT_FOUND,
        )

    if request.method == "GET":
        collaborators = BookCollaborator.objects.filter(book=book).select_related("user", "invited_by")
        data = []
        for collab in collaborators:
            data.append({
                "id": collab.id,
                "user_id": collab.user.id,
                "user_email": collab.user.email,
                "user_name": collab.user.first_name or collab.user.username or collab.user.email.split("@")[0],
                "role": collab.role,
                "invited_by": collab.invited_by.email if collab.invited_by else None,
                "created_at": collab.created_at,
            })
        return Response(data, status=status.HTTP_200_OK)

    elif request.method == "POST":
        email = request.data.get("email", "").strip()
        role = request.data.get("role", "commenter")
        
        if not email:
            return Response(
                {"detail": "email is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        if role not in ["editor", "viewer", "commenter"]:
            return Response(
                {"detail": "role must be one of: editor, viewer, commenter"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        from django.contrib.auth import get_user_model
        User = get_user_model()
        
        try:
            user = User.objects.get(email=email)
            
            # Don't allow inviting the book owner
            if user == book.user:
                return Response(
                    {"detail": "Cannot invite the book owner as a collaborator"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            
            # Create or update collaborator
            collaborator, created = BookCollaborator.objects.get_or_create(
                book=book,
                user=user,
                defaults={
                    "role": role,
                    "invited_by": request.user,
                }
            )
            
            if not created:
                # Update existing collaborator
                collaborator.role = role
                collaborator.save()
            
            return Response({
                "id": collaborator.id,
                "user_id": collaborator.user.id,
                "user_email": collaborator.user.email,
                "user_name": collaborator.user.first_name or collaborator.user.username or collaborator.user.email.split("@")[0],
                "role": collaborator.role,
                "created": created,
            }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
            
        except User.DoesNotExist:
            return Response(
                {"detail": f"User with email {email} not found. They need to sign up first."},
                status=status.HTTP_404_NOT_FOUND,
            )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_collaborator_role(request, book_id, collaborator_id):
    """Update a collaborator's role."""
    try:
        book = Book.objects.get(pk=book_id)
        
        # Only book owner can update collaborator roles
        if book.user != request.user:
            return Response(
                {"detail": "Only the book owner can update collaborator roles"},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        collaborator = BookCollaborator.objects.get(pk=collaborator_id, book=book)
        new_role = request.data.get("role")
        
        if new_role not in ["editor", "viewer", "commenter"]:
            return Response(
                {"detail": "role must be one of: editor, viewer, commenter"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        collaborator.role = new_role
        collaborator.save()
        
        return Response({
            "id": collaborator.id,
            "user_id": collaborator.user.id,
            "user_email": collaborator.user.email,
            "user_name": collaborator.user.first_name or collaborator.user.username or collaborator.user.email.split("@")[0],
            "role": collaborator.role,
        }, status=status.HTTP_200_OK)
        
    except Book.DoesNotExist:
        return Response(
            {"detail": "Book not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except BookCollaborator.DoesNotExist:
        return Response(
            {"detail": "Collaborator not found"},
            status=status.HTTP_404_NOT_FOUND,
        )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def remove_collaborator(request, book_id, collaborator_id):
    """Remove a collaborator from a book."""
    try:
        book = Book.objects.get(pk=book_id)
        
        # Only book owner can remove collaborators
        if book.user != request.user:
            return Response(
                {"detail": "Only the book owner can remove collaborators"},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        collaborator = BookCollaborator.objects.get(pk=collaborator_id, book=book)
        collaborator.delete()
        
        return Response(status=status.HTTP_204_NO_CONTENT)
        
    except Book.DoesNotExist:
        return Response(
            {"detail": "Book not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    except BookCollaborator.DoesNotExist:
        return Response(
            {"detail": "Collaborator not found"},
            status=status.HTTP_404_NOT_FOUND,
        )


# ------- CRUD for outline elements -------


def _serialized_book(book_id: int, user):
    book = (
        Book.objects.prefetch_related("chapters__sections__talking_points")
        .filter(pk=book_id, user=user)
        .first()
    )
    if not book:
        return None
    return BookSerializer(book).data


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_chapter(request, book_id: int):
    title = request.data.get("title", "").strip() or "Untitled Chapter"
    order = request.data.get("order")
    try:
        book = Book.objects.get(pk=book_id, user=request.user)
    except Book.DoesNotExist:
        return Response({"detail": "Book not found"}, status=status.HTTP_404_NOT_FOUND)

    if order is None:
        order = book.chapters.count() + 1

    Chapter.objects.create(book=book, title=title, order=order)
    data = _serialized_book(book_id, request.user)
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "PUT"])
@permission_classes([IsAuthenticated])
def update_chapter(request, chapter_id: int):
    try:
        chapter = Chapter.objects.select_related("book").get(pk=chapter_id, book__user=request.user)
    except Chapter.DoesNotExist:
        return Response({"detail": "Chapter not found"}, status=status.HTTP_404_NOT_FOUND)

    title = request.data.get("title")
    order = request.data.get("order")
    if title is not None:
        chapter.title = title.strip() or chapter.title
    if order is not None:
        chapter.order = order
    chapter.save()

    data = _serialized_book(chapter.book_id, request.user)
    return Response(data, status=status.HTTP_200_OK)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_chapter(request, chapter_id: int):
    try:
        chapter = Chapter.objects.select_related("book").get(pk=chapter_id, book__user=request.user)
    except Chapter.DoesNotExist:
        return Response({"detail": "Chapter not found"}, status=status.HTTP_404_NOT_FOUND)
    book_id = chapter.book_id
    chapter.delete()
    data = _serialized_book(book_id, request.user)
    return Response(data, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_section(request, chapter_id: int):
    title = request.data.get("title", "").strip() or "Untitled Section"
    order = request.data.get("order")
    try:
        chapter = Chapter.objects.select_related("book").get(pk=chapter_id, book__user=request.user)
    except Chapter.DoesNotExist:
        return Response({"detail": "Chapter not found"}, status=status.HTTP_404_NOT_FOUND)

    if order is None:
        order = chapter.sections.count() + 1

    Section.objects.create(chapter=chapter, title=title, order=order)
    data = _serialized_book(chapter.book_id, request.user)
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "PUT"])
@permission_classes([IsAuthenticated])
def update_section(request, section_id: int):
    try:
        section = Section.objects.select_related("chapter__book").get(
            pk=section_id, chapter__book__user=request.user
        )
    except Section.DoesNotExist:
        return Response({"detail": "Section not found"}, status=status.HTTP_404_NOT_FOUND)

    title = request.data.get("title")
    order = request.data.get("order")
    if title is not None:
        section.title = title.strip() or section.title
    if order is not None:
        section.order = order
    section.save()

    data = _serialized_book(section.chapter.book_id, request.user)
    return Response(data, status=status.HTTP_200_OK)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_section(request, section_id: int):
    try:
        section = Section.objects.select_related("chapter__book").get(
            pk=section_id, chapter__book__user=request.user
        )
    except Section.DoesNotExist:
        return Response({"detail": "Section not found"}, status=status.HTTP_404_NOT_FOUND)
    book_id = section.chapter.book_id
    section.delete()
    data = _serialized_book(book_id, request.user)
    return Response(data, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_talking_point(request, section_id: int):
    text = request.data.get("text", "").strip() or "New talking point"
    order = request.data.get("order")
    try:
        section = Section.objects.select_related("chapter__book").get(
            pk=section_id, chapter__book__user=request.user
        )
    except Section.DoesNotExist:
        return Response({"detail": "Section not found"}, status=status.HTTP_404_NOT_FOUND)

    if order is None:
        order = section.talking_points.count() + 1

    TalkingPoint.objects.create(section=section, text=text, order=order)
    data = _serialized_book(section.chapter.book_id, request.user)
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "PUT"])
@permission_classes([IsAuthenticated])
def update_talking_point(request, tp_id: int):
    try:
        tp = TalkingPoint.objects.select_related("section__chapter__book").get(pk=tp_id)
    except TalkingPoint.DoesNotExist:
        return Response({"detail": "Talking point not found"}, status=status.HTTP_404_NOT_FOUND)

    # Check if user can edit (owner or editor)
    book = tp.section.chapter.book
    if not user_can_edit_book(request.user, book):
        return Response({"detail": "Only editors can update talking points"}, status=status.HTTP_403_FORBIDDEN)

    text = request.data.get("text")
    order = request.data.get("order")
    content = request.data.get("content")
    if text is not None:
        tp.text = text.strip() or tp.text
    if order is not None:
        tp.order = order
    if content is not None:
        tp.content = content.strip() if content else None
    tp.save()

    data = _serialized_book(tp.section.chapter.book_id, request.user)
    return Response(data, status=status.HTTP_200_OK)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_talking_point(request, tp_id: int):
    try:
        tp = TalkingPoint.objects.select_related("section__chapter__book").get(pk=tp_id)
    except TalkingPoint.DoesNotExist:
        return Response({"detail": "Talking point not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check if user has access to the book (owner or collaborator)
    book = tp.section.chapter.book
    if not user_has_book_access(request.user, book):
        return Response({"detail": "You do not have permission to delete this talking point"}, status=status.HTTP_403_FORBIDDEN)
    
    book_id = tp.section.chapter.book_id
    tp.delete()
    data = _serialized_book(book_id, request.user)
    return Response(data, status=status.HTTP_200_OK)



@api_view(["POST"])
def create_suggestion(request):
    ContentChange.objects.create(
        talking_point_id=request.data["talking_point_id"],
        user=request.user,
        step_json=request.data["step_json"],
    )
    return Response(status=201)

@api_view(["POST"])
def approve_suggestion(request, pk):
    change = get_object_or_404(ContentChange, pk=pk)
    change.status = "approved"
    change.save()
    return Response(status=200)



@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def content_changes_list_create(request, talking_point_id: int):
    """List all changes for a talking point or create a new change."""
    try:
        tp = TalkingPoint.objects.select_related("section__chapter__book").get(pk=talking_point_id)
        book = tp.section.chapter.book
    except TalkingPoint.DoesNotExist:
        return Response({"detail": "Talking point not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check access
    if not user_has_book_access(request.user, book):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    
    if request.method == "GET":
        # List all changes for this talking point
        changes = ContentChange.objects.filter(talking_point=tp).select_related("user", "approved_by")
        
        # Filter by status if provided
        status_filter = request.query_params.get("status")
        if status_filter:
            changes = changes.filter(status=status_filter)
        
        serializer = ContentChangeSerializer(changes, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
    
    elif request.method == "POST":
        # Create a new suggestion/change
        # Only collaborators (not owners) can create suggestions
        if book.user == request.user:
            return Response(
                {"detail": "Book owners cannot create pending changes. Edit directly."},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Check if user is a collaborator with edit permissions
        collaborator = BookCollaborator.objects.filter(book=book, user=request.user).first()
        if not collaborator or collaborator.role == "viewer":
            return Response(
                {"detail": "You don't have permission to make changes"},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # CRITICAL: Step-native system - step_json is the ONLY field
        step_json = request.data.get("step_json")
        comment = request.data.get("comment", "")
        
        if not step_json:
            return Response(
                {"detail": "step_json is required"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create the change - ONLY step_json, nothing else
        change = ContentChange.objects.create(
            talking_point=tp,
            user=request.user,
            step_json=step_json,
            comment=comment,
            status="pending"
        )
        
        serializer = ContentChangeSerializer(change)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def run_book_checks_endpoint(request, book_id: int):
    """Run book checks on all Talking Points."""
    try:
        # Prefetch with ordering to ensure talking points are ordered correctly
        talking_points_prefetch = Prefetch(
            'talking_points',
            queryset=TalkingPoint.objects.order_by('order')
        )
        sections_prefetch = Prefetch(
            'sections',
            queryset=Section.objects.order_by('order').prefetch_related(talking_points_prefetch)
        )
        chapters_prefetch = Prefetch(
            'chapters',
            queryset=Chapter.objects.order_by('order').prefetch_related(sections_prefetch)
        )
        book = Book.objects.prefetch_related(chapters_prefetch).get(pk=book_id)
    except Book.DoesNotExist:
        return Response({"detail": "Book not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check access
    if not user_has_book_access(request.user, book):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Run checks (read-only, no mutations)
    results = run_book_checks(book)
    
    return Response(results, status=status.HTTP_200_OK)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def content_change_detail(request, change_id: int):
    """Approve, reject, or delete a content change."""
    try:
        change = ContentChange.objects.select_related(
            "talking_point__section__chapter__book", "user", "approved_by"
        ).get(pk=change_id)
        book = change.talking_point.section.chapter.book
    except ContentChange.DoesNotExist:
        return Response({"detail": "Change not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check access
    if not user_has_book_access(request.user, book):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    
    if request.method == "PATCH":
        # Only book owner can make changes
        if book.user != request.user:
            return Response(
                {"detail": "Only the book owner can modify changes"},
                status=status.HTTP_403_FORBIDDEN
            )
        
        new_status = request.data.get("status")
        new_step_json = request.data.get("step_json")
        
        # Handle step_json update (for position remapping after other changes are approved)
        if new_step_json is not None and new_status is None:
            # Only allow updating step_json for pending changes
            if change.status != "pending":
                return Response(
                    {"detail": "Cannot update step_json for non-pending changes"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            change.step_json = new_step_json
            change.save()
            serializer = ContentChangeSerializer(change)
            return Response(serializer.data, status=status.HTTP_200_OK)
        
        # Handle status update (approve/reject)
        if new_status not in ["approved", "rejected"]:
            return Response(
                {"detail": "status must be 'approved' or 'rejected'"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # FIX: Prevent double application - check if already approved/rejected
        if change.status == new_status:
            return Response(
                {"detail": f"This suggestion has already been {change.status}"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        change.status = new_status
        if new_status == "approved":
            change.approved_by = request.user
            from django.utils import timezone
            change.approved_at = timezone.now()
            # CRITICAL: Backend ONLY updates status - NEVER touches content
            # Frontend applies steps directly using ProseMirror
            # This is the 100% step-native architecture
        else:
            change.approved_by = None
            change.approved_at = None
        
        change.save()
        serializer = ContentChangeSerializer(change)
        return Response(serializer.data, status=status.HTTP_200_OK)
    
    elif request.method == "DELETE":
        # User can delete their own pending changes, owner can delete any
        if change.user != request.user and book.user != request.user:
            return Response(
                {"detail": "You can only delete your own changes"},
                status=status.HTTP_403_FORBIDDEN
            )
        
        change.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def collab_get_state(request, talking_point_id: int):
    """Get the initial collaboration state for a talking point."""
    try:
        tp = TalkingPoint.objects.select_related("section__chapter__book").get(pk=talking_point_id)
        book = tp.section.chapter.book
    except TalkingPoint.DoesNotExist:
        return Response({"detail": "Talking point not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check access
    if not user_has_book_access(request.user, book):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Get or create collaboration state
    collab_state, created = CollaborationState.objects.get_or_create(talking_point=tp)
    
    return Response({
        "version": collab_state.version,
        "talking_point_id": talking_point_id,
    }, status=status.HTTP_200_OK)


@api_view(["POST", "GET"])
@permission_classes([IsAuthenticated])
def collab_receive_steps(request, talking_point_id: int):
    """
    Collaborative editing authority endpoint.
    POST: Receive steps from a client
    GET: Get steps since a given version
    """
    try:
        tp = TalkingPoint.objects.select_related("section__chapter__book").get(pk=talking_point_id)
        book = tp.section.chapter.book
    except TalkingPoint.DoesNotExist:
        return Response({"detail": "Talking point not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check access
    if not user_has_book_access(request.user, book):
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Get or create collaboration state
    collab_state, created = CollaborationState.objects.get_or_create(talking_point=tp)
    
    if request.method == "POST":
        # Receive steps from client
        version = request.data.get("version")
        steps = request.data.get("steps", [])  # Array of serialized steps
        client_id = request.data.get("clientID")
        
        if version is None or client_id is None:
            return Response({"detail": "version and clientID are required"}, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if version matches
        if version != collab_state.version:
            return Response({
                "detail": "Version mismatch",
                "current_version": collab_state.version
            }, status=status.HTTP_409_CONFLICT)
        
        # Add steps to state
        current_steps = collab_state.get_steps()
        current_client_ids = collab_state.get_client_ids()
        
        current_steps.extend(steps)
        current_client_ids.extend([client_id] * len(steps))
        
        collab_state.set_steps(current_steps)
        collab_state.set_client_ids(current_client_ids)
        collab_state.version = len(current_steps)
        collab_state.save()
        
        return Response({
            "success": True,
            "version": collab_state.version
        }, status=status.HTTP_200_OK)
    
    elif request.method == "GET":
        # Get steps since a given version
        since_version = int(request.query_params.get("since", 0))
        
        all_steps = collab_state.get_steps()
        all_client_ids = collab_state.get_client_ids()
        
        steps_since = all_steps[since_version:]
        client_ids_since = all_client_ids[since_version:]
        
        return Response({
            "steps": steps_since,
            "clientIDs": client_ids_since,
            "version": collab_state.version
        }, status=status.HTTP_200_OK)


# DELETED: apply_all_approved_changes - step-native system, frontend applies steps directly


# ============================================================================
# POSITIONING PILLARS API - Strategic Book Positioning Engine
# ============================================================================

# Canonical pillar definitions with interrogation prompts
PILLAR_DEFINITIONS = {
    "business_core": {
        "name": "Business Core",
        "description": "Your business model, revenue streams, and how the book fits into your larger strategy.",
        "initial_prompt": """I'm your Book Strategist. Let's start with understanding your business foundation.

Tell me about your business: What do you do, who do you serve, and how does this book fit into your larger business strategy?

Be specific about:
- Your primary business model
- How you currently generate revenue
- What role this book will play (lead magnet, authority builder, product, etc.)""",
        "depth_criteria": [
            "Has explained their business model clearly",
            "Has connected the book to revenue/business goals",
            "Has identified the strategic role of the book",
        ],
        "challenge_prompts": {
            "vague_business": "You mentioned your business, but I need more specifics. What exactly do you sell or offer? Who pays you and for what?",
            "missing_book_role": "How specifically will this book generate value for your business? Will it be a lead magnet, a paid product, an authority builder, or something else?",
            "unclear_model": "When you say 'helping people,' what does that look like in practice? What's the transaction - consulting, courses, products, services?",
        }
    },
    "avatar": {
        "name": "The Avatar",
        "description": "Your ideal reader - a specific, detailed persona with demographics, psychographics, and current situation.",
        "initial_prompt": """Now let's get crystal clear on who you're writing this book for.

Describe your IDEAL reader as if they're a single person sitting across from you:
- Their age, profession, and life situation
- What keeps them up at night related to your topic
- What they've already tried that didn't work
- Why they would pick up YOUR book specifically

The more specific, the better. Generic answers like 'entrepreneurs' or 'people who want to improve' won't cut it.""",
        "depth_criteria": [
            "Has described a specific person, not a demographic",
            "Has identified their current struggles",
            "Has explained why this reader would choose their book",
        ],
        "challenge_prompts": {
            "too_broad": "You're describing a demographic, not a person. Give me a NAME. What's their job title? What did they search for on Google last night at 2am?",
            "missing_struggles": "What specific problem keeps this person stuck? What have they tried before that failed them?",
            "no_differentiation": "Why would this person choose YOUR book over the 50 others on this topic? What makes you the author they need?",
        }
    },
    "emotional_resonance": {
        "name": "Emotional Resonance",
        "description": "The emotional buying psychology of your reader (Red/Yellow/Blue/Green framework).",
        "initial_prompt": """Let's understand the emotional drivers of your reader.

People buy based on four core emotional fears:
🔴 RED: Fear of BOREDOM - seeks excitement, novelty, challenge
🟡 YELLOW: Fear of LONELINESS - seeks belonging, connection, acceptance
🔵 BLUE: Fear of POWERLESSNESS - seeks control, mastery, status
🟢 GREEN: Fear of INSECURITY - seeks safety, predictability, clarity

Based on your ideal reader, which emotional driver is PRIMARY for them? And is there a SECONDARY driver?

Tell me:
- Which color resonates most with your reader and WHY
- What emotional relief are they seeking when they buy your book
- What buying question are they asking themselves?""",
        "depth_criteria": [
            "Has identified primary emotional driver with evidence",
            "Has explained the emotional relief they're seeking",
            "Has articulated the reader's buying question",
        ],
        "challenge_prompts": {
            "no_evidence": "You picked a color, but WHY? What evidence from your reader's behavior or language led you to this conclusion?",
            "surface_level": "Go deeper. When your reader considers buying your book, what fear are they trying to escape? What emotional state do they want to achieve?",
            "conflicting_signals": "You're mixing signals. A reader seeking 'excitement' (RED) and 'safety' (GREEN) has conflicting drivers. Which is truly PRIMARY?",
        }
    },
    "north_star": {
        "name": "The North Star",
        "description": "The core transformation promise - the single most important outcome your book delivers.",
        "initial_prompt": """Every great book has a North Star - a single, clear transformation promise.

Complete this sentence with brutal specificity:
"After reading my book, my reader will be able to ____________, even if they currently ____________."

This should be:
- Specific and measurable (not vague 'feel better')
- Achievable through reading your book
- Compelling enough to justify the reader's time investment

What is THE transformation your book delivers?""",
        "depth_criteria": [
            "Has a specific, measurable transformation",
            "Has acknowledged where the reader starts",
            "Transformation is achievable through the book content",
        ],
        "challenge_prompts": {
            "too_vague": "'Feel more confident' or 'be happier' isn't specific enough. What will they be able to DO that they couldn't do before?",
            "not_measurable": "How would the reader KNOW they've achieved this transformation? What evidence would they see in their life?",
            "too_ambitious": "Can your book actually deliver this? Or does it require coaching, courses, or years of practice? Be honest about what a BOOK can achieve.",
        }
    },
    "pain_points": {
        "name": "Pain Points",
        "description": "The specific, visceral struggles your reader faces - not surface problems, but deep pain.",
        "initial_prompt": """Now let's excavate the REAL pain your reader experiences.

Not surface-level annoyances, but the pain that:
- Wakes them up at 3am
- Makes them feel shame or frustration
- They might not even admit to others

List 3-5 specific pain points your reader experiences. For each one:
- Describe it in THEIR words (how they'd describe it to a friend)
- Explain the downstream consequences (what it costs them)
- Rate its intensity (annoying, frustrating, or unbearable)

Be visceral. Generic pain = generic book.""",
        "depth_criteria": [
            "Has identified 3+ specific pain points",
            "Pain points are described in reader's language",
            "Has connected pain to real consequences",
        ],
        "challenge_prompts": {
            "too_surface": "That's a symptom, not the real pain. Dig deeper. What's the COST of this problem? How does it affect their relationships, career, self-image?",
            "your_words": "You're describing this like a consultant. How would your READER describe this pain point to their spouse at dinner?",
            "missing_consequences": "So what? Why does this pain point matter? What happens if they don't solve it?",
        }
    },
    "the_shift": {
        "name": "The Shift",
        "description": "The false beliefs your reader holds that keep them stuck - and the new beliefs your book instills.",
        "initial_prompt": """Your reader is stuck because of FALSE BELIEFS they hold. Your book must SHIFT these beliefs.

For each false belief your reader holds:
1. State the FALSE BELIEF they currently have
2. Explain WHY they believe this (where did it come from?)
3. State the NEW BELIEF your book will install
4. Describe the EVIDENCE you'll provide to make this shift happen

Example:
- False: "I need more willpower to lose weight"
- Why: Diet culture + past failed diets
- New: "Weight loss is about systems, not willpower"
- Evidence: Research on habit formation + case studies

What are the 2-3 core belief shifts your book creates?""",
        "depth_criteria": [
            "Has identified 2+ false beliefs",
            "Has explained the origin of each false belief",
            "Has articulated the replacement beliefs",
            "Has evidence to support the shift",
        ],
        "challenge_prompts": {
            "not_a_belief": "That's not a belief, it's a behavior or symptom. What do they BELIEVE that causes that behavior?",
            "missing_origin": "Where did this false belief come from? If you don't understand the origin, you can't effectively dismantle it.",
            "no_evidence": "Why should they believe your new belief? What proof, research, or case studies will you provide?",
        }
    },
    "the_edge": {
        "name": "The Edge",
        "description": "Your differentiation - what makes your approach unique compared to everything else on this topic.",
        "initial_prompt": """There are likely dozens of books on your topic. Why should anyone read YOURS?

Tell me about your EDGE:

1. What do your competitors/other authors get WRONG about this topic?
2. What unique insight, framework, or approach do YOU bring?
3. What's your unfair advantage? (Experience, research, perspective, methodology)
4. Complete this: "Unlike other books on [topic], my book is the only one that ____________"

Be ruthlessly honest. If you can't articulate your edge, readers will have no reason to choose you.""",
        "depth_criteria": [
            "Has identified what competitors get wrong",
            "Has articulated a unique approach or insight",
            "Has an unfair advantage they can leverage",
            "Can complete the differentiation statement",
        ],
        "challenge_prompts": {
            "no_competitors": "Don't tell me there are no competitors. Even if not books, what other solutions exist? What do they get wrong?",
            "weak_differentiation": "'More practical' or 'easier to read' isn't an edge. What do you KNOW or BELIEVE that others don't?",
            "missing_advantage": "What gives you the RIGHT to write this book? Experience? Research? A unique perspective? What's your unfair advantage?",
        }
    },
    "the_foundation": {
        "name": "The Foundation",
        "description": "Your content pillars - the 3-5 core themes or areas your book will cover.",
        "initial_prompt": """Now let's structure the FOUNDATION of your book - the content pillars.

Content pillars are the 3-5 major themes or areas your book will address. They should:
- Map directly to your reader's pain points
- Build toward your North Star transformation
- Be distinct from each other (no overlap)

For each pillar:
1. Name it clearly
2. Explain what pain point it addresses
3. Describe the key insight or outcome for this pillar

These pillars will become the backbone of your book structure.""",
        "depth_criteria": [
            "Has identified 3-5 distinct pillars",
            "Each pillar maps to a pain point",
            "Pillars build toward the transformation",
            "Pillars are distinct without overlap",
        ],
        "challenge_prompts": {
            "too_few": "You need at least 3 substantial pillars to create a book-length work. What other major areas does your topic require?",
            "overlap": "Two of your pillars seem to overlap. How are they distinct? Could they be combined?",
            "missing_mapping": "How does this pillar connect to your reader's pain points? If it doesn't solve a pain, why include it?",
            "not_sequential": "Do these pillars build on each other? What's the logical order for a reader's journey?",
        }
    },
    "the_authority": {
        "name": "The Authority",
        "description": "Your framework or strong opinion - the signature idea that establishes your authority.",
        "initial_prompt": """Finally, let's establish your AUTHORITY. Every memorable book has a signature framework or strong opinion.

This could be:
- A proprietary framework (like "The 4-Hour" anything, or "Atomic Habits")
- A contrarian opinion (challenging industry conventional wisdom)
- A unique methodology you've developed
- A new way of thinking about an old problem

Tell me:
1. What is your signature framework or strong opinion?
2. Why is this YOUR framework to own? (credibility, experience, research)
3. What's the one-liner that captures it?
4. Why will this framework be MEMORABLE?

This is what people will remember about your book. Make it count.""",
        "depth_criteria": [
            "Has a clear framework or strong opinion",
            "Has credibility to own this framework",
            "Has a memorable one-liner",
            "Framework is distinct and ownable",
        ],
        "challenge_prompts": {
            "generic_framework": "This framework sounds generic. What makes it YOURS? What unique twist or insight does it include?",
            "no_credibility": "Why should readers trust YOU with this framework? What experience or research backs it up?",
            "not_memorable": "Would someone remember this framework a week after reading your book? How can you make it stickier?",
            "too_complex": "This framework is too complex to remember. Can you distill it to a simple principle or acronym?",
        }
    },
}


def get_pillar_system_prompt(pillar_slug: str, global_summary: str = "") -> str:
    """Build the system prompt for a pillar conversation."""
    pillar_def = PILLAR_DEFINITIONS.get(pillar_slug, {})
    
    system_prompt = f"""You are a World-Class Book Strategist and Positioning Architect. You are conducting a deep-dive interview on the "{pillar_def.get('name', pillar_slug)}" pillar.

ROLE: You are a consultant, NOT a note-taker. You challenge vague answers, probe for specifics, and don't accept surface-level responses.

PILLAR FOCUS: {pillar_def.get('description', '')}

INTERROGATION RULES:
1. If an answer is vague or generic → ask "WHY specifically?" or "HOW exactly?"
2. If the user says "I don't know" → help them discover the answer through targeted questions
3. If differentiation is weak → challenge with "What do competitors get wrong?"
4. NEVER accept the first answer if it lacks depth
5. Push for specifics: names, numbers, examples, scenarios

DEPTH CRITERIA FOR COMPLETION:
{chr(10).join('- ' + c for c in pillar_def.get('depth_criteria', []))}

WHEN TO MARK COMPLETE:
Only mark this pillar as COMPLETE when ALL depth criteria are met AND the answers are "chapter-ready" (specific enough to write compelling book content from).

When the pillar IS complete, end your response with EXACTLY this marker on its own line:
[{pillar_def.get('name', pillar_slug).upper().replace(' ', '_')}: COMPLETE]

{f"GLOBAL CONTEXT (from other pillars):{chr(10)}{global_summary}" if global_summary else ""}

Remember: Generic positioning = generic books. Be the consultant who refuses to let the author settle for mediocrity."""

    return system_prompt


def evaluate_pillar_depth(pillar: PositioningPillar, messages: list) -> tuple[float, bool, str]:
    """
    Use AI to evaluate the depth of answers for a pillar.
    Returns: (depth_score 0-100, is_complete, reason)
    """
    pillar_def = PILLAR_DEFINITIONS.get(pillar.slug, {})
    
    # Build conversation text
    conversation = "\n".join([
        f"{msg.role.upper()}: {msg.content}" 
        for msg in messages 
        if msg.role in ["user", "assistant"]
    ])
    
    evaluation_prompt = f"""Evaluate this positioning conversation for the "{pillar.name}" pillar.

DEPTH CRITERIA:
{chr(10).join('- ' + c for c in pillar_def.get('depth_criteria', []))}

CONVERSATION:
{conversation}

Evaluate and return JSON:
{{
    "depth_score": 0-100 (how thoroughly the criteria are addressed),
    "is_complete": true/false (all criteria met at chapter-ready depth),
    "missing": ["list of criteria not yet met"],
    "reason": "brief explanation"
}}

Be STRICT. Only mark complete if answers are specific enough to write compelling book content from."""

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are evaluating positioning interview depth. Be strict - generic answers should fail."},
                {"role": "user", "content": evaluation_prompt},
            ],
            temperature=0.3,
            max_tokens=300,
            response_format={"type": "json_object"}
        )
        
        result = json.loads(completion.choices[0].message.content.strip())
        return (
            result.get("depth_score", 0),
            result.get("is_complete", False),
            result.get("reason", "")
        )
    except Exception as exc:
        print(f"Error evaluating pillar depth: {exc}")
        return (0, False, "Evaluation failed")


def generate_pillar_summary(pillar: PositioningPillar) -> str:
    """Generate a concise summary of the completed pillar for the positioning brief."""
    messages = list(pillar.messages.all())
    pillar_def = PILLAR_DEFINITIONS.get(pillar.slug, {})
    
    conversation = "\n".join([
        f"{msg.role.upper()}: {msg.content}" 
        for msg in messages 
        if msg.role in ["user", "assistant"]
    ])
    
    summary_prompt = f"""Summarize the key positioning insights from this "{pillar.name}" pillar conversation.

CONVERSATION:
{conversation}

Create a concise but complete summary (2-4 sentences) that captures:
- The specific insights discovered
- Key decisions made
- Information needed for book outline generation

This summary will be used as context for generating the book outline. Be specific and actionable."""

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are summarizing positioning insights. Be specific and actionable."},
                {"role": "user", "content": summary_prompt},
            ],
            temperature=0.5,
            max_tokens=200,
        )
        
        return completion.choices[0].message.content.strip()
    except Exception as exc:
        print(f"Error generating pillar summary: {exc}")
        return ""


def build_global_summary(book: Book, exclude_pillar: PositioningPillar = None) -> str:
    """Build a summary of all completed pillars for context injection."""
    completed_pillars = PositioningPillar.objects.filter(
        book=book, 
        status="COMPLETE"
    ).exclude(pk=exclude_pillar.pk if exclude_pillar else None)
    
    if not completed_pillars.exists():
        return ""
    
    summaries = []
    for p in completed_pillars:
        if p.summary:
            summaries.append(f"**{p.name}**: {p.summary}")
    
    return "\n".join(summaries)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def pillars_list_initialize(request, book_id: int):
    """
    GET: List all pillars for a book with their status.
    POST: Initialize the 9 pillars for a book (idempotent).
    """
    try:
        book = Book.objects.get(pk=book_id, user=request.user)
    except Book.DoesNotExist:
        return Response({"detail": "Book not found"}, status=status.HTTP_404_NOT_FOUND)
    
    if request.method == "POST":
        # Initialize pillars (idempotent - won't duplicate)
        PositioningPillar.initialize_for_book(book)
    
    # Return all pillars with their status
    pillars = PositioningPillar.objects.filter(book=book).order_by("order")
    
    # Calculate progress
    completed_count = pillars.filter(status="COMPLETE").count()
    total_count = pillars.count() or 9  # Default to 9 if not initialized
    progress_percentage = int((completed_count / total_count) * 100)
    
    # Find current active pillar
    active_pillar = pillars.filter(status="ACTIVE").first()
    
    data = {
        "book_id": book_id,
        "progress_percentage": progress_percentage,
        "pillars_completed": [p.slug for p in pillars.filter(status="COMPLETE")],
        "current_pillar": active_pillar.slug if active_pillar else None,
        "all_pillars_complete": completed_count == 9,
        "pillars": [
            {
                "id": p.id,
                "name": p.name,
                "slug": p.slug,
                "order": p.order,
                "status": p.status,
                "depth_score": p.depth_score,
                "summary": p.summary,
                "description": PILLAR_DEFINITIONS.get(p.slug, {}).get("description", ""),
            }
            for p in pillars
        ]
    }
    
    return Response(data, status=status.HTTP_200_OK)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def pillar_chat(request, pillar_id: int):
    """
    GET: Get chat history for a pillar.
    POST: Send a message and get AI response.
    """
    try:
        pillar = PositioningPillar.objects.select_related("book").get(pk=pillar_id)
        if pillar.book.user != request.user:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    except PositioningPillar.DoesNotExist:
        return Response({"detail": "Pillar not found"}, status=status.HTTP_404_NOT_FOUND)
    
    if pillar.status == "LOCKED":
        return Response(
            {"detail": "This pillar is locked. Complete previous pillars first."},
            status=status.HTTP_403_FORBIDDEN
        )
    
    if request.method == "GET":
        messages = PillarChatMessage.objects.filter(pillar=pillar).order_by("created_at")
        
        # If no messages, return the initial prompt
        if not messages.exists():
            initial_prompt = PILLAR_DEFINITIONS.get(pillar.slug, {}).get("initial_prompt", "")
            return Response({
                "pillar_id": pillar_id,
                "pillar_name": pillar.name,
                "pillar_slug": pillar.slug,
                "status": pillar.status,
                "depth_score": pillar.depth_score,
                "messages": [
                    {"role": "assistant", "content": initial_prompt, "state_emission": None}
                ],
                "state_emission": {
                    "current_pillar": pillar.slug,
                    "progress_percentage": 0,
                    "pillars_completed": [],
                }
            }, status=status.HTTP_200_OK)
        
        return Response({
            "pillar_id": pillar_id,
            "pillar_name": pillar.name,
            "pillar_slug": pillar.slug,
            "status": pillar.status,
            "depth_score": pillar.depth_score,
            "messages": [
                {
                    "role": msg.role,
                    "content": msg.content,
                    "state_emission": msg.state_emission,
                    "created_at": msg.created_at.isoformat(),
                }
                for msg in messages
            ]
        }, status=status.HTTP_200_OK)
    
    elif request.method == "POST":
        user_message = request.data.get("message", "").strip()
        if not user_message:
            return Response({"detail": "message is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        # If pillar is already complete, don't allow more messages
        if pillar.status == "COMPLETE":
            return Response(
                {"detail": "This pillar is already complete."},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Save user message
        PillarChatMessage.objects.create(
            pillar=pillar,
            role="user",
            content=user_message
        )
        
        # Build conversation history for AI
        messages_history = list(PillarChatMessage.objects.filter(pillar=pillar).order_by("created_at"))
        
        # Check if this is the first message (need to include initial prompt)
        pillar_def = PILLAR_DEFINITIONS.get(pillar.slug, {})
        initial_prompt = pillar_def.get("initial_prompt", "")
        
        # Build global summary from other pillars
        global_summary = build_global_summary(pillar.book, exclude_pillar=pillar)
        
        # Build messages for OpenAI
        openai_messages = [
            {"role": "system", "content": get_pillar_system_prompt(pillar.slug, global_summary)}
        ]
        
        # Add initial prompt if not in history
        if not any(m.role == "assistant" for m in messages_history[:-1] if messages_history):
            openai_messages.append({"role": "assistant", "content": initial_prompt})
        
        # Add conversation history
        for msg in messages_history:
            openai_messages.append({"role": msg.role, "content": msg.content})
        
        # Generate AI response
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        
        try:
            completion = client.chat.completions.create(
                model="gpt-4o",  # Using the more capable model for strategic conversations
                messages=openai_messages,
                temperature=0.7,
                max_tokens=1000,
            )
            
            ai_response = completion.choices[0].message.content.strip()
            
            # Check if AI marked pillar as complete
            completion_marker = f"[{pillar.name.upper().replace(' ', '_')}: COMPLETE]"
            is_complete = completion_marker in ai_response
            
            # Evaluate depth
            all_messages = list(PillarChatMessage.objects.filter(pillar=pillar).order_by("created_at"))
            depth_score, eval_complete, reason = evaluate_pillar_depth(pillar, all_messages)
            
            # Update pillar depth score
            pillar.depth_score = depth_score
            
            # If complete (either by marker or evaluation), update status
            if is_complete or (eval_complete and depth_score >= 80):
                pillar.status = "COMPLETE"
                pillar.summary = generate_pillar_summary(pillar)
                pillar.save()
                
                # Unlock next pillar
                next_pillar = pillar.unlock_next_pillar()
            else:
                pillar.save()
            
            # Build state emission
            all_pillars = PositioningPillar.objects.filter(book=pillar.book).order_by("order")
            completed_pillars = [p.slug for p in all_pillars if p.status == "COMPLETE"]
            progress = int((len(completed_pillars) / 9) * 100)
            
            state_emission = {
                "current_pillar": pillar.slug,
                "progress_percentage": progress,
                "pillars_completed": completed_pillars,
                "depth_score": depth_score,
                "is_complete": pillar.status == "COMPLETE",
            }
            
            # Save AI response with state emission
            ai_message = PillarChatMessage.objects.create(
                pillar=pillar,
                role="assistant",
                content=ai_response,
                state_emission=state_emission
            )
            
            return Response({
                "message": {
                    "role": "assistant",
                    "content": ai_response,
                    "state_emission": state_emission,
                    "created_at": ai_message.created_at.isoformat(),
                },
                "state_emission": state_emission,
                "pillar_status": pillar.status,
            }, status=status.HTTP_200_OK)
            
        except Exception as exc:
            print(f"OpenAI Error in pillar chat: {exc}")
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def pillar_mark_complete(request, pillar_id: int):
    """
    Manually mark a pillar as complete (with validation).
    Used when the AI doesn't auto-detect completion.
    """
    try:
        pillar = PositioningPillar.objects.select_related("book").get(pk=pillar_id)
        if pillar.book.user != request.user:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    except PositioningPillar.DoesNotExist:
        return Response({"detail": "Pillar not found"}, status=status.HTTP_404_NOT_FOUND)
    
    if pillar.status == "LOCKED":
        return Response(
            {"detail": "Cannot complete a locked pillar"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    if pillar.status == "COMPLETE":
        return Response(
            {"detail": "Pillar is already complete"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Validate depth before allowing manual completion
    messages = list(PillarChatMessage.objects.filter(pillar=pillar).order_by("created_at"))
    
    if len([m for m in messages if m.role == "user"]) < 2:
        return Response(
            {"detail": "Not enough conversation depth. Continue the discussion."},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    depth_score, is_deep_enough, reason = evaluate_pillar_depth(pillar, messages)
    
    if depth_score < 60:
        return Response({
            "detail": f"Pillar depth score is {depth_score}%. Needs at least 60% for manual completion.",
            "reason": reason,
            "depth_score": depth_score,
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Mark complete
    pillar.status = "COMPLETE"
    pillar.depth_score = depth_score
    pillar.summary = generate_pillar_summary(pillar)
    pillar.save()
    
    # Unlock next pillar
    next_pillar = pillar.unlock_next_pillar()
    
    return Response({
        "success": True,
        "pillar_status": "COMPLETE",
        "depth_score": depth_score,
        "next_pillar": next_pillar.slug if next_pillar else None,
    }, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_positioning_brief(request, book_id: int):
    """
    Get the Master Positioning Brief.
    Only available when ALL 9 pillars are COMPLETE.
    """
    try:
        book = Book.objects.get(pk=book_id, user=request.user)
    except Book.DoesNotExist:
        return Response({"detail": "Book not found"}, status=status.HTTP_404_NOT_FOUND)
    
    pillars = PositioningPillar.objects.filter(book=book)
    incomplete_pillars = pillars.exclude(status="COMPLETE")
    
    if incomplete_pillars.exists():
        incomplete_names = [p.name for p in incomplete_pillars]
        return Response({
            "detail": "Cannot generate positioning brief until all pillars are complete",
            "incomplete_pillars": incomplete_names,
            "is_ready": False,
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Check if brief already exists
    try:
        brief = PositioningBrief.objects.get(book=book)
        return Response({
            "is_ready": True,
            "brief": brief.brief_text,
            "pillar_summaries": brief.pillar_summaries,
            "generated_at": brief.generated_at.isoformat(),
        }, status=status.HTTP_200_OK)
    except PositioningBrief.DoesNotExist:
        pass
    
    # Generate the brief
    pillar_summaries = {}
    for p in pillars.order_by("order"):
        pillar_summaries[p.slug] = {
            "name": p.name,
            "summary": p.summary or "",
            "depth_score": p.depth_score,
        }
    
    # Build the full brief
    brief_parts = [
        "# MASTER POSITIONING BRIEF",
        f"## Book: {book.title}",
        "",
    ]
    
    for slug, data in pillar_summaries.items():
        brief_parts.append(f"### {data['name']}")
        brief_parts.append(data['summary'])
        brief_parts.append("")
    
    brief_text = "\n".join(brief_parts)
    
    # Save the brief
    brief, created = PositioningBrief.objects.update_or_create(
        book=book,
        defaults={
            "brief_text": brief_text,
            "pillar_summaries": pillar_summaries,
        }
    )
    
    return Response({
        "is_ready": True,
        "brief": brief_text,
        "pillar_summaries": pillar_summaries,
        "generated_at": brief.generated_at.isoformat(),
    }, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def pillar_reset(request, pillar_id: int):
    """Reset a pillar to start over (clears chat history)."""
    try:
        pillar = PositioningPillar.objects.select_related("book").get(pk=pillar_id)
        if pillar.book.user != request.user:
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    except PositioningPillar.DoesNotExist:
        return Response({"detail": "Pillar not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Delete chat history
    PillarChatMessage.objects.filter(pillar=pillar).delete()
    
    # Reset pillar state
    pillar.depth_score = 0
    pillar.summary = None
    pillar.status = "ACTIVE"  # Keep it active so user can restart
    pillar.save()
    
    # Delete positioning brief if it exists (since pillar is now incomplete)
    PositioningBrief.objects.filter(book=pillar.book).delete()
    
    return Response({
        "success": True,
        "pillar_status": "ACTIVE",
    }, status=status.HTTP_200_OK)

