#version 300 es

precision mediump float;
precision mediump usampler2D;

uniform usampler2D stageIn;
uniform int N;
in vec2 screenCoord;
out vec4 fragColor;

const vec2 NARROW = vec2(0.3, 0.7);
const vec2 WIDE = vec2(0.2, 0.8);

void main() {
    int bmask = int(texture(stageIn, screenCoord).r);
    vec2 off = fract(screenCoord * float(N));

    // see BM_* constants in the JS code
    bool top = (bmask & 1) != 0;
    bool bot = (bmask & 2) != 0;
    bool left = (bmask & 4) != 0;
    bool right = (bmask & 8) != 0;
    bool seg = (bmask & 16) != 0;
    bool apple = (bmask & 32) != 0;

    bool pix_horizontal = off.x > NARROW.x && off.x < NARROW.y;
    bool pix_vertical = off.y > NARROW.x && off.y < NARROW.y;

    bool pix_set =
        (seg && pix_horizontal && pix_vertical) ||
        (apple && all(greaterThan(off, WIDE.xx)) && all(lessThan(off, WIDE.yy))) ||
        (top && pix_horizontal && off.y > NARROW.y) ||
        (bot && pix_horizontal && off.y < NARROW.x) ||
        (left && pix_vertical && off.x < NARROW.x) ||
        (right && pix_vertical && off.x > NARROW.y);

    fragColor = vec4(pix_set, pix_set, pix_set, 1.0);
}
