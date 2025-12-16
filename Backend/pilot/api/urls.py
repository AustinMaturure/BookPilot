from django.urls import path
from .views import (
    createOutline,
    list_books,
    get_book,
    create_chapter,
    update_chapter,
    delete_chapter,
    create_section,
    update_section,
    delete_section,
    create_talking_point,
    update_talking_point,
    delete_talking_point,
)

urlpatterns = [
    path("create_outline/", createOutline),
    path("books/", list_books),
    path("books/<int:pk>/", get_book),
    path("books/<int:book_id>/chapters/", create_chapter),
    path("chapters/<int:chapter_id>/", update_chapter),
    path("chapters/<int:chapter_id>/delete/", delete_chapter),
    path("chapters/<int:chapter_id>/sections/", create_section),
    path("sections/<int:section_id>/", update_section),
    path("sections/<int:section_id>/delete/", delete_section),
    path("sections/<int:section_id>/talking_points/", create_talking_point),
    path("talking_points/<int:tp_id>/", update_talking_point),
    path("talking_points/<int:tp_id>/delete/", delete_talking_point),
]