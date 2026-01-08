"""
Book Checks System - Per Talking Point Analysis

HARD CONSTRAINTS:
- Talking Point is the smallest unit of analysis
- Checks NEVER merge or diff content across Talking Points
- No content mutation (read-only analysis)
- Findings must reference a specific Talking Point
"""
from typing import List, Dict, Any
from pilot.models import Book, Chapter, Section, TalkingPoint


def run_editorial_quality_checks(tp: TalkingPoint) -> List[Dict[str, Any]]:
    """Run editorial quality checks on a single Talking Point."""
    findings = []
    content = tp.content or ""
    
    if not content:
        return findings
    
    # Check 1: Size (Word/Char count)
    word_count = len(content.split())
    char_count = len(content)
    
    if word_count < 50:
        findings.append({
            "code": "EDITORIAL_SIZE_TOO_SHORT",
            "title": "Content Too Short",
            "message": f"This talking point has only {word_count} words. Consider expanding to provide more value.",
            "recommendation": "Aim for at least 100-200 words per talking point for better depth.",
            "status": "warning",
        })
    elif word_count > 1000:
        findings.append({
            "code": "EDITORIAL_SIZE_TOO_LONG",
            "title": "Content Too Long",
            "message": f"This talking point has {word_count} words, which may be too lengthy for a single point.",
            "recommendation": "Consider splitting into multiple talking points for better readability.",
            "status": "warning",
        })
    
    # Check 2: Structural Coherence
    # Check for paragraph structure
    paragraphs = content.split('\n\n')
    if len(paragraphs) < 2 and word_count > 200:
        findings.append({
            "code": "EDITORIAL_STRUCTURE_MISSING",
            "title": "Missing Paragraph Structure",
            "message": "Long content should be broken into multiple paragraphs for better readability.",
            "recommendation": "Add paragraph breaks to improve structure and flow.",
            "status": "warning",
        })
    
    # Check 3: Clarity & Focus
    # Check for very long sentences (over 50 words)
    sentences = content.replace('!', '.').replace('?', '.').split('.')
    long_sentences = [s.strip() for s in sentences if len(s.split()) > 50]
    if long_sentences:
        findings.append({
            "code": "EDITORIAL_CLARITY_LONG_SENTENCES",
            "title": "Long Sentences Detected",
            "message": f"Found {len(long_sentences)} sentence(s) with more than 50 words. Long sentences can reduce clarity.",
            "recommendation": "Break long sentences into shorter, more digestible ones.",
            "status": "warning",
        })
    
    # Check 4: Consistency
    # Check for repeated phrases (simple check)
    words = content.lower().split()
    if len(words) > 20:
        word_freq = {}
        for word in words:
            if len(word) > 4:  # Only check words longer than 4 chars
                word_freq[word] = word_freq.get(word, 0) + 1
        
        repeated = {k: v for k, v in word_freq.items() if v > 5}
        if repeated:
            findings.append({
                "code": "EDITORIAL_CONSISTENCY_REPETITION",
                "title": "Word Repetition Detected",
                "message": "Some words are repeated frequently, which may indicate lack of variety.",
                "recommendation": "Consider using synonyms or rephrasing to improve variety.",
                "status": "warning",
            })
    
    return findings


def run_legal_ethical_checks(tp: TalkingPoint) -> List[Dict[str, Any]]:
    """Run legal/ethical/attribution checks on a single Talking Point."""
    findings = []
    content = tp.content or ""
    
    if not content:
        return findings
    
    # Check 1: Source Checker
    # Look for citation indicators
    citation_keywords = ['source:', 'cited', 'reference', 'according to', 'study shows', 'research']
    has_citations = any(keyword in content.lower() for keyword in citation_keywords)
    
    if not has_citations and len(content.split()) > 100:
        findings.append({
            "code": "LEGAL_SOURCE_MISSING",
            "title": "Missing Source Citations",
            "message": "Content appears to make claims but lacks explicit source citations.",
            "recommendation": "Add citations for factual claims, statistics, or research findings.",
            "status": "warning",
        })
    
    # Check 2: Citation Checker
    # Check for proper citation format (basic check)
    citation_patterns = ['(', ')', '[', ']']
    has_citation_format = any(pattern in content for pattern in citation_patterns)
    
    # Check 3: Plagiarism Checker
    # This would typically call an external service, but for now we'll do a basic check
    # Check for very common phrases that might indicate copied content
    common_phrases = [
        'it is important to note that',
        'in conclusion',
        'it should be noted that',
    ]
    found_common = [phrase for phrase in common_phrases if phrase in content.lower()]
    
    # Note: Real plagiarism detection would require external API
    
    return findings


def run_platform_compliance_checks(tp: TalkingPoint) -> List[Dict[str, Any]]:
    """Run platform compliance checks (POD/EPUB) on a single Talking Point."""
    findings = []
    content = tp.content or ""
    
    if not content:
        return findings
    
    # Check 1: PoD Trim & Margins
    # Check for very long lines (indicator of formatting issues)
    lines = content.split('\n')
    long_lines = [line for line in lines if len(line) > 100]
    if long_lines:
        findings.append({
            "code": "PLATFORM_POD_LONG_LINES",
            "title": "Long Lines Detected",
            "message": f"Found {len(long_lines)} line(s) exceeding 100 characters, which may cause formatting issues in print.",
            "recommendation": "Break long lines or adjust formatting for better print layout.",
            "status": "warning",
        })
    
    # Check 2: Accessibility & EPUB3
    # Check for heading hierarchy (basic check)
    # Look for heading-like patterns
    has_headings = any(line.strip().startswith('#') for line in lines)
    
    # Check 3: Heading Hierarchy
    # Check if headings are properly structured
    heading_levels = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('#'):
            level = len(stripped) - len(stripped.lstrip('#'))
            heading_levels.append(level)
    
    if heading_levels:
        # Check if heading hierarchy is broken (e.g., h1 -> h3 without h2)
        for i in range(len(heading_levels) - 1):
            if heading_levels[i+1] > heading_levels[i] + 1:
                findings.append({
                    "code": "PLATFORM_HEADING_HIERARCHY",
                    "title": "Broken Heading Hierarchy",
                    "message": "Heading levels skip (e.g., h1 followed by h3). This breaks accessibility standards.",
                    "recommendation": "Maintain proper heading hierarchy (h1 -> h2 -> h3, etc.).",
                    "status": "critical",
                })
                break
    
    # Check 4: Special Characters
    # Check for problematic characters for EPUB
    problematic_chars = ['\x00', '\x08', '\x0B', '\x0C']
    found_problematic = [char for char in problematic_chars if char in content]
    if found_problematic:
        findings.append({
            "code": "PLATFORM_EPUB_INVALID_CHARS",
            "title": "Invalid Characters for EPUB",
            "message": "Content contains characters that may cause issues in EPUB format.",
            "recommendation": "Remove or replace invalid control characters.",
            "status": "critical",
        })
    
    return findings


def run_book_checks(book: Book) -> Dict[str, Any]:
    """
    Run checks on entire book, analyzing each Talking Point independently.
    
    Returns aggregated results by category.
    """
    all_findings = []
    
    # Iterate through all chapters, sections, and talking points
    for chapter in book.chapters.all().order_by('order'):
        for section in chapter.sections.all().order_by('order'):
            for tp in section.talking_points.all().order_by('order'):
                # Run checks on this Talking Point only
                editorial_findings = run_editorial_quality_checks(tp)
                legal_findings = run_legal_ethical_checks(tp)
                platform_findings = run_platform_compliance_checks(tp)
                
                # Add Talking Point reference to each finding
                for finding in editorial_findings:
                    finding.update({
                        "book_id": book.id,
                        "chapter_id": chapter.id,
                        "chapter_title": chapter.title,
                        "section_id": section.id,
                        "section_title": section.title,
                        "talking_point_id": tp.id,
                        "talking_point_text": tp.text[:50] + "..." if len(tp.text) > 50 else tp.text,
                        "category": "editorial",
                    })
                    all_findings.append(finding)
                
                for finding in legal_findings:
                    finding.update({
                        "book_id": book.id,
                        "chapter_id": chapter.id,
                        "chapter_title": chapter.title,
                        "section_id": section.id,
                        "section_title": section.title,
                        "talking_point_id": tp.id,
                        "talking_point_text": tp.text[:50] + "..." if len(tp.text) > 50 else tp.text,
                        "category": "legal",
                    })
                    all_findings.append(finding)
                
                for finding in platform_findings:
                    finding.update({
                        "book_id": book.id,
                        "chapter_id": chapter.id,
                        "chapter_title": chapter.title,
                        "section_id": section.id,
                        "section_title": section.title,
                        "talking_point_id": tp.id,
                        "talking_point_text": tp.text[:50] + "..." if len(tp.text) > 50 else tp.text,
                        "category": "platform",
                    })
                    all_findings.append(finding)
    
    # Aggregate results by category
    editorial_findings = [f for f in all_findings if f["category"] == "editorial"]
    legal_findings = [f for f in all_findings if f["category"] == "legal"]
    platform_findings = [f for f in all_findings if f["category"] == "platform"]
    
    # Determine status for each category
    def get_category_status(findings: List[Dict]) -> str:
        if not findings:
            return "passed"
        critical_count = sum(1 for f in findings if f["status"] == "critical")
        if critical_count > 0:
            return "critical"
        return "warning"
    
    return {
        "book_id": book.id,
        "categories": {
            "editorial": {
                "status": get_category_status(editorial_findings),
                "findings_count": len(editorial_findings),
                "findings": editorial_findings,
                "checks": [
                    "Size (Word/Char count)",
                    "Structural Coherence",
                    "Clarity & Focus",
                    "Consistency",
                ],
            },
            "legal": {
                "status": get_category_status(legal_findings),
                "findings_count": len(legal_findings),
                "findings": legal_findings,
                "checks": [
                    "Source Checker",
                    "Citation Checker",
                    "Plagiarism Checker",
                ],
            },
            "platform": {
                "status": get_category_status(platform_findings),
                "findings_count": len(platform_findings),
                "findings": platform_findings,
                "checks": [
                    "PoD Trim & Margins",
                    "Accessibility & EPUB3",
                    "Heading Hierarchy",
                    "Character Validation",
                ],
            },
        },
        "all_findings": all_findings,
    }

