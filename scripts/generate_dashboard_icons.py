from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "packages" / "dashboard" / "public"


def catmull_rom_spline(points: list[tuple[float, float]], samples_per_segment: int = 28) -> list[tuple[float, float]]:
    extended = [points[0], *points, points[-1]]
    result: list[tuple[float, float]] = []

    for index in range(1, len(extended) - 2):
        p0, p1, p2, p3 = extended[index - 1], extended[index], extended[index + 1], extended[index + 2]
        for sample in range(samples_per_segment):
            t = sample / samples_per_segment
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (
                (2 * p1[0])
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                (2 * p1[1])
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            result.append((x, y))

    result.append(points[-1])
    return result


def fit_points(size: int) -> list[tuple[float, float]]:
    anchors = [
        (0.14, 0.50),
        (0.37, 0.50),
        (0.43, 0.50),
        (0.47, 0.39),
        (0.52, 0.62),
        (0.61, 0.24),
        (0.69, 0.71),
        (0.77, 0.46),
        (0.83, 0.50),
        (0.90, 0.50),
    ]
    return catmull_rom_spline([(size * x, size * y) for x, y in anchors])


def alpha_composite(base: Image.Image, layers: Iterable[Image.Image]) -> Image.Image:
    output = base
    for layer in layers:
        output = Image.alpha_composite(output, layer)
    return output


def render_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = int(size * 0.07)
    inset = int(size * 0.12)

    aura = Image.new("RGBA", image.size, (0, 0, 0, 0))
    aura_draw = ImageDraw.Draw(aura)
    aura_draw.rounded_rectangle(
        (inset - int(size * 0.03), inset - int(size * 0.03), size - inset + int(size * 0.03), size - inset + int(size * 0.03)),
        radius=max(8, radius + int(size * 0.01)),
        fill=(88, 157, 255, 56),
    )
    aura = aura.filter(ImageFilter.GaussianBlur(radius=max(8, size // 28)))

    card = Image.new("RGBA", image.size, (0, 0, 0, 0))
    card_draw = ImageDraw.Draw(card)
    card_draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=radius,
        fill=(4, 10, 18, 255),
    )

    center_glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(center_glow)
    ellipse_box = (
        int(size * 0.24),
        int(size * 0.24),
        int(size * 0.76),
        int(size * 0.76),
    )
    glow_draw.ellipse(ellipse_box, fill=(56, 146, 255, 90))
    center_glow = center_glow.filter(ImageFilter.GaussianBlur(radius=max(12, size // 14)))
    center_glow = ImageChops.multiply(center_glow, card)

    wave_points = fit_points(size)

    outer_wave = Image.new("RGBA", image.size, (0, 0, 0, 0))
    outer_draw = ImageDraw.Draw(outer_wave)
    outer_draw.line(wave_points, fill=(92, 190, 255, 220), width=max(8, size // 26), joint="curve")
    outer_wave = outer_wave.filter(ImageFilter.GaussianBlur(radius=max(8, size // 24)))
    outer_wave = ImageChops.multiply(outer_wave, card)

    mid_wave = Image.new("RGBA", image.size, (0, 0, 0, 0))
    mid_draw = ImageDraw.Draw(mid_wave)
    mid_draw.line(wave_points, fill=(146, 223, 255, 235), width=max(5, size // 42), joint="curve")
    mid_wave = mid_wave.filter(ImageFilter.GaussianBlur(radius=max(2, size // 85)))
    mid_wave = ImageChops.multiply(mid_wave, card)

    core_wave = Image.new("RGBA", image.size, (0, 0, 0, 0))
    core_draw = ImageDraw.Draw(core_wave)
    core_draw.line(wave_points, fill=(247, 252, 255, 255), width=max(3, size // 64), joint="curve")
    core_wave = ImageChops.multiply(core_wave, card)

    return alpha_composite(image, [aura, card, center_glow, outer_wave, mid_wave, core_wave])


def main() -> int:
    outputs = {
        "pulse-icon-192.png": 192,
        "pulse-icon-512.png": 512,
        "apple-touch-icon.png": 180,
    }

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    for filename, size in outputs.items():
        render_icon(size).save(PUBLIC_DIR / filename)

    print("Generated dashboard icon assets.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
