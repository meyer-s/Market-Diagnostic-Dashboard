from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.update_post import UpdatePostCreate
from app.services.market_diagnostic_validation import validate_markdown_image_alt_text


@pytest.mark.parametrize(
    "markdown",
    [
        "![](https://example.com/breadth.png)",
        "![   ](https://example.com/breadth.png)",
        "![chart](https://example.com/breadth.png)",
        "![A chart.](https://example.com/breadth.png)",
        "![Image 1](https://example.com/breadth.png)",
        "![figure.png](https://example.com/breadth.png)",
        "![][breadth-chart]\n\n[breadth-chart]: https://example.com/breadth.png",
    ],
)
def test_markdown_image_validation_rejects_empty_or_generic_alt_text(markdown: str):
    with pytest.raises(ValueError, match="must include meaningful alt text"):
        validate_markdown_image_alt_text(markdown)


def test_markdown_image_validation_accepts_descriptive_and_decorative_images():
    validate_markdown_image_alt_text(
        "![S&P 500 participation rose to 64 percent while the index held flat]"
        "(https://example.com/breadth.png)\n\n"
        "![decorative](https://example.com/divider.svg)"
    )


def test_markdown_image_validation_ignores_image_examples_inside_code():
    validate_markdown_image_alt_text(
        "Use `![](https://example.com/example.png)` to demonstrate the invalid form.\n\n"
        "```markdown\n"
        "![](https://example.com/example.png)\n"
        "```\n"
    )


def test_update_post_create_enforces_alt_text_but_accepts_decorative_convention():
    with pytest.raises(ValidationError, match="must include meaningful alt text"):
        UpdatePostCreate(
            title="Accessibility test",
            summary="A publishing validation test.",
            content_markdown="![chart](https://example.com/chart.png)",
        )

    payload = UpdatePostCreate(
        title="Decorative image test",
        summary="A publishing validation test.",
        content_markdown="![decorative](https://example.com/divider.svg)",
    )
    assert payload.content_markdown.startswith("![decorative]")
