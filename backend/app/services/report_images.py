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
