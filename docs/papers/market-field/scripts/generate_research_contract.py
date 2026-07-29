"""Generate the goal-led evidence-hierarchy figure for the Market Field paper."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch


PAPER_ROOT = Path(__file__).resolve().parents[1]
FIGURE_ROOT = PAPER_ROOT / "figures"

PAPER = "#FBFCFE"
INK = "#1F2937"
MUTED = "#667085"
GRID = "#CBD5E1"
BLUE = "#2F6B9A"
BLUE_DARK = "#173F5F"
BLUE_LIGHT = "#DCE9F2"
GOLD_LIGHT = "#F7EDD1"
ORANGE_LIGHT = "#F3E8D8"
NEUTRAL_LIGHT = "#E9EDF3"


def _box(
    axis: plt.Axes,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    body: str,
    facecolor: str,
) -> None:
    patch = FancyBboxPatch(
        (x, y),
        width,
        height,
        boxstyle="round,pad=0.012,rounding_size=0.018",
        linewidth=1.0,
        edgecolor=INK,
        facecolor=facecolor,
    )
    axis.add_patch(patch)
    axis.text(
        x + 0.018,
        y + height - 0.055,
        title,
        ha="left",
        va="top",
        color=INK,
        fontsize=8.7,
        weight="bold",
    )
    axis.text(
        x + 0.018,
        y + height - 0.118,
        body,
        ha="left",
        va="top",
        color=MUTED,
        fontsize=7.1,
        linespacing=1.12,
    )


def _arrow(
    axis: plt.Axes,
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    color: str,
    style: str = "-|>",
    linewidth: float = 1.15,
    linestyle: str = "-",
) -> None:
    axis.add_patch(
        FancyArrowPatch(
            start,
            end,
            arrowstyle=style,
            mutation_scale=10,
            linewidth=linewidth,
            linestyle=linestyle,
            color=color,
        )
    )


def main() -> None:
    FIGURE_ROOT.mkdir(parents=True, exist_ok=True)
    figure, axis = plt.subplots(figsize=(7.1, 3.2))
    figure.patch.set_facecolor(PAPER)
    axis.set_facecolor(PAPER)
    axis.set_xlim(0, 1)
    axis.set_ylim(0, 1)
    axis.axis("off")

    axis.text(
        0.02,
        0.955,
        "One market-state conclusion, four depths of evidence",
        ha="left",
        va="top",
        color=INK,
        fontsize=13,
        weight="bold",
    )
    xs = (0.025, 0.272, 0.519, 0.766)
    width = 0.205
    top_y = 0.54
    bottom_y = 0.12
    height = 0.27

    reader = (
        (
            "Conclusion",
            "What happened\nWhat changed\nWhat to inspect",
            GOLD_LIGHT,
        ),
        (
            "Evidence",
            "Cloud and trail\nRelative scopes\nSupport",
            BLUE_LIGHT,
        ),
        (
            "Definitions",
            "15 measurements\nOwn-history context\nPair gaps",
            NEUTRAL_LIGHT,
        ),
        (
            "Audit receipt",
            "Shared alignment keys\nInputs and identities\nAuthority",
            ORANGE_LIGHT,
        ),
    )
    computation = (
        (
            "Translation",
            "Plain language\nwith explicit limits",
            GOLD_LIGHT,
        ),
        (
            "15 coordinates",
            "Motion (5)\nField (7)\nCarriers (3)",
            BLUE_LIGHT,
        ),
        (
            "Horizon field",
            "Pressure across\nbar time × lookback",
            NEUTRAL_LIGHT,
        ),
        (
            "Completed bars",
            "Normalized OHLCV\ncompleted prefixes\nMissing stays missing",
            ORANGE_LIGHT,
        ),
    )

    axis.text(0.02, 0.825, "READER PATH  →", color=BLUE_DARK, fontsize=8, weight="bold")
    axis.text(0.98, 0.425, "←  COMPUTATION PATH", ha="right", color=BLUE_DARK, fontsize=8, weight="bold")

    for x, (title, body, color) in zip(xs, reader, strict=True):
        _box(
            axis,
            x=x,
            y=top_y,
            width=width,
            height=height,
            title=title,
            body=body,
            facecolor=color,
        )
    for x, (title, body, color) in zip(xs, computation, strict=True):
        _box(
            axis,
            x=x,
            y=bottom_y,
            width=width,
            height=height,
            title=title,
            body=body,
            facecolor=color,
        )

    for index in range(3):
        _arrow(
            axis,
            (xs[index] + width + 0.004, top_y + height / 2),
            (xs[index + 1] - 0.004, top_y + height / 2),
            color=BLUE_DARK,
        )
        _arrow(
            axis,
            (xs[index + 1] - 0.004, bottom_y + height / 2),
            (xs[index] + width + 0.004, bottom_y + height / 2),
            color=BLUE_DARK,
        )

    for x in xs:
        center_x = x + width / 2
        _arrow(
            axis,
            (center_x, bottom_y + height + 0.008),
            (center_x, top_y - 0.008),
            color=GRID,
            style="-|>",
            linewidth=0.9,
            linestyle="--",
        )

    axis.text(
        0.5,
        0.035,
        "No layer turns missing support into a value, a relative difference into a winner, or a descriptive state into a trade.",
        ha="center",
        va="center",
        color=MUTED,
        fontsize=8.4,
    )

    artifact_time = datetime(2026, 7, 28, tzinfo=timezone.utc)
    figure.savefig(
        FIGURE_ROOT / "research_contract.pdf",
        bbox_inches="tight",
        metadata={
            "Title": "Market Field research contract",
            "Author": "Market Diagnostic Dashboard",
            "Creator": "generate_research_contract.py",
            "CreationDate": artifact_time,
            "ModDate": artifact_time,
        },
    )
    figure.savefig(
        FIGURE_ROOT / "research_contract.png",
        dpi=220,
        bbox_inches="tight",
        metadata={"Software": "generate_research_contract.py"},
    )
    plt.close(figure)


if __name__ == "__main__":
    main()
