"""Build high-color floating mascot skins and transparent compatibility previews."""

from __future__ import annotations

import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
PET_ROOT = ROOT / "pet"
PREVIEW_ROOT = PET_ROOT / "previews"
CANVAS = 1254
PREVIEW_SIZE = 420
FRAME_COUNT = 36


def gold_grade(source: Image.Image, preserve_face: bool) -> Image.Image:
    rgba = np.asarray(source.convert("RGBA"), dtype=np.float32) / 255.0
    rgb = rgba[..., :3]
    alpha = rgba[..., 3:4]
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    saturation = np.divide(maximum - minimum, maximum, out=np.zeros_like(maximum), where=maximum > 0.001)
    luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722

    stops = np.array(
        [
            [0.06, 0.035, 0.015],
            [0.20, 0.105, 0.018],
            [0.48, 0.245, 0.025],
            [0.72, 0.455, 0.055],
            [0.91, 0.690, 0.190],
            [1.00, 0.890, 0.520],
            [1.00, 0.985, 0.900],
        ],
        dtype=np.float32,
    )
    positions = np.array([0.0, 0.16, 0.32, 0.48, 0.66, 0.84, 1.0], dtype=np.float32)
    gold = np.stack(
        [np.interp(luminance, positions, stops[:, channel]) for channel in range(3)],
        axis=2,
    )

    # Keep the deep navy face and white eye highlights; recolor the saturated shell,
    # letter and orbit while retaining every source highlight and shadow.
    chroma_weight = np.clip((saturation - 0.06) / 0.34, 0.0, 1.0)
    neutral_guard = np.clip(saturation / 0.18, 0.0, 1.0)
    blend = np.maximum(chroma_weight, neutral_guard * 0.16)
    if preserve_face:
        height, width = luminance.shape
        yy, xx = np.ogrid[:height, :width]
        face = ((xx - width * 0.515) / (width * 0.235)) ** 2 + ((yy - height * 0.445) / (height * 0.225)) ** 2 < 1.0
        face_guard = face & (luminance < 0.17)
        blend = np.where(face_guard, blend * 0.08, blend)
    blend = blend[..., None]
    graded = rgb * (1.0 - blend) + gold * blend
    result = np.concatenate((np.clip(graded, 0.0, 1.0), alpha), axis=2)
    return Image.fromarray(np.round(result * 255.0).astype(np.uint8), "RGBA")


def copy_blue_assets() -> None:
    target = PET_ROOT / "blue"
    target.mkdir(parents=True, exist_ok=True)
    sources = {
        "body-open.png": ROOT / "gllm-spine-mascot-body-v1.png",
        "orbit-back.png": ROOT / "gllm-spine-orbit-ribbon-back-v1.png",
        "orbit-front.png": ROOT / "gllm-spine-orbit-ribbon-front-v1.png",
        "orbit-full.png": ROOT / "gllm-spine-orbit-ribbon-v1.png",
    }
    for name, source in sources.items():
        shutil.copy2(source, target / name)


def build_gold_assets() -> None:
    source_root = PET_ROOT / "blue"
    target = PET_ROOT / "gold"
    target.mkdir(parents=True, exist_ok=True)
    for source in source_root.glob("*.png"):
        with Image.open(source) as image:
            gold_grade(image, source.name.startswith("body-")).save(target / source.name, optimize=True)


def orbit_point(angle: float, size: int) -> tuple[float, float, bool]:
    scale = size / CANVAS
    center_x, center_y = 627.0 * scale, 614.0 * scale
    radius_x, radius_y = 548.0 * scale, 218.0 * scale
    tilt = math.radians(-11.0)
    local_x = radius_x * math.cos(angle)
    local_y = radius_y * math.sin(angle)
    x = center_x + local_x * math.cos(tilt) - local_y * math.sin(tilt)
    y = center_y + local_x * math.sin(tilt) + local_y * math.cos(tilt)
    return x, y, math.sin(angle) >= 0


def draw_spark(size: int, angle: float, gold: bool) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x, y, _ = orbit_point(angle, size)
    radius = max(3, round(size * 0.012))
    glow = Image.new("RGBA", (radius * 8, radius * 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    center = radius * 4
    palette = (255, 199, 68) if gold else (39, 229, 255)
    for step in range(radius * 4, 0, -1):
        progress = 1.0 - step / (radius * 4)
        alpha = round(80 * progress * progress)
        draw.ellipse(
            (center - step, center - step, center + step, center + step),
            fill=(*palette, alpha),
        )
    glow = glow.filter(ImageFilter.GaussianBlur(max(1, radius // 2)))
    core = ImageDraw.Draw(glow)
    core.ellipse(
        (center - radius, center - radius, center + radius, center + radius),
        fill=(255, 255, 247, 245),
        outline=(*palette, 255),
        width=max(1, radius // 3),
    )
    layer.alpha_composite(glow, (round(x - center), round(y - center)))
    return layer


def load_scaled(path: Path, size: int) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)


def build_preview(skin: str) -> list[Image.Image]:
    skin_root = PET_ROOT / skin
    back = load_scaled(skin_root / "orbit-back.png", PREVIEW_SIZE)
    front = load_scaled(skin_root / "orbit-front.png", PREVIEW_SIZE)
    body_images = {
        "open": load_scaled(skin_root / "body-open.png", PREVIEW_SIZE),
        "half": load_scaled(skin_root / "body-half.png", PREVIEW_SIZE),
        "closed": load_scaled(skin_root / "body-closed.png", PREVIEW_SIZE),
    }
    frames: list[Image.Image] = []
    blink_frames = {24: "half", 25: "closed", 26: "half"}
    for index in range(FRAME_COUNT):
        angle = index / FRAME_COUNT * math.tau
        spark = draw_spark(PREVIEW_SIZE, angle, skin == "gold")
        _, _, is_front = orbit_point(angle, PREVIEW_SIZE)
        frame = Image.new("RGBA", (PREVIEW_SIZE, PREVIEW_SIZE), (0, 0, 0, 0))
        frame.alpha_composite(back)
        if not is_front:
            frame.alpha_composite(spark)
        frame.alpha_composite(body_images[blink_frames.get(index, "open")])
        frame.alpha_composite(front)
        if is_front:
            frame.alpha_composite(spark)
        frames.append(frame)
    return frames


def save_previews(skin: str, frames: list[Image.Image]) -> None:
    PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    duration = 75
    frames[0].save(
        PREVIEW_ROOT / f"{skin}-high-color.webp",
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        lossless=True,
        method=6,
    )
    frames[0].save(
        PREVIEW_ROOT / f"{skin}-high-color.png",
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        disposal=2,
        blend=0,
        optimize=True,
    )

    # GIF can be transparent, but its 256-color palette will always band gradients.
    gif_frames: list[Image.Image] = []
    for frame in frames:
        resized = frame.resize((280, 280), Image.Resampling.LANCZOS)
        alpha = np.asarray(resized.getchannel("A"))
        paletted = resized.convert("RGB").quantize(
            colors=255,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.FLOYDSTEINBERG,
        )
        palette = paletted.getpalette()[: 255 * 3]
        paletted.putpalette(palette + [0, 0, 0] + [0] * (768 - len(palette) - 3))
        pixels = np.asarray(paletted).copy()
        pixels[alpha < 24] = 255
        paletted.putdata(pixels.ravel())
        paletted.info["transparency"] = 255
        gif_frames.append(paletted)
    gif_frames[0].save(
        PREVIEW_ROOT / f"{skin}-compat-transparent.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=duration,
        loop=0,
        disposal=2,
        transparency=255,
        optimize=False,
    )


def main() -> None:
    copy_blue_assets()
    build_gold_assets()
    for skin in ("blue", "gold"):
        save_previews(skin, build_preview(skin))


if __name__ == "__main__":
    main()
