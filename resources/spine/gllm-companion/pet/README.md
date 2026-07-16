# Floating mascot skins

The application renders the mascot from transparent 32-bit PNG layers. The original glossy orbit is preserved exactly; animation is a moving highlight plus occasional body/eye frames.

- `blue/`: original blue mascot and magenta/cyan orbit.
- `gold/`: deterministic high-color gold material grade with the original alpha, shading and reflections preserved.
- `previews/*-high-color.webp`: transparent lossless animated WebP preview.
- `previews/*-high-color.png`: transparent APNG preview.
- `previews/*-compat-transparent.gif`: transparent compatibility preview only. GIF is limited to a 256-color palette and is not used by the application.

Regenerate all assets with the bundled Python runtime:

```powershell
python resources/spine/gllm-companion/tools/build-pet-skins.py
```
