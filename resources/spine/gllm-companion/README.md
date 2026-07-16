# G-LLM Spine Companion Resources

These transparent PNGs are the source layers for the desktop companion and can also be imported into Spine.

## Layers

Use this draw order for the three-dimensional orbital effect:

1. `gllm-spine-orbit-ribbon-back-v1.png`
2. `gllm-spine-mascot-body-v1.png`
3. `gllm-spine-orbit-ribbon-front-v1.png`

`gllm-spine-orbit-ribbon-v1.png` is the complete ring and is useful for previews or a single-slot setup.

## Notes

- All PNGs are 1254 x 1254 RGBA images with transparent backgrounds.
- The front and back ring images are already separated using the ring's tilted plane.
- Keep the mascot body centered with the ring assets when importing them into Spine.
- `pet/blue` and `pet/gold` contain the application-ready layered skins and blink frames.
- `pet/previews` contains transparent high-color APNG/WebP previews. GIF files are compatibility previews only.
- Run `tools/build-pet-skins.py` to rebuild the gold skin and all previews without modifying the original source layers.
