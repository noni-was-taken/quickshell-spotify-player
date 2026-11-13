#version 440
// Film grain for YouTube mode, a new pattern 12 times a second. Used twice: over the background, and over the
// video with fine scanlines and a soft edge vignette added, so the video sits in the same filmed look.
// Rebuild after editing:  /usr/lib/qt6/bin/qsb --qt6 -o ytfilter.frag.qsb ytfilter.frag
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float clock;
    vec2 size;      // area size in pixels
    float grain;    // grain strength
    float lines;    // scanline darkness, 0 = none
    float edge;     // edge vignette darkness, 0 = none
    float rate;     // new grain patterns per second; they crossfade, so a low rate looks smooth
};
float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
    vec2 px = qt_TexCoord0 * size;
    float f = clock * rate;
    float g0 = h2(floor(px / 1.5) + floor(f) * 17.0), g1 = h2(floor(px / 1.5) + (floor(f) + 1.0) * 17.0);
    float g = mix(g0, g1, smoothstep(0.0, 1.0, fract(f))) - 0.5;
    vec2 e = min(qt_TexCoord0, 1.0 - qt_TexCoord0);
    float dark = lines * step(2.0, mod(px.y, 3.0)) + edge * (1.0 - smoothstep(0.0, 0.12, min(e.x, e.y * 1.78)));
    fragColor = vec4(vec3(g * grain), clamp(dark, 0.0, 1.0)) * qt_Opacity;
}
