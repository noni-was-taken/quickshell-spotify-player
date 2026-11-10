#version 440
// Water ripple simulation for the water background. Feeds back into itself every frame:
// red = height now, green = height last frame.
// Rebuild after editing:  /usr/lib/qt6/bin/qsb --qt6 -o ripples.frag.qsb ripples.frag
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 texel;
    float aspect;
    vec2 mouse;    // pointer in the same space as the background shader
    float push;    // how hard the mouse stirs the water this frame
    vec4 drop;     // a bass drop: x, y, strength
    float tick;    // changes every frame so this keeps rendering
};
layout(binding = 1) uniform sampler2D src;

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 p = (uv - 0.5) * 1.25 * vec2(aspect, 1.0) * 2.0;    // the water is 25% bigger than the screen, so ripples carry on past its edges
    vec2 s = uv;
    vec2 now = texture(src, s).rg;
    float n = texture(src, s + vec2(texel.x, 0.0)).r + texture(src, s - vec2(texel.x, 0.0)).r
            + texture(src, s + vec2(0.0, texel.y)).r + texture(src, s - vec2(0.0, texel.y)).r;
    float h = (2.0 * now.r - now.g + 0.15 * (n - 4.0 * now.r)) * 0.99;    // wave equation; 0.15 sets how slowly ripples travel
    vec2 m = p - mouse;
    h += push * exp(-dot(m, m) / 0.012);      // a wide, soft push makes big, slow rings
    vec2 d = p - drop.xy;
    h += drop.z * exp(-dot(d, d) / 0.012);
    h = h == h ? h : 0.0;
    vec2 edge = min(uv, 1.0 - uv);
    h *= smoothstep(0.0, 0.08, min(edge.x, edge.y));      // the far edges, off-screen, soak waves up instead of bouncing them back                                  // NaN guard: the very first frame can hold garbage
    float was = now.r == now.r ? now.r : 0.0;
    fragColor = vec4(clamp(h, -4.0, 4.0), was, 0.0, 1.0);
}
