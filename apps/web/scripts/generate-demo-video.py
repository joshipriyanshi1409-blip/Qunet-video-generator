#!/usr/bin/env python3
"""Generates the demo render the web app ships in `public/demo/`.

Six 1080x1920 scenes are drawn with ImageMagick, then cross-faded and encoded to
H.264 by ffmpeg (libx264, faststart, no audio), with an animated progress bar
over the whole cut. Output is 540x960, 25 fps, 46 seconds, ~210 KB.

Why this is a script and not a checked-in ffmpeg invocation: the asset is
committed, so the app never needs ffmpeg - but a demo video that cannot be
regenerated is a binary nobody can review. Needs `convert`/`mogrify` and an
`ffmpeg` with libx264; point FFMPEG at one if it is not on PATH.

    python3 apps/web/scripts/generate-demo-video.py [output.mp4]

The default output is the path the app serves.

The poster in `public/demo/creatordna-demo-poster.jpg` is one frame of the cut:

    ffmpeg -ss 2 -i creatordna-demo.mp4 -frames:v 1 -vf scale=540:960 poster.jpg
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile

CONVERT = os.environ.get("CONVERT", "convert")
MOGRIFY = os.environ.get("MOGRIFY", "mogrify")
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")

W, H = 1080, 1920
FPS = 24
TOTAL_SECONDS = 46
TRANSITION = 0.5
# Scene lengths chosen so that, after five 0.5s dissolves, the cut is exactly 46s.
SCENE_SECONDS = [6.5, 8.5, 8.5, 8.5, 8.5, 8.0]

BG_TOP = "#12203a"
BG_BOTTOM = "#0a101c"
INK = "#f8fafc"
MUTED = "#94a3b8"
FAINT = "#475569"
PEACH = "#fb923c"
PEACH_SOFT = "#fdba74"
BOX = "#1b2a47"
BOX_DIM = "#141f36"
MONO = "DejaVu-Sans-Mono-Bold"
SANS = "DejaVu-Sans"
SANS_BOLD = "DejaVu-Sans-Bold"

ARRAY = [1, 3, 5, 9, 11, 15, 19, 23]
BOX_W, BOX_H, GAP = 104, 104, 16
ARRAY_W = len(ARRAY) * BOX_W + (len(ARRAY) - 1) * GAP
ARRAY_X = (W - ARRAY_W) // 2
ARRAY_Y = 620
BAR_Y = 1810


def run(args: list[str]) -> None:
    result = subprocess.run(args, check=False, capture_output=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr.decode("utf-8", "replace")[-2000:] + "\n")
        raise SystemExit("failed: " + " ".join(args[:6]))


def edit(dst: str, *args: str) -> None:
    """Applies draw/annotate operators to one PNG in place."""
    run([MOGRIFY, *args, dst])


def background(path: str) -> None:
    run([CONVERT, "-size", f"{W}x{H}", f"gradient:{BG_TOP}-{BG_BOTTOM}", path])


def draw_chip(dst: str, text: str, y: int = 150) -> None:
    # One width for every chip in the cut, so the badge does not jump between
    # scenes: the label inside it does the talking.
    width = 760
    x = (W - width) // 2
    edit(
        dst,
        "-fill", "#16233b",
        "-stroke", "#24344f",
        "-strokewidth", "2",
        "-draw", f"roundrectangle {x},{y} {x + width},{y + 92} 46,46",
        "-stroke", "none",
        "-font", SANS_BOLD,
        "-pointsize", "34",
        "-fill", PEACH_SOFT,
        "-gravity", "North",
        "-annotate", f"+0+{y + 26}",
        text,
    )


def text_width(text: str, pointsize: int, font: str) -> int:
    """Rendered width of `text`, so centred lines can share one left edge."""
    result = subprocess.run(
        [CONVERT, "-font", font, "-pointsize", str(pointsize), f"label:{text}", "-format", "%w", "info:"],
        check=True,
        capture_output=True,
    )
    return int(result.stdout.strip())


def fit_pointsize(text: str, pointsize: int, font: str, max_width: int) -> int:
    """Largest size at or below `pointsize` that keeps `text` inside `max_width`."""
    size = pointsize
    while size > 16 and text_width(text, size, font) > max_width:
        size -= 2
    return size


def annotate(dst: str, text: str, y: int, pointsize: int, fill: str, font: str = SANS_BOLD) -> None:
    # Never let a line run past the frame: a clipped caption reads as a bug.
    pointsize = fit_pointsize(text, pointsize, font, W - 72)
    x = max(24, (W - text_width(text, pointsize, font)) // 2)
    edit(
        dst,
        "-font", font,
        "-pointsize", str(pointsize),
        "-fill", fill,
        "-gravity", "NorthWest",
        "-annotate", f"+{x}+{y}",
        text,
    )


def underline(dst: str, width: int, y: int) -> None:
    edit(
        dst,
        "-fill", PEACH,
        "-draw", f"roundrectangle {(W - width) // 2},{y} {(W + width) // 2},{y + 12} 6,6",
    )


def array_boxes(dst: str, dimmed: set[int], found: int | None = None, y: int = ARRAY_Y) -> None:
    for index, value in enumerate(ARRAY):
        x = ARRAY_X + index * (BOX_W + GAP)
        is_found = found == value
        fill = PEACH if is_found else (BOX_DIM if value in dimmed else BOX)
        text_color = "#0b1220" if is_found else (FAINT if value in dimmed else "#e2e8f0")
        edit(
            dst,
            "-fill", fill,
            "-stroke", PEACH if is_found else "#2b3d5c",
            "-strokewidth", "3" if is_found else "2",
            "-draw", f"roundrectangle {x},{y} {x + BOX_W},{y + BOX_H} 20,20",
            "-stroke", "none",
            "-font", MONO,
            "-pointsize", "46",
            "-fill", text_color,
            "-gravity", "NorthWest",
            "-annotate", f"+{x + 34}+{y + 26}",
            str(value),
        )


LADDER = "8  →  4  →  2  →  1"
def ladder(dst: str, reached: int, y: int = 1330) -> None:
    """`8 → 4 → 2 → 1`, with the halvings already taken drawn in peach."""
    pointsize = 46
    full_width = text_width(LADDER, pointsize, SANS_BOLD)
    x = (W - full_width) // 2
    edit(
        dst,
        "-font", SANS_BOLD, "-pointsize", str(pointsize), "-fill", FAINT,
        "-gravity", "NorthWest", "-annotate", f"+{x}+{y}", LADDER,
    )
    if reached <= 0:
        return
    prefix = "  →  ".join(["8", "4", "2", "1"][: reached + 1])
    edit(
        dst,
        "-font", SANS_BOLD, "-pointsize", str(pointsize), "-fill", PEACH,
        "-gravity", "NorthWest", "-annotate", f"+{x}+{y}", prefix,
    )


def big_number(dst: str, value: int, y: int = 1120) -> None:
    """One peach tile, used on the call to action as the found value."""
    size = 200
    x = (W - size) // 2
    edit(
        dst,
        "-fill", PEACH, "-stroke", PEACH_SOFT, "-strokewidth", "4",
        "-draw", f"roundrectangle {x},{y} {x + size},{y + size} 36,36",
        "-stroke", "none", "-font", MONO, "-pointsize", "88", "-fill", "#0b1220",
        "-gravity", "NorthWest", "-annotate", f"+{x + 62}+{y + 52}", str(value),
    )


def progress_track(dst: str) -> None:
    """The dark track the animated peach fill is drawn over during encoding."""
    edit(
        dst,
        "-fill", "#1e293b",
        "-draw", f"roundrectangle {ARRAY_X},{BAR_Y} {ARRAY_X + ARRAY_W},{BAR_Y + 12} 6,6",
    )


def footer(dst: str) -> None:
    annotate(dst, "Binary Search Made Easy", 1700, 32, FAINT, SANS)
    progress_track(dst)


def scene_hook(path: str) -> None:
    background(path)
    draw_chip(path, "CREATORDNA  ·  DEMO RENDER")
    annotate(path, "POV:", 520, 76, PEACH_SOFT)
    annotate(path, "You finally understand", 620, 72, INK)
    annotate(path, "Binary Search", 716, 72, INK)
    annotate(path, "after 3 days", 812, 72, INK)
    underline(path, 220, 950)
    array_boxes(path, dimmed=set(), y=1080)
    annotate(path, "Binary Search Made Easy", 1440, 46, MUTED, SANS)
    annotate(path, "0:46  ·  9:16  ·  script, voice and captions from your DNA", 1660, 30, FAINT, SANS)
    progress_track(path)


def scene_question(path: str) -> None:
    background(path)
    draw_chip(path, "STEP 1 OF 4")
    annotate(path, "Find 23 in a sorted array", 380, 62, INK)
    annotate(path, "8 numbers, sorted - so we can halve the search every step", 470, 32, MUTED, SANS)
    array_boxes(path, dimmed=set())
    annotate(path, "linear search checks all 8  ·  binary search checks 3", 810, 32, MUTED, SANS)
    ladder(path, 0)
    footer(path)


def scene_halve_one(path: str) -> None:
    background(path)
    draw_chip(path, "STEP 2 OF 4")
    annotate(path, "mid = 9    →    23 > 9", 380, 62, INK)
    annotate(path, "Drop everything left of 9. Half the array is gone.", 470, 32, MUTED, SANS)
    array_boxes(path, dimmed={1, 3, 5, 9}, found=23)
    annotate(path, "half the array is gone", 810, 32, MUTED, SANS)
    ladder(path, 1)
    footer(path)


def scene_halve_two(path: str) -> None:
    background(path)
    draw_chip(path, "STEP 3 OF 4")
    annotate(path, "mid = 15    →    23 > 15", 380, 62, INK)
    annotate(path, "Drop again. Two candidates left.", 470, 32, MUTED, SANS)
    array_boxes(path, dimmed={1, 3, 5, 9, 11, 15}, found=23)
    annotate(path, "two candidates left", 810, 32, MUTED, SANS)
    ladder(path, 2)
    footer(path)


def scene_found(path: str) -> None:
    background(path)
    draw_chip(path, "STEP 4 OF 4")
    annotate(path, "mid = 19    →    found 23", 380, 62, INK)
    annotate(path, "Three halvings instead of eight checks.", 470, 32, MUTED, SANS)
    array_boxes(path, dimmed={1, 3, 5, 9, 11, 15, 19}, found=23)
    annotate(path, "found, in three comparisons", 810, 32, MUTED, SANS)
    ladder(path, 3)
    footer(path)


def scene_cta(path: str) -> None:
    background(path)
    draw_chip(path, "CREATORDNA  ·  DEMO RENDER")
    annotate(path, "Save this for your", 640, 74, INK)
    annotate(path, "next coding interview", 732, 74, INK)
    underline(path, 300, 860)
    annotate(path, "Follow for more CSE tips", 910, 44, PEACH_SOFT)
    big_number(path, 23, 1080)
    annotate(path, "A demo render.", 1470, 30, FAINT, SANS)
    annotate(path, "Your own video is written, voiced and cut from your Creator DNA.", 1520, 30, FAINT, SANS)
    progress_track(path)


SCENES = [
    scene_hook,
    scene_question,
    scene_halve_one,
    scene_halve_two,
    scene_found,
    scene_cta,
]


BAR_FPS = 25
BAR_RGB = (251, 146, 60)


def write_progress_frames(path: str, total_seconds: float) -> int:
    """Writes the animated bar as raw RGBA frames: the width is the progress.

    Renderers here have no filter that evaluates a width expression per frame, so
    the bar is generated as pixels and handed to ffmpeg as an overlay - which is
    also the only way to get it to move *smoothly* rather than in scene-sized
    steps.
    """
    frames = int(round(total_seconds * BAR_FPS))
    rows = []
    for index in range(frames):
        filled = int(round(ARRAY_W * (index + 1) / frames))
        row = bytearray(ARRAY_W * 4)
        for x in range(filled):
            offset = x * 4
            row[offset : offset + 4] = bytes((*BAR_RGB, 255))
        rows.append(bytes(row) * 12)
    with open(path, "wb") as handle:
        for frame in rows:
            handle.write(frame)
    return frames


def default_output() -> str:
    """`apps/web/public/demo/creatordna-demo.mp4`, wherever this is run from."""
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(app_dir, "public", "demo", "creatordna-demo.mp4")


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else default_output()
    with tempfile.TemporaryDirectory() as tmp:
        frames = []
        for index, builder in enumerate(SCENES):
            path = os.path.join(tmp, f"scene{index}.png")
            builder(path)
            frames.append(path)

        # Start time of each scene in the cut: every dissolve overlaps the two
        # scenes by TRANSITION seconds.
        starts = []
        cursor = 0.0
        for seconds in SCENE_SECONDS:
            starts.append(cursor)
            cursor += seconds - TRANSITION
        total = starts[-1] + SCENE_SECONDS[-1]

        inputs: list[str] = [
            # The canvas every scene is overlaid on: it is what makes the cut one
            # continuous timeline instead of a stack of clips.
            "-f", "lavfi",
            "-t", f"{total}",
            "-i", f"color=c={BG_BOTTOM}:s={W}x{H}:r=25",
        ]
        for path, seconds in zip(frames, SCENE_SECONDS):
            inputs += ["-loop", "1", "-t", f"{seconds}", "-i", path]

        bar_path = os.path.join(tmp, "progress.rgba")
        write_progress_frames(bar_path, total)
        inputs += [
            "-f", "rawvideo",
            "-pixel_format", "rgba",
            "-video_size", f"{ARRAY_W}x12",
            "-framerate", str(BAR_FPS),
            "-i", bar_path,
        ]
        bar_input = len(starts) + 1  # 0 is the canvas, 1..N the scenes

        chain: list[str] = ["[0:v]format=yuv420p[bg]"]
        for index, start in enumerate(starts):
            label = f"s{index}"
            if index == 0:
                chain.append(f"[{index + 1}:v]format=yuva420p,setpts=PTS-STARTPTS[{label}]")
            else:
                # Delay the scene to its start, then dissolve it in over the one
                # underneath. ffmpeg 4.1 has no xfade, so the dissolve is an
                # alpha fade on an overlay.
                chain.append(
                    f"[{index + 1}:v]format=yuva420p,setpts=PTS-STARTPTS+{start:.3f}/TB,"
                    f"fade=t=in:st={start:.3f}:d={TRANSITION}:alpha=1[{label}]"
                )

        previous = "bg"
        for index in range(len(starts)):
            output = f"o{index}"
            chain.append(f"[{previous}][s{index}]overlay=0:0[{output}]")
            previous = output

        # The peach fill goes on after the dissolves, over the track every scene
        # already carries, so it never fades out with a scene.
        chain.append(
            f"[{previous}][{bar_input}:v]overlay={ARRAY_X}:{BAR_Y}:format=auto,"
            f"scale=540:960:flags=lanczos,format=yuv420p[out]"
        )

        run(
            [
                FFMPEG, "-y", *inputs,
                "-filter_complex", ";".join(chain),
                "-map", "[out]",
                "-t", f"{total}",
                "-c:v", "libx264",
                "-profile:v", "main",
                "-preset", "medium",
                "-crf", "30",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                "-an",
                out,
            ]
        )
    print(out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
