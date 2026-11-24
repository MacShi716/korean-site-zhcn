#!/usr/bin/env python3
"""Build Android launcher icons from the site's apple-touch-icon.png.

Legacy mipmaps use the full icon. Adaptive foregrounds keep the glyph inside
the 72dp safe zone on a 108dp canvas so circular masks do not clip 동.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "apple-touch-icon.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

LEGACY = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
FOREGROUND = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def background_color(image: Image.Image) -> tuple[int, int, int, int]:
    pixel = image.convert("RGBA").getpixel((2, 2))
    return pixel if len(pixel) == 4 else (*pixel, 255)


def resize(image: Image.Image, size: int) -> Image.Image:
    return image.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)


def foreground(image: Image.Image, canvas_size: int, fill) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_size, canvas_size), fill)
    glyph = int(round(canvas_size * 72 / 108))
    icon = resize(image, glyph)
    offset = (canvas_size - glyph) // 2
    canvas.alpha_composite(icon, (offset, offset))
    return canvas


def write_splash(path: Path, image: Image.Image) -> None:
    if not path.is_file():
        return
    with Image.open(path) as current:
        size = current.size
    # Page background, with the launcher glyph centered.
    canvas = Image.new("RGBA", size, (242, 235, 221, 255))
    glyph = max(32, int(min(size) * 0.42))
    icon = resize(image, glyph)
    canvas.alpha_composite(icon, ((size[0] - glyph) // 2, (size[1] - glyph) // 2))
    canvas.convert("RGB").save(path, format="PNG")


def write_xml(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> None:
    if not SOURCE.is_file() or SOURCE.stat().st_size <= 0:
        raise SystemExit(f"missing icon source: {SOURCE}")
    image = Image.open(SOURCE)
    fill = background_color(image)
    hex_color = "#{:02X}{:02X}{:02X}".format(*fill[:3])

    for folder, size in LEGACY.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        icon = resize(image, size)
        icon.save(out_dir / "ic_launcher.png")
        icon.save(out_dir / "ic_launcher_round.png")

    for folder, size in FOREGROUND.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        foreground(image, size, fill).save(out_dir / "ic_launcher_foreground.png")

    # Drop the Capacitor placeholder vector / webp launcher art if present.
    for leftover in RES.rglob("*"):
        name = leftover.name
        if leftover.suffix in {".webp", ".xml"} and name.startswith("ic_launcher"):
            if leftover.parent.name.startswith("drawable") or leftover.suffix == ".webp":
                leftover.unlink()

    write_xml(
        RES / "values" / "ic_launcher_background.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">%s</color>
</resources>
"""
        % hex_color,
    )
    write_xml(
        RES / "mipmap-anydpi-v26" / "ic_launcher.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
""",
    )
    write_xml(
        RES / "mipmap-anydpi-v26" / "ic_launcher_round.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
""",
    )
    for splash in RES.rglob("splash.png"):
        write_splash(splash, image)

    print(f"wrote launcher icons from {SOURCE.name}, background {hex_color}")


if __name__ == "__main__":
    main()
