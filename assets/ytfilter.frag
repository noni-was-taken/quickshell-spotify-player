#version 440
// Full-resolution film grain over the YouTube mode background, a new pattern 12 times a second.
// Rebuild after editing:  /usr/lib/qt6/bin/qsb --qt6 -o ytfilter.frag.qsb ytfilter.frag
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float clock;
    vec2 size;      // window size in pixels
};
float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
    vec2 px = qt_TexCoord0 * size;
    float g = h2(floor(px / 1.5) + floor(clock * 12.0) * 17.0) - 0.5;
    fragColor = vec4(vec3(g * 0.13), 0.0) * qt_Opacity;
}
