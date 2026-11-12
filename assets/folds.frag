#version 440
// Player backgrounds. All use the genre colours (c0 base, c1-c3), the smoothed bass (energy) and the mouse.
// Rebuild after editing:  /usr/lib/qt6/bin/qsb --qt6 -o folds.frag.qsb folds.frag
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float flow;    // always-increasing phase; speeds up slightly with the music
    float energy;  // smoothed bass, 0..1
    float aspect;
    vec2 mouse;    // pointer, in the same space as p below
    vec2 drag;     // how far the pointer is ahead of where the fabric has caught up to (eases back to 0)
    float style;   // 0 silk, 1 water, 2 particle currents, 3 lava lamp, 4 pixel beach
    float clock;   // seconds
    vec2 slowMouse;  // the pointer, heavily smoothed, for the calmer backgrounds
    vec4 c0;
    vec4 c1;
    vec4 c2;
    vec4 c3;
};
layout(binding = 1) uniform sampler2D water;   // ripple heights from ripples.frag (water background)

// sin-free hashes (Hoskins), so the patterns stay clean in long sessions
float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h1(float n) { return h2(vec2(n, n * 0.37 + 1.7)); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
}

// ---- 0 silk: soft colour sheets, each with one sharp crease; the mouse pulls them like fabric ----
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
    float u = (q.x - cx) / len;
    float along = exp(-u * u);

    float m = 0.5 + 0.5 * sin(p.x * 1.3 + p.y * 1.9 + flow * 0.33 + seed);
    vec3 tint = mix(c1.rgb, c2.rgb, m);
    tint = mix(tint, c3.rgb * 1.5, (1.0 - smoothstep(0.02, 0.35, abs(d))) * (0.5 + 0.5 * sin(flow * 0.21 + seed * 2.3)));
    return tint * light * along;
}

vec3 silk(vec2 p) {
    vec2 m = p - mouse;
    p -= drag * exp(-dot(m, m) / 0.22);
    vec3 g = sheet(p, 0.4, 0.28) + sheet(p, 2.6, -0.5) * 0.85 + sheet(p, 4.9, 0.85) * 0.6;
    return c0.rgb + g * (1.25 + 0.7 * energy);
}

// ---- 1 water: a calm pool seen from above; the mouse and the bass drop ripples into it (ripples.frag) ----
float caustic(vec2 q) {      // two slowly drifting webs of thin light lines, like sun through water
    float a = fbm(q + vec2(clock * 0.05, clock * 0.03));
    float b = fbm(q * 1.4 + vec2(-clock * 0.04, clock * 0.05) + 7.0);
    return (1.0 - smoothstep(0.0, 0.05, abs(a - 0.5))) * 0.6 + (1.0 - smoothstep(0.0, 0.05, abs(b - 0.5))) * 0.4;
}
vec3 waterSurface(vec2 p) {     // slow, soft pools of light drifting under the dots
    vec2 drift = vec2(clock * 0.03, -clock * 0.02);
    vec2 w = vec2(fbm(p * 0.5 + drift), fbm(p * 0.5 - drift + 4.0));
    float wash = 0.25 + 0.5 * smoothstep(0.2, 0.85, fbm(p * 0.7 + (w - 0.5) * 1.2 + drift * 0.5));   // gentle: pools never go fully dark or fully bright
    vec3 tint = mix(c1.rgb, c2.rgb, smoothstep(0.35, 0.65, w.x));
    return mix(c3.rgb * 0.35 + c0.rgb * 0.5, tint * 0.9, wash) * (1.0 + 0.05 * energy);
}
float rippleAt(vec2 uv) {
    float h = texture(water, uv).r;
    return h == h ? clamp(h, -1.0, 1.0) : 0.0;      // guard against a bad first frame of the simulation
}
vec3 waterHalftone(vec2 p) {     // halftone dots that behave like a liquid: ripples crowd and spread them, and swell them
    vec2 uv = p / (vec2(aspect, 1.0) * 2.0) / 1.25 + 0.5;      // the screen is the middle of a bigger sheet of water
    vec2 tx = vec2(1.0 / 320.0, 1.0 / 180.0);
    float h = rippleAt(uv);
    vec2 slope = vec2(rippleAt(uv + vec2(tx.x, 0.0)) - rippleAt(uv - vec2(tx.x, 0.0)),
                      rippleAt(uv + vec2(0.0, tx.y)) - rippleAt(uv - vec2(0.0, tx.y)));
    float cs = 2.0 / 80.0;
    mat2 rot = mat2(0.7071, -0.7071, 0.7071, 0.7071);
    vec2 r = rot * (p - slope * 0.14);                   // the dot grid itself is pushed around: gaps open and close
    vec2 cell = floor(r / cs);
    vec3 col = waterSurface(transpose(rot) * ((cell + 0.5) * cs));
    float lum = clamp(dot(col, vec3(0.3, 0.5, 0.2)) * 2.0, 0.3, 0.6);
    float d = length(fract(r / cs) - 0.5);
    float inDot = 1.0 - smoothstep(-0.04, 0.04, d - 0.55 * sqrt(lum) * clamp(1.0 + 1.1 * h, 0.2, 1.8));
    return mix(c0.rgb * 0.3, col * (0.75 + 0.12 * max(h, 0.0)), inDot);   // dim on purpose: Water sits as calmly as the other backgrounds
}

// ---- 2 starfield: three depths of stars drifting through faint nebula clouds; the mouse slowly swirls them ----
vec3 stars(vec2 p, float cells, float keep, float size, float speed, float seed) {
    vec2 q = p + vec2(clock * speed, clock * speed * 0.3) + slowMouse * speed * 4.0;   // nearer layers drift and shift more
    float cs = 2.0 / cells;
    vec2 cell = floor(q / cs);
    float r = h2(cell + seed);
    if (r < keep) return vec3(0.0);
    vec2 off = vec2(h2(cell + seed + 1.3), h2(cell + seed + 2.7)) - 0.5;
    float d = length(fract(q / cs) - 0.5 - off * 0.7) * cs;
    float bright = (0.35 + 0.65 * pow(h2(cell + seed + 4.1), 3.0)) * (0.75 + 0.25 * sin(clock * 0.6 + r * 40.0)) * (1.0 + 0.2 * energy);
    float s = size * (0.6 + 0.8 * h2(cell + seed + 5.9));
    float light = exp(-d * d / (s * s)) + 0.12 * exp(-d / (s * 5.0));          // a sharp core and a soft halo
    vec3 hue = mix(vec3(1.0, 0.93, 0.82), vec3(0.82, 0.9, 1.0), h2(cell + seed + 7.7));
    return hue * light * bright;
}
vec3 currents(vec2 p) {
    vec2 m = p - slowMouse;
    float a = exp(-dot(m, m) / 0.2) * (0.1 + 0.4 * length(drag));
    p = slowMouse + mat2(cos(a), -sin(a), sin(a), cos(a)) * m;
    // nebulae in the genre colours: two soft glowing clouds with darker dust lanes, drifting very slowly
    float t = clock * 0.008;
    vec2 w = vec2(fbm(p * 0.45 + vec2(t, -t)), fbm(p * 0.45 + vec2(-t, t) + 5.0));
    float cloudA = smoothstep(0.42, 0.85, fbm(p * 0.6 + (w - 0.5) * 1.6 + vec2(t * 2.0, 0.0)));
    float cloudB = smoothstep(0.45, 0.9, fbm(p * 0.9 + (w.yx - 0.5) * 1.3 + 11.0 - vec2(0.0, t * 2.0)));
    float dust = smoothstep(0.5, 0.75, fbm(p * 1.6 + w * 0.8 + 23.0));
    vec3 col = c0.rgb * 0.5;
    col += c1.rgb * cloudA * 0.38 + c2.rgb * cloudB * 0.3 + mix(c1.rgb, c2.rgb, 0.5) * cloudA * cloudB * 0.25;
    col *= 1.0 - 0.45 * dust * max(cloudA, cloudB);
    col += c3.rgb * 0.12 * smoothstep(0.3, 0.8, w.x);
    col += stars(p, 90.0, 0.80, 0.0035, 0.004, 0.0);     // far: tiny and many
    col += stars(p, 45.0, 0.88, 0.0055, 0.008, 31.0);    // middle
    col += stars(p, 18.0, 0.94, 0.009, 0.016, 67.0);     // near: few, bigger, with halos
    return col;
}

// ---- 3 lava lamp: soft blobs that slowly merge and split; bass and mouse only nudge them ----
vec3 lava(vec2 p) {
    float s = 0.0;
    vec3 tint = vec3(0.0);
    for (int i = 0; i < 6; i++) {
        float fi = float(i);
        vec2 c = vec2(sin(clock * (0.04 + 0.011 * fi) + fi * 1.7) * aspect * 0.75, sin(clock * (0.034 + 0.009 * fi) + fi * 2.9) * 0.75);
        vec2 toMouse = slowMouse - c;
        c += toMouse * 0.1 * exp(-dot(toMouse, toMouse) / 0.6);
        float r = 0.32 + 0.06 * sin(fi * 3.1) + 0.04 * energy;
        float v = r * r / max(dot(p - c, p - c), 1e-4);
        s += v;
        tint += v * (mod(fi, 3.0) < 0.5 ? c1.rgb : (mod(fi, 3.0) < 1.5 ? c2.rgb : c3.rgb * 1.5));
    }
    tint /= max(s, 1e-4);
    float inside = smoothstep(0.9, 1.1, s);
    float e = (s - 1.0) * 4.0;
    float rim = exp(-e * e);
    float core = smoothstep(1.0, 3.0, s);
    return c0.rgb + tint * (inside * (0.75 + 0.35 * core) + rim * 0.35 + min(s, 1.0) * 0.08);
}

// ---- 4 pixel beach: sky and sun, the sea, and waves that run up the sand and splash ----
vec3 beach(vec2 p) {
    float px = 2.0 / 200.0;
    vec2 pp = (floor(p / px) + 0.5) * px;
    pp.x += slowMouse.x * 0.008;
    float horizonY = 0.05;
    float sandTop = 0.55;
    float phase = clock * 0.18;
    float runup = pow(0.5 + 0.5 * sin(phase), 1.6) * (1.0 + 0.2 * energy);
    float shore = sandTop - 0.2 * runup + 0.025 * sin(pp.x * 3.0 + phase * 2.0) + 0.012 * sin(pp.x * 9.0 - phase);
    vec2 sun = vec2(0.0, horizonY - 0.02);
    float r = 0.36 * (1.0 + 0.03 * energy);
    vec3 col;
    if (pp.y < horizonY) {                                     // sky, stars, sun
        col = mix(c0.rgb, c3.rgb * 0.9, smoothstep(-0.9, horizonY, pp.y));
        if (h2(floor(pp / px)) > 0.994 && pp.y < -0.3) col += vec3(0.45) * (0.6 + 0.4 * sin(clock * 0.4 + h2(pp) * 40.0));
        float below = (pp.y - sun.y + r * 0.4) / r;
        if (length(pp - sun) < r && !(below > 0.0 && fract(below * 6.0) < below * 0.5))
            col = mix(c2.rgb * 1.3, c1.rgb * 1.15, clamp((pp.y - sun.y + r) / (1.4 * r), 0.0, 1.0));
        col += c2.rgb * 0.2 * exp(-dot(pp - sun, pp - sun) / 0.3);
    } else if (pp.y < shore) {                                 // sea, with crests rolling toward the shore
        float depth = (pp.y - horizonY) / (shore - horizonY);
        col = mix(c3.rgb * 0.55 + c0.rgb * 0.4, c1.rgb * 0.45 + c3.rgb * 0.3, depth);
        float crest = fract((pp.y - horizonY) * (6.0 + 10.0 * depth) - phase * 0.35 + 0.15 * sin(pp.x * 2.0 + phase));
        col += vec3(0.04 + 0.07 * depth) * step(0.92, crest);
        float glint = abs(pp.x - sun.x) < r * 0.55 * (1.0 - depth * 0.6) ? step(0.8, h2(floor(pp / px) + floor(clock * 0.6))) : 0.0;
        col += c2.rgb * 0.18 * glint * (1.0 - depth);
        if (shore - pp.y < 0.03) col = mix(col, mix(c2.rgb, vec3(1.0), 0.55), 0.7);     // foam at the wave's edge
    } else {                                                   // sand, darker where the water just was
        col = c2.rgb * 0.5 + c0.rgb * 0.3;
        float wet = sandTop - 0.2 * pow(0.5 + 0.5 * sin(phase - 0.6), 1.6) + 0.02;
        if (pp.y < max(wet, shore + 0.001)) col *= 0.72;
        if (h2(floor(pp / px)) > 0.97) col *= 0.88;
    }
    // splashes: spray kicked up just above the shoreline while the wave is at its highest
    float spray = smoothstep(0.75, 1.0, runup) * step(shore - 0.09, pp.y) * step(pp.y, shore);
    if (spray > 0.0 && h2(floor(pp / px) + floor(clock * 2.0)) > 0.9 - 0.06 * spray)
        col = mix(col, mix(c2.rgb, vec3(1.0), 0.6), 0.6 * spray);
    return floor(col * 20.0 + 0.5) / 20.0;    // finer colour steps: coarse ones drew rings around the sun
}

// ---- YouTube mode: fixed-mood scenes around the video (styles 5-8). The video sits at x 320-1600, y 130-850 of 1920x1080. ----
float videoDist(vec2 p) {      // distance from the video rectangle, in p units
    vec2 c = vec2(0.0, -0.1185), h = vec2(1.3333 * 0.6667, 0.6667);
    vec2 d = abs(p - c) - h;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
vec3 spill(vec2 p, vec3 a, vec3 b) {   // the video lights the room around it
    float d = max(videoDist(p), 0.0);
    return mix(a, b, smoothstep(-1.0, 1.0, p.x)) * exp(-d * 3.0) * 0.35;
}
float sparkle(vec2 p, float cells, float seed, float keep) {   // soft round lights scattered on a jittered grid
    vec2 cell = floor(p * cells);
    if (h2(cell + seed) < keep) return 0.0;
    vec2 c = (cell + 0.5 + 0.7 * (vec2(h2(cell + seed + 1.0), h2(cell + seed + 2.0)) - 0.5)) / cells;
    float r = (0.06 + 0.1 * h2(cell + seed + 3.0)) / cells;
    float d = length(p - c);
    return exp(-d * d / (r * r)) * (0.5 + 0.5 * sin(clock * 0.8 + h2(cell + seed) * 40.0));
}
vec3 clubCol(float i) {      // old GLSL on some drivers has no constant arrays
    float k = mod(i, 5.0);
    return k < 0.5 ? vec3(1.0, 0.18, 0.7) : k < 1.5 ? vec3(0.13, 0.88, 1.0) : k < 2.5 ? vec3(0.65, 1.0, 0.24) : k < 3.5 ? vec3(0.54, 0.36, 1.0) : vec3(1.0, 0.54, 0.16);
}
vec3 club(vec2 p) {
    vec3 col = vec3(0.025, 0.02, 0.045);
    for (int s = 0; s < 3; s++) {
        vec2 src = vec2(-1.2 + 1.2 * float(s), -1.05);
        for (int k = 0; k < 4; k++) {
            float fk = float(k + s * 4);
            float ang = 0.8 * sin(clock * (0.25 + 0.05 * fk) + fk * 1.9);
            vec2 dir = vec2(sin(ang), cos(ang));
            vec2 q = p - src;
            float along = dot(q, dir), across = abs(q.x * dir.y - q.y * dir.x);
            float beam = smoothstep(0.03 + along * 0.09, 0.0, across) * step(0.0, along) * exp(-along * 0.45);
            float strobe = 0.55 + 0.45 * sin(clock * 0.9 + fk * 2.3) + 0.6 * energy;
            col += clubCol(fk) * beam * 0.32 * strobe;
        }
    }
    col += vec3(0.5, 0.15, 0.6) * 0.12 * fbm(p * 1.2 + vec2(clock * 0.05, 0.0));   // haze
    // smoke the beams light up, and soft round sparkles drifting slowly upward
    float smoke = fbm(p * 1.4 + vec2(clock * 0.04, -clock * 0.03) + fbm(p * 0.8 - clock * 0.02));
    col += mix(clubCol(0.0), clubCol(3.0), smoothstep(0.3, 0.7, fbm(p * 0.6 + 4.0))) * 0.16 * smoothstep(0.45, 0.85, smoke);
    vec2 sp = p + vec2(0.0, clock * 0.03);
    for (int k = 0; k < 3; k++) col += clubCol(float(k) * 2.0) * sparkle(sp, 9.0 + 5.0 * float(k), 11.0 * float(k), 0.86) * 0.5;
    return col + spill(p, clubCol(0.0), clubCol(1.0));
}
vec3 bokeh(vec2 p, float cells, float speed, vec3 a, vec3 b, float seed) {
    vec2 q = p + vec2(0.0, clock * speed);
    vec2 cell = floor(q * cells);
    if (h2(cell + seed) < 0.6) return vec3(0.0);
    vec2 c = (cell + 0.25 + 0.5 * vec2(h2(cell + seed + 1.0), h2(cell + seed + 2.0))) / cells;
    float r = (0.18 + 0.2 * h2(cell + seed + 3.0)) / cells;
    float disc = smoothstep(r, r * 0.8, length(q - c)) * (0.55 + 0.45 * sin(clock * 0.4 + h2(cell) * 30.0));
    return mix(a, b, h2(cell + seed + 4.0)) * disc;
}
vec3 jazz(vec2 p) {
    vec3 col = mix(vec3(0.09, 0.05, 0.025), vec3(0.03, 0.015, 0.01), smoothstep(-1.0, 1.0, p.x + p.y * 0.5));
    col += vec3(1.0, 0.6, 0.28) * 0.22 * exp(-dot(p - vec2(-1.3, -0.9), p - vec2(-1.3, -0.9)) / 0.8);   // lamp glow
    col += vec3(0.77, 0.4, 0.17) * 0.14 * exp(-dot(p - vec2(1.5, 0.8), p - vec2(1.5, 0.8)) / 0.7);
    col += bokeh(p, 3.0, 0.012, vec3(1.0, 0.8, 0.5), vec3(1.0, 0.6, 0.3), 0.0) * 0.16;
    col += bokeh(p, 1.6, 0.02, vec3(1.0, 0.75, 0.45), vec3(1.0, 0.55, 0.25), 9.0) * 0.12;
    return col + spill(p, vec3(1.0, 0.7, 0.36), vec3(0.77, 0.42, 0.17));
}
vec3 rainy(vec2 p) {
    vec3 col = mix(vec3(0.05, 0.1, 0.2), vec3(0.015, 0.025, 0.05), smoothstep(-1.0, 0.6, p.y));
    col += bokeh(p + vec2(0.0, -0.4), 4.0, 0.0, vec3(0.3, 0.8, 1.0), vec3(1.0, 0.45, 0.68), 21.0) * 0.22 * smoothstep(0.2, 0.9, p.y);
    col += bokeh(p + vec2(0.3, -0.4), 4.0, 0.0, vec3(1.0, 0.7, 0.28), vec3(0.6, 0.82, 1.0), 33.0) * 0.18 * smoothstep(0.2, 0.9, p.y);
    vec2 r = vec2(p.x + p.y * 0.2, p.y);
    float lane = floor(r.x * 90.0);
    float fall = fract(r.y * 1.2 - clock * (0.35 + 0.25 * h1(lane)) + h1(lane + 5.0));
    col += vec3(0.8, 0.9, 1.0) * 0.12 * step(0.88, fall) * step(0.6, h1(lane + 9.0)) * (1.0 - smoothstep(0.0, 0.004, abs(fract(r.x * 90.0) - 0.5) / 90.0));
    vec2 dc = floor(p * 14.0);
    vec2 dp = (dc + 0.5 + 0.35 * (vec2(h2(dc), h2(dc + 1.0)) - 0.5)) / 14.0;
    col += vec3(0.85, 0.92, 1.0) * 0.15 * step(0.8, h2(dc + 7.0)) * smoothstep(0.012, 0.006, length(p - dp));   // drops on the glass
    return col + spill(p, vec3(0.31, 0.64, 1.0), vec3(0.17, 0.37, 0.7));
}
vec3 aurora(vec2 p) {
    vec3 col = mix(vec3(0.01, 0.025, 0.04), vec3(0.005, 0.015, 0.02), smoothstep(-1.0, 1.0, p.y));
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float x = p.x * (0.8 + 0.2 * fk) + 0.25 * sin(p.y * 1.5 + clock * 0.08 + fk * 2.0) + clock * 0.015 * (fk + 1.0);
        float curtain = pow(fbm(vec2(x * 2.2, fk * 3.0 + clock * 0.03)), 2.2) * smoothstep(0.7, -0.6, p.y) * smoothstep(-1.1, -0.3, p.y);
        vec3 c = fk < 0.5 ? vec3(0.24, 1.0, 0.69) : (fk < 1.5 ? vec3(0.17, 0.83, 1.0) : vec3(0.61, 0.42, 1.0));
        col += c * curtain * (0.55 + 0.25 * energy);
    }
    col += vec3(0.9) * (sparkle(p, 40.0, 3.0, 0.8) * 0.7 + sparkle(p, 18.0, 7.0, 0.9)) * smoothstep(0.6, -0.2, p.y);
    float hill1 = 0.83 + 0.05 * sin(p.x * 2.2 + 1.0) + 0.025 * sin(p.x * 6.0);
    float hill2 = 0.91 + 0.035 * sin(p.x * 3.1 + 3.0) + 0.015 * sin(p.x * 9.0);
    col = p.y > hill2 ? vec3(0.008, 0.02, 0.016) : (p.y > hill1 ? vec3(0.024, 0.066, 0.05) : col);
    return col + spill(p, vec3(0.24, 1.0, 0.69), vec3(0.17, 0.83, 1.0));
}

void main() {
    vec2 p = (qt_TexCoord0 - 0.5) * vec2(aspect, 1.0) * 2.0;
    vec3 col = style < 0.5 ? silk(p) : style < 1.5 ? waterHalftone(p) : style < 2.5 ? currents(p) : style < 3.5 ? lava(p)
             : style < 4.5 ? beach(p) : style < 5.5 ? club(p) : style < 6.5 ? jazz(p) : style < 7.5 ? rainy(p) : aurora(p);
    fragColor = vec4(min(col, vec3(1.0)), 1.0) * qt_Opacity;
}
