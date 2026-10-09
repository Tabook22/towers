"""Report selection is independent of evidence completeness and archive retention."""


def selected_images(position, *image_types):
    candidates = sorted(
        (image for image in position.images if image.file_path and
         (not image_types or image.image_type in image_types)),
        key=lambda image: (image_types.index(image.image_type) if image_types else image.image_type, image.sequence, image.id),
    )
    first_by_type = {}
    for image in candidates:
        first_by_type.setdefault(image.image_type, image.id)
    # NULL means a legacy/untouched choice: preserve the previous first-uploaded-per-type rule.
    # Explicitly unchecking that image must never silently select a different extra image.
    return [image for image in candidates if
            (image.include_in_report if image.include_in_report is not None
             else first_by_type[image.image_type] == image.id)]


class InlineImageGroup:
    """Render multiple docxtpl InlineImages in a template's existing image cell."""
    def __init__(self, images):
        self.images = images

    def __str__(self):
        # InlineImage renders during Jinja evaluation, when its template part is available.
        return '</w:t><w:br/><w:t xml:space="preserve">'.join(str(image) for image in self.images)


def index_report_images(document):
    """Index this document's immutable image parts, without patching library globals.

    python-docx and docxcompose otherwise repeatedly hash every previous image
    for every insertion. Large inspection reports become quadratic in image bytes.
    Keep the normal image-part allocation and deduplication behavior.
    """
    from docx.package import ImageParts

    class IndexedImageParts(ImageParts):
        def __init__(self, existing):
            super().__init__()
            self.by_sha1 = {}
            for part in existing:
                self.append(part)

        def append(self, part):
            super().append(part)
            self.by_sha1.setdefault(part.sha1, part)

        def _get_by_sha1(self, sha1):
            return self.by_sha1.get(sha1)

    package = document.part.package
    # python-docx exposes this collection through a read-only lazyproperty.
    # Replace only its cached value on this package, never the shared descriptor.
    package.__dict__["image_parts"] = IndexedImageParts(package.image_parts)
