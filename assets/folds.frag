#version 440
// Silk-fold background: soft colour sheets, each with one sharp crease. Rebuild after editing:
//   /usr/lib/qt6/bin/qsb --qt6 -o folds.frag.qsb folds.frag
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float flow;    // always-increasing phase; speeds up slightly with the music
    float energy;  // smoothed bass, 0..1
    float aspect;
    vec2 mouse;    // pointer, in the same space as p below
    vec2 drag;     // how far the pointer is ahead of where the fabric has caught up to
    vec4 c0;
    vec4 c1;
    vec4 c2;
    vec4 c3;
};

vec3 sheet(vec2 p, float seed, float place) {
    float a = -0.62 + 0.28 * sin(flow * 0.27 + seed);
    vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;

    float bend = 0.18 + 0.22 * energy;
    float crease = place + 0.07 * sin(flow * 0.31 + seed * 3.0)
        + bend * sin(q.x * 1.9 + flow * 0.8 + seed)
        + (0.06 + 0.05 * energy) * sin(q.x * 4.3 - flow * 0.6 + seed * 2.0);
    float d = q.y - crease;

    float reach = 0.3 + 0.22 * energy;
    float above = exp(-max(d, 0.0) / reach);
    float below = exp(min(d, 0.0) / (reach * 0.3)) * 0.3;
    float light = mix(below, above, smoothstep(-0.012, 0.012, d));   // one continuous value, so no dark seam on the crease

    float cx = 0.55 * sin(flow * 0.23 + seed * 1.7);
    float len = 0.85 + 0.22 * energy;
    float along = exp(-pow((q.x - cx) / len, 2.0));

    float m = 0.5 + 0.5 * sin(p.x * 1.3 + p.y * 1.9 + flow * 0.33 + seed);
    vec3 tint = mix(c1.rgb, c2.rgb, m);
    tint = mix(tint, c3.rgb * 1.5, smoothstep(0.35, 0.02, abs(d)) * (0.5 + 0.5 * sin(flow * 0.21 + seed * 2.3)));
    return tint * light * along;
}

void main() {
    vec2 p = (qt_TexCoord0 - 0.5) * vec2(aspect, 1.0) * 2.0;
    vec2 m = p - mouse;
    p -= drag * exp(-dot(m, m) / 0.22);    // the cloth near the pointer gets pulled along, then settles back
    vec3 glow = sheet(p, 0.4, 0.28) + sheet(p, 2.6, -0.5) * 0.85 + sheet(p, 4.9, 0.85) * 0.6;
    vec3 col = c0.rgb + glow * (1.25 + 0.7 * energy);
    fragColor = vec4(min(col, vec3(1.0)), 1.0) * qt_Opacity;
}
