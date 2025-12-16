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

from pilot.api.serializers import BookSerializer
from pilot.models import Book, Chapter, Section, TalkingPoint, UserContext, ChapterAsset

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
    """Return all books for the current user with nested chapters/sections/talking points."""
    books = Book.objects.prefetch_related(
        "chapters__sections__talking_points"
    ).filter(user=request.user).order_by("-id")
    data = BookSerializer(books, many=True).data
    return Response(data, status=status.HTTP_200_OK)


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
    """Return a single book by id with nested data (only if owned by user)."""
    try:
        book = Book.objects.prefetch_related(
            "chapters__sections__talking_points"
        ).get(pk=pk, user=request.user)
    except Book.DoesNotExist:
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    data = BookSerializer(book).data
    
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
        tp = TalkingPoint.objects.select_related("section__chapter__book").get(
            pk=tp_id, section__chapter__book__user=request.user
        )
    except TalkingPoint.DoesNotExist:
        return Response({"detail": "Talking point not found"}, status=status.HTTP_404_NOT_FOUND)

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
        tp = TalkingPoint.objects.select_related("section__chapter__book").get(
            pk=tp_id, section__chapter__book__user=request.user
        )
    except TalkingPoint.DoesNotExist:
        return Response({"detail": "Talking point not found"}, status=status.HTTP_404_NOT_FOUND)
    book_id = tp.section.chapter.book_id
    tp.delete()
    data = _serialized_book(book_id, request.user)
    return Response(data, status=status.HTTP_200_OK)

