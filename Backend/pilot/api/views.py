import json
import os
from typing import List

from django.db import transaction
from openai import OpenAI  # type: ignore[import-not-found]
from pydantic import BaseModel  # type: ignore[import-not-found]
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from pilot.api.serializers import BookSerializer, CommentSerializer, ContentChangeSerializer
from pilot.models import Book, Chapter, Section, TalkingPoint, UserContext, ChapterAsset, Comment, BookCollaborator, ContentChange, CollaborationState
from pilot.api.checks import run_book_checks


def user_has_book_access(user, book):
    """Check if user is the book owner or a collaborator."""
    if book.user == user:
        return True
    return BookCollaborator.objects.filter(book=book, user=user).exists()


def extract_text_from_file(asset):
    """Extract text content from uploaded file based on file type."""
    try:
        file_ext = asset.file_type.lower()
        
        if file_ext == "txt":
            # Read plain text file
            with asset.file.open('r', encoding='utf-8') as f:
                content = f.read()
            return content
        
        elif file_ext == "csv":
            # Read CSV file
            import csv
            with asset.file.open('r', encoding='utf-8') as f:
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


class TalkingPointModel(BaseModel):
    text: str


class SectionModel(BaseModel):
    title: str
    talking_points: List[TalkingPointModel]


class ChapterModel(BaseModel):
    title: str
    sections: List[SectionModel]


class BookOutlineModel(BaseModel):
    title: str
    chapters: List[ChapterModel]


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def createOutline(request):
    answers = request.data.get("answers")
    book_id = request.data.get("book_id")
    if not isinstance(answers, list) or not answers:
        return Response(
            {"detail": "answers must be a non-empty list"}, status=status.HTTP_400_BAD_REQUEST
        )

    prompt = _build_prompt(answers)
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
        print("OPENAI ERROR:", exc)
        return Response(
            {"detail": str(exc)},
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
        return Response({"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    serialized = BookSerializer(book)
    return Response(serialized.data, status=status.HTTP_201_CREATED)


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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_books(request):
    """Return all books for the current user (owned and collaborated) with nested chapters/sections/talking points."""
    # Get books owned by user
    owned_books = Book.objects.prefetch_related(
        "chapters__sections__talking_points"
    ).filter(user=request.user)
    
    # Get books where user is a collaborator
    collaborated_books = Book.objects.prefetch_related(
        "chapters__sections__talking_points"
    ).filter(collaborators__user=request.user)
    
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
        book = Book.objects.prefetch_related(
            "chapters__sections__talking_points"
        ).get(pk=pk)
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
        if asset_ids:
            assets = ChapterAsset.objects.filter(id__in=asset_ids, book=book)
            if assets.exists():
                context_parts.append("\n=== REFERENCE FILES CONTENT ===")
                for asset in assets:
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

        prompt = f"""You are a professional book writer helping an author develop content from talking points.

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
    book_id = request.data.get("book_id")
    talking_point_id = request.data.get("talking_point_id")
    file = request.FILES.get("file")

    if not book_id or not file:
        return Response(
            {"detail": "book_id and file are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
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

        asset = ChapterAsset.objects.create(
            book=book,
            talking_point=talking_point,
            file=file,
            filename=filename,
            file_type=file_ext,
            user=request.user,
        )

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
        return Response(
            {"detail": str(exc)},
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

        prompt = f"""You are a helpful writing assistant helping an author with their book. Answer the user's question about the current talking point.

Context:
{context_text}

User's Question: {question}

Provide a helpful, concise, and actionable answer. If the question is about the highlighted text, focus your answer on that specific section. Be encouraging and constructive."""

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
    """Apply quick actions (shorten, expand, give example) to selected text."""
    book_id = request.data.get("book_id")
    talking_point_id = request.data.get("talking_point_id")
    selected_text = request.data.get("selected_text", "").strip()
    action = request.data.get("action")  # "shorten", "expand", "give_example"

    if not book_id or not talking_point_id or not selected_text or not action:
        return Response(
            {"detail": "book_id, talking_point_id, selected_text, and action are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if action not in ["shorten", "expand", "give_example"]:
        return Response(
            {"detail": "action must be one of: shorten, expand, give_example"},
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
            prompt = f"""You are a professional book editor. The user wants to shorten the following selected text while maintaining its core meaning and impact.

{context_text}

Selected text to shorten:
"{selected_text}"

Provide a shortened version that:
1. Maintains the core message and meaning
2. Is more concise and impactful
3. Removes unnecessary words without losing important information
4. Flows naturally

Return ONLY the shortened text, nothing else."""
        
        elif action == "expand":
            prompt = f"""You are a professional book writer. The user wants to expand the following selected text with more detail and depth.

{context_text}

Selected text to expand:
"{selected_text}"

Provide an expanded version that:
1. Adds more detail, depth, and context
2. Maintains the original meaning and tone
3. Provides additional insights or explanations
4. Flows naturally and is well-written

Return ONLY the expanded text, nothing else."""
        
        elif action == "give_example":
            prompt = f"""You are a professional book writer. The user wants you to add a concrete example to illustrate the following selected text.

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
    except TalkingPoint.DoesNotExist:
        return Response(
            {"detail": "Talking point not found"},
            status=status.HTTP_404_NOT_FOUND,
        )

    if request.method == "GET":
        comments = Comment.objects.filter(talking_point=talking_point).select_related("user")
        serializer = CommentSerializer(comments, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    elif request.method == "POST":
        # Determine comment type based on user relationship to book
        is_owner = book.user == request.user
        is_collaborator = BookCollaborator.objects.filter(book=book, user=request.user).exists()
        
        comment_type = "collaborator" if (is_collaborator and not is_owner) else "user"
        
        serializer = CommentSerializer(data={
            **request.data,
            "talking_point": talking_point_id,
            "user": request.user.id,
            "comment_type": comment_type,
        })
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
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
            prompt = f"""You are a helpful writing assistant helping an author with their book. The user wants to make changes to the content based on their question.

Context:
{context_text}

User's Question: {question}

Based on the user's question, provide an improved version of the content. If the question is about highlighted text, focus on improving that specific section. Return ONLY the improved content, maintaining the same structure and format. Do not include explanations or meta-commentary."""
        else:
            prompt = f"""You are a helpful writing assistant helping an author with their book. Answer the user's question about the current talking point.

Context:
{context_text}

User's Question: {question}

Provide a helpful, concise, and actionable answer. If the question is about the highlighted text, focus your answer on that specific section. Be encouraging and constructive."""

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

    # Check if user has access to the book (owner or collaborator)
    book = tp.section.chapter.book
    if not user_has_book_access(request.user, book):
        return Response({"detail": "You do not have permission to update this talking point"}, status=status.HTTP_403_FORBIDDEN)

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
        book = Book.objects.prefetch_related(
            'chapters__sections__talking_points'
        ).get(pk=book_id)
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
        # Only book owner can approve/reject
        if book.user != request.user:
            return Response(
                {"detail": "Only the book owner can approve or reject changes"},
                status=status.HTTP_403_FORBIDDEN
            )
        
        new_status = request.data.get("status")
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

