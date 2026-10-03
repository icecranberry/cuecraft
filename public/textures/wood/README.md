# Wood texture sources

Bundled original JPEG maps from [Poly Haven](https://polyhaven.com), licensed
[CC0 1.0](https://polyhaven.com/license). No runtime third-party requests.
`provenance.json` records each original download URL and MD5 checksum.

| Preset | Source | Treatment |
| --- | --- | --- |
| 白蜡木 / ash | https://polyhaven.com/a/ash_veneer | Original color; UV rotated to follow the cue axis |
| 枫木 / maple | https://polyhaven.com/a/white_maple_veneer | Original color; UV rotated to follow the cue axis |
| 红木 / rosewood | https://polyhaven.com/a/rosewood_veneer1 | Original color; longitudinal grain |
| 乌木 / ebony | https://polyhaven.com/a/dark_wood | Dark hardwood scan with a cool dark material tint; an appearance approximation, not a verified ebony species scan |

Color maps are 2048 × 2048 sRGB; OpenGL normal and roughness maps are
1024 × 1024 linear data. Original files are retained without image edits.
The material factory applies the same UV transform to all channels, including
clearcoat normal and roughness. Square scans use a single isotropic scale in mm:
the circumference crops a narrow strip instead of compressing an entire image.
The final 8% of the cylinder's circumference blends into its starting sample to
close the seam without rescaling the grain. Flat end faces disable this seam blend.
Axial sampling uses actual part length and axial origin to preserve scale and phase
across adjacent parts. Effective scan sizes are tuned for cue visualization, not
wood identification or manufacturing color calibration. Normal maps describe the
wood pores; the lacquer uses a much weaker normal scale for a polished surface.
Scanned roughness modulates the wood and clearcoat separately while keeping
the selected gloss / semi / matte finish authoritative.

Load failures retain the preset's solid base color. Cached images are shared;
per-part texture transforms are independent and disposed with their material.
