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
float sq(float x) { return x * x; }
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

// ---- YouTube mode (style 5): a glowing planet arc behind the video, in the chosen palette (c0..c3 = warm, highlight, middle, cool) ----
vec2 px2p(vec2 px) { return (px / vec2(1920.0, 1080.0) - 0.5) * vec2(aspect, 1.0) * 2.0; }
vec3 cosmic(vec2 p) {
    vec3 col = vec3(0.045, 0.042, 0.04);
    // parallax: each body shifts against the mouse by its depth (the planet is far, the moon nearer, the horizon nearest)
    vec2 look = abs(slowMouse.x) > 50.0 ? vec2(0.0) : slowMouse;
    // the planet rim: a huge circle whose edge sweeps over the video; its colours slowly travel round it
    // the whole planet drifts slowly and breathes, so the rim wanders around the video
    vec2 c = px2p(vec2(960.0 + 90.0 * sin(clock * 0.031), 1010.0 + 45.0 * cos(clock * 0.023))) - look * 0.035;
    float R = (950.0 + 35.0 * sin(clock * 0.017)) / 540.0;
    vec2 q = p - c;
    float r = length(q);
    float ang = atan(q.x, -q.y) / 3.14159;            // -1 left .. 0 top .. 1 right
    float t = ang + 0.12 * sin(clock * 0.05);
    vec3 tint = mix(c0.rgb, c1.rgb, smoothstep(-0.75, -0.45, t));
    tint = mix(tint, c2.rgb, smoothstep(-0.35, 0.05, t));
    tint = mix(tint, c3.rgb, smoothstep(0.15, 0.55, t));
    float d = r - R;
    float rim = exp(-d * d / (0.11 * 0.11)) + 0.45 * exp(-max(d, 0.0) / 0.35) * step(0.0, d) + 0.3 * exp(d / 0.12) * step(d, 0.0);
    float breathe = 0.85 + 0.15 * sin(clock * 0.3) + 0.25 * energy;
    col += tint * rim * 0.75 * breathe * smoothstep(0.98, 0.6, abs(ang));
    col *= mix(0.55, 1.0, smoothstep(-0.05, 0.08, d));   // the planet's body is darker than space
    // a small glowing moon that travels slowly along the rim, with a flare that pulses with the bass
    float ma = -0.62 + 0.14 * sin(clock * 0.021);
    vec2 moon = c + (R + 0.04) * vec2(sin(ma * 3.14159), -cos(ma * 3.14159));
    moon -= look * 0.04;
    vec2 m = p - moon;
    col += c0.rgb * 0.7 * exp(-dot(m, m) / 0.06);
    vec2 fl = p - (moon + vec2(0.17, -0.05));
    float flare = exp(-dot(fl, fl) / 0.0012) * (1.2 + 1.5 * energy)
                + exp(-fl.y * fl.y / 0.00002) * exp(-abs(fl.x) / 0.35) * (0.35 + 0.4 * energy)
                + exp(-fl.x * fl.x / 0.00002) * exp(-abs(fl.y) / 0.2) * 0.2;
    col += mix(c1.rgb, vec3(1.0, 0.95, 0.85), 0.6) * flare;
    // a thin bright horizon in the lower right, drifting slowly
    vec2 hc = px2p(vec2(1880.0 + 160.0 * sin(clock * 0.027), 2150.0 + 50.0 * cos(clock * 0.019))) - look * 0.09;
    float hd = length(p - hc) - 2.35;
    float hx = smoothstep(px2p(vec2(900.0, 0.0)).x, px2p(vec2(1700.0, 0.0)).x, p.x);
    col += mix(c2.rgb, vec3(1.0, 0.9, 0.93), 0.6) * (exp(-hd * hd / 0.00012) * 0.9 + exp(-max(hd, 0.0) / 0.12) * 0.12 * step(0.0, hd)) * hx;
    // lights on the horizon: a few glints slide slowly along the edge, and small lights twinkle just above it
    vec2 hq = p - hc;
    float ha = atan(hq.x, -hq.y);                       // position along the horizon
    float lights = 0.0;
    for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float at = -0.42 + 0.84 * fract(clock * (0.006 + 0.003 * fk) + fk * 0.27);   // each glint crosses on its own slow loop
        float da = (ha - at) * 2.35;
        lights += exp(-da * da / 0.004) * exp(-hd * hd / 0.00012) * (1.6 + 0.6 * sin(clock * 0.9 + fk * 2.0)) + exp(-da * da / 0.03) * exp(-max(hd, 0.0) / 0.05) * step(0.0, hd) * 0.25;
    }
    float cell = floor(ha * 110.0);
    float lamp = step(0.72, h1(cell + 3.0));
    float above = hd - 0.01 - 0.02 * h1(cell + 7.0);    // lamps sit just above the edge
    float dot_ = exp(-sq(fract(ha * 110.0) - 0.5) / 0.006) * exp(-above * above / 0.00004);
    float twinkle = 0.35 + 0.65 * smoothstep(0.3, 1.0, sin(clock * (0.4 + h1(cell) * 0.8) + h1(cell + 1.0) * 30.0));
    lights += lamp * dot_ * twinkle * 1.4;
    col += mix(c1.rgb, vec3(1.0, 0.92, 0.8), 0.55) * lights * hx * (0.9 + 0.3 * energy);
    return col;
}

// ---- YouTube mode (style 6): Light rain. A glowing cloud bank pours thin threads of light down the sides. ----
// c0 warm glow, c1 light colour, c2 cloud shadow, c3 mist
float threads(vec2 p, float cx, float w, float seed) {
    float d = abs(p.x - cx);
    float inG = 1.0 - smoothstep(w * 0.6, w, d);
    float lane = (p.x - cx) * 130.0;
    float id = floor(lane);
    float on = step(0.4, h1(id + seed));
    float thin = exp(-sq((fract(lane) - 0.5) / 0.1));
    float top = -0.5 + 0.05 * sin(clock * 0.13 + seed) + 0.03 * h1(id + seed + 2.0);
    float len = 0.75 + 0.35 * sin(clock * 0.06 + h1(id + seed) * 6.0);      // each thread slowly lengthens and shortens
    float y = p.y - top;
    float fall = smoothstep(0.0, 0.05, y) * exp(-max(y, 0.0) / len);
    float pulse = 0.72 + 0.28 * sin(y * 7.0 - clock * 0.9 + h1(id + seed + 5.0) * 20.0);   // light running down
    float shimmer = 0.7 + 0.3 * sin(clock * (0.4 + h1(id) * 1.2) + id);
    return inG * on * thin * fall * pulse * shimmer * (0.55 + 0.6 * h1(id + seed + 9.0));
}
float threadGroups(vec2 p) {
    return threads(p, -1.50, 0.07, 0.0) + threads(p, -1.31, 0.11, 13.0) + threads(p, 1.33, 0.10, 27.0)
         + threads(p, 1.53, 0.06, 41.0) + threads(p, -0.45, 0.08, 55.0) + threads(p, 0.52, 0.06, 69.0);
}
vec3 lightRain(vec2 p) {
    vec2 look = abs(slowMouse.x) > 50.0 ? vec2(0.0) : slowMouse;
    float t = clock * 0.018;
    vec3 col = mix(vec3(0.035, 0.036, 0.045), c3.rgb * 0.6, smoothstep(-0.3, 0.7, p.y));      // dark sky above, warmer haze below
    col = mix(col, vec3(0.05, 0.05, 0.06), smoothstep(0.55, 1.05, p.y));
    vec2 g = (p - vec2(0.0, -0.45) + look * 0.03) * vec2(0.55, 1.3);
    col += c0.rgb * 0.32 * exp(-dot(g, g) / 0.55);                         // warm light inside the cloud
    // threads of light, with a slight rainbow fringe (each colour channel offset a hair)
    vec2 tp = p + look * vec2(0.07, 0.04);
    vec3 s = vec3(threadGroups(tp + vec2(0.0016, 0.0)), threadGroups(tp), threadGroups(tp - vec2(0.0016, 0.0)));
    col += c1.rgb * s * 1.5 * (1.0 + 0.35 * energy);
    col += c0.rgb * 0.03 * (s.r + s.g + s.b);                              // a little haze around them
    // the cloud bank: crisp, detailed billows along the top, with heavier puffs over the threads at the sides
    vec2 cp = p + look * 0.05;
    vec2 w = cp + vec2(t, -t * 0.6) + fbm(cp * 0.9 - t) * 0.6;
    float n = fbm(w * 1.7) * 0.7 + fbm(w * 5.0 + 3.0) * 0.22 + fbm(w * 13.0 + 7.0) * 0.08;   // fine detail on the edges
    float shape = max(exp(-sq((cp.y + 1.06) / 0.17)),
                      exp(-(sq((abs(cp.x) - 1.5) / 0.3) + sq((cp.y + 0.5) / 0.3))));
    float dens = n * 0.75 + shape * 0.55;
    float cloud = smoothstep(0.545, 0.565, dens);                           // a sharp silhouette
    // light from below and behind: brighter where the cloud thins toward its lower edge, shadowed inside
    vec2 up = vec2(0.0, -0.025);
    float dUp = fbm((w + up) * 1.7) * 0.7 + fbm((w + up) * 5.0 + 3.0) * 0.22 + shape * 0.55;
    float rim = smoothstep(0.0, 0.08, dens - (dUp * 0.75 + shape * 0.0)) ;
    float inner = smoothstep(0.42, 0.68, n);        // shade by the billow texture, so the cloud has volume
    vec3 cloudCol = mix(mix(c1.rgb, vec3(1.0), 0.45) * 0.88, c2.rgb * 1.15, inner);     // pale lit cream, blue-grey shadow
    cloudCol += mix(c1.rgb, vec3(1.0), 0.3) * (rim * 0.35 + smoothstep(0.62, 0.55, dens) * 0.3) * (1.0 - inner * 0.6);   // glowing lower edge
    col = mix(col, cloudCol, cloud);
    // drifting mist low down
    float mist = fbm(p * 1.1 + vec2(t * 2.5, t)) * smoothstep(-0.1, 0.9, p.y);
    col = mix(col, c3.rgb * 1.1 + c0.rgb * 0.08, mist * 0.12);
    return col;
}

// ---- YouTube mode (style 7): Prism. Sunlight through a window falls across a dark surface, out of focus,
// splitting into colour at its edges. c0 surface, c1 warm light core, c2 cool fringe, c3 shadow ----
float lightPatch(vec2 p, vec2 c, vec2 r, float ang) {
    vec2 q = p - c;
    q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
    float d = length(q / r);
    return smoothstep(1.0, 0.25, d);
}
vec3 prismLight(vec2 p, vec2 c, vec2 r, float ang, float split) {
    // each colour channel sits a little apart, so the edges fringe blue on one side and orange on the other
    vec2 dir = vec2(cos(ang + 0.6), sin(ang + 0.6)) * split;
    return vec3(lightPatch(p + dir, c, r, ang), lightPatch(p, c, r, ang), lightPatch(p - dir * 1.4, c, r * 1.05, ang));
}
vec3 prism(vec2 p) {
    vec2 look = abs(slowMouse.x) > 50.0 ? vec2(0.0) : slowMouse;
    vec2 q = p + look * 0.05;
    // the surface: deep shadow upper left, a lit blue-grey plane lower right
    float lit = smoothstep(-1.4, 1.2, q.x * 0.55 + q.y * 0.75);
    vec3 col = mix(c3.rgb, c0.rgb, lit) + c0.rgb * 0.12 * fbm(q * 1.5 + clock * 0.01);
    // light patches, placed around the video, each drifting slowly on its own path and breathing
    vec3 light = vec3(0.0);
    for (int k = 0; k < 8; k++) {
        float fk = float(k);
        vec2 home = fk < 0.5 ? vec2(-1.5, 0.62) : fk < 1.5 ? vec2(-1.42, -0.15) : fk < 2.5 ? vec2(0.25, 0.86) : fk < 3.5 ? vec2(-0.55, 0.9)
                  : fk < 4.5 ? vec2(1.46, 0.3) : fk < 5.5 ? vec2(1.5, 0.78) : fk < 6.5 ? vec2(-0.9, -0.92) : vec2(-1.62, 0.95);
        vec2 size = fk < 0.5 ? vec2(0.42, 0.28) : fk < 2.5 ? vec2(0.3, 0.13) : fk < 4.5 ? vec2(0.22, 0.12) : vec2(0.18, 0.1);
        float sp = 0.04 + 0.03 * h1(fk + 1.0);
        vec2 c = home + vec2(sin(clock * sp + fk * 2.1), cos(clock * sp * 0.8 + fk)) * vec2(0.14, 0.08);
        vec2 r = size * (1.0 + 0.1 * sin(clock * 0.25 + fk * 1.7));
        float breathe = 0.7 + 0.3 * sin(clock * (0.15 + 0.1 * h1(fk)) + fk * 2.0);
        light += prismLight(q, c, r, -0.5 + 0.25 * h1(fk + 11.0), 0.035 + 0.025 * h1(fk + 13.0)) * breathe * (fk < 0.5 ? 1.3 : 1.0);
    }
    // window slits: bright bars in the top right, shimmering
    vec2 wq = q - vec2(1.35, -0.78) - look * 0.04;
    wq = mat2(cos(-0.42), -sin(-0.42), sin(-0.42), cos(-0.42)) * wq;
    float slots = smoothstep(0.32, 0.18, abs(fract(wq.y * 4.2 + 0.5) - 0.5) * 2.0 - 0.3) * smoothstep(0.75, 0.2, abs(wq.x)) * smoothstep(0.45, 0.2, abs(wq.y));
    light += vec3(0.95, 1.0, 1.05) * slots * (0.85 + 0.15 * sin(clock * 0.5));
    // colour the light: a warm white core, cool fringes where the channels separate
    vec3 tint = vec3(light.r * c1.r * 1.15, light.g * mix(c1.g, 1.0, 0.4), light.b * mix(c2.b, 1.0, 0.25) * 1.2);
    col += tint * 1.15 * (1.0 + 0.3 * energy);
    col += c2.rgb * 0.08 * (light.b - light.r);                       // a faint blue halo outside the warm core
    return col;
}

void main() {
    vec2 p = (qt_TexCoord0 - 0.5) * vec2(aspect, 1.0) * 2.0;
    vec3 col = style < 0.5 ? silk(p) : style < 1.5 ? waterHalftone(p) : style < 2.5 ? currents(p) : style < 3.5 ? lava(p)
             : style < 4.5 ? beach(p) : style < 5.5 ? cosmic(p) : style < 6.5 ? lightRain(p) : prism(p);
    fragColor = vec4(min(col, vec3(1.0)), 1.0) * qt_Opacity;
}
