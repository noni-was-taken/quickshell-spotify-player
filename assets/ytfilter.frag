#version 440
// Full-resolution filter over the YouTube mode backgrounds; a different one per background.
// Rebuild after editing:  /usr/lib/qt6/bin/qsb --qt6 -o ytfilter.frag.qsb ytfilter.frag
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float look;     // 0 stage screen, 1 old film, 2 lo-fi tape, 3 night clean
    float clock;
    vec2 size;      // window size in pixels
};
float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
    vec2 px = qt_TexCoord0 * size;
    float frame = floor(clock * 12.0);
    float g = h2(floor(px) + frame * 17.0) - 0.5;          // grain, a new pattern 12 times a second
    vec4 c = vec4(0.0);                                      // premultiplied: rgb added light/dark, a coverage
    if (look < 0.5) {            // stage screen: bold scanlines, colour fringe at the edges, heavier grain
        float line = step(2.0, mod(px.y, 4.0));
        c = vec4(0.0, 0.0, 0.0, 0.38 * (1.0 - line));
        float edge = min(qt_TexCoord0.x, 1.0 - qt_TexCoord0.x);
        c.rgb += mix(vec3(1.0, 0.18, 0.7), vec3(0.13, 0.88, 1.0), step(0.5, qt_TexCoord0.x)) * 0.1 * smoothstep(0.03, 0.0, edge);
        c.rgb += vec3(g * 0.11);
    } else if (look < 1.5) {     // old film: warm wash, coarse grain, dust, light leak
        float gc = h2(floor(px / 2.0) + frame * 17.0) - 0.5;
        c.rgb = vec3(1.0, 0.6, 0.25) * 0.035 + vec3(1.0, 0.48, 0.24) * 0.1 * smoothstep(0.3, 0.0, qt_TexCoord0.x) + vec3(gc * 0.16);
        float dust = step(0.99993, h2(floor(px / 2.0) + floor(clock * 4.0) * 3.1));
        c = vec4(c.rgb, 0.0) + vec4(0.0, 0.0, 0.0, 0.5 * dust);
    } else if (look < 2.5) {     // lo-fi tape: fine scanlines, cool tint, a slowly rolling tracking band
        float line = step(1.0, mod(px.y, 3.0));
        float band = fract(qt_TexCoord0.y - clock * 0.02);
        c = vec4(vec3(0.3, 0.45, 1.0) * 0.025 + vec3(0.8, 0.9, 1.0) * 0.045 * smoothstep(0.03, 0.0, abs(band - 0.5)) + vec3(g * 0.08), 0.22 * (1.0 - line));
    } else {                     // night clean: fine grain only
        c = vec4(vec3(g * 0.05), 0.0);
    }
    fragColor = c * qt_Opacity;
}
