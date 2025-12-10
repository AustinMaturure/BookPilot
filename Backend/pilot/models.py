from django.db import models

# Create your models here.

class Book(Model):
    title = models.CharField(max_length=50)
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

    def __str__(self):
        return f"{self.section} - {self.text[:40]}"
